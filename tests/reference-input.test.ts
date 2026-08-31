import { describe, expect, it } from "vitest";
import {
  isPng,
  isCompletePng,
  MAX_SCREENSHOT_BYTES,
  MIN_SCREENSHOT_HEIGHT,
  MIN_SCREENSHOT_WIDTH,
  MIN_FULL_PAGE_RATIO,
  parsePngDimensions,
  validateReferenceUrl,
  validateScreenshot,
  computeChecksum,
  checksumShort,
  SCREENSHOT_REJECT_TRUNCATED,
  SCREENSHOT_REJECT_CORRUPT,
  SCREENSHOT_REJECT_TOO_SMALL,
  SCREENSHOT_REJECT_NOT_FULL_PAGE,
} from "../src/lib/reference-input";
import { validateIntake } from "../src/lib/validation";
import { buildPng, buildPngHeaderOnly } from "./helpers/png";

describe("reference input validation", () => {
  it("accepts public HTTP and HTTPS references", () => {
    expect(validateReferenceUrl("https://ngongroad.org/")).toBe("https://ngongroad.org/");
    expect(validateReferenceUrl("http://example.com/path")).toBe("http://example.com/path");
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://[::]/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.1.2.3]/",
    "http://[fe90::1]/",
    "http://[ff02::1]/",
    "http://localhost./",
    "https://user:password@example.com/",
  ])("rejects unsafe reference URL %s", (url) => {
    expect(validateReferenceUrl(url)).toBeNull();
  });

  it("checks the PNG signature", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
    const fake = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer;
    expect(isPng(png)).toBe(true);
    expect(isPng(fake)).toBe(false);
    expect(MAX_SCREENSHOT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("rejects unsafe reference URLs during webhook intake", () => {
    const result = validateIntake({
      company_name: "Example",
      client_email: "owner@example.com",
      website_overall_style: "minimalist-monochrome",
      reference_site_url: "http://127.0.0.1/admin",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      field: "reference_site_url",
      message: "Reference site URL must be a public HTTP or HTTPS URL",
    });
  });

  it("parses PNG dimensions from the IHDR chunk", () => {
    expect(parsePngDimensions(buildPngHeaderOnly(1440, 3000))).toEqual({ width: 1440, height: 3000 });
    expect(parsePngDimensions(buildPngHeaderOnly(1, 1))).toEqual({ width: 1, height: 1 });
  });

  it("rejects dimension parsing for non-PNG or truncated payloads", () => {
    expect(parsePngDimensions(new ArrayBuffer(10))).toBeNull();
    const notPng = new ArrayBuffer(24);
    new DataView(notPng);
    expect(parsePngDimensions(notPng)).toBeNull();
  });

  it("validates a full-page screenshot payload", () => {
    const data = buildPng({ width: 1440, height: 2500 });
    const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.width).toBe(1440);
      expect(result.metadata.height).toBe(2500);
    }
  });

  it.each([
    ["empty payload", { data: new ArrayBuffer(0), byteSize: 0, mimeType: "image/png" }],
    ["wrong mime", { data: buildPng({ width: 1440, height: 2500 }), byteSize: 33, mimeType: "image/jpeg" }],
    ["too small", { data: buildPng({ width: 400, height: 300 }), byteSize: 33, mimeType: "image/png" }],
    ["oversize", { data: buildPng({ width: 1440, height: 2500 }), byteSize: MAX_SCREENSHOT_BYTES + 1, mimeType: "image/png" }],
  ])("rejects screenshot for %s", (_label, input) => {
    const result = validateScreenshot(input as Parameters<typeof validateScreenshot>[0]);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-PNG payload even with png mime", () => {
    const data = new ArrayBuffer(24);
    const result = validateScreenshot({ data, byteSize: 24, mimeType: "image/png" });
    expect(result.ok).toBe(false);
  });

  it("enforces minimum dimension floors", () => {
    expect(MIN_SCREENSHOT_WIDTH).toBeGreaterThanOrEqual(1024);
    expect(MIN_SCREENSHOT_HEIGHT).toBeGreaterThanOrEqual(768);
    const data = buildPng({ width: MIN_SCREENSHOT_WIDTH, height: MIN_SCREENSHOT_HEIGHT + 1000 });
    const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
    expect(result.ok).toBe(true);
  });

  it("computes a stable SHA-256 checksum", async () => {
    const data = buildPng({ width: 1024, height: 900 });
    const checksum = await computeChecksum(data);
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    const again = await computeChecksum(data);
    expect(again).toBe(checksum);
  });

  it("checksumShort returns a stable 16-char prefix", async () => {
    const data = buildPng({ width: 1024, height: 900 });
    const checksum = await computeChecksum(data);
    expect(checksumShort(checksum)).toBe(checksum.slice(0, 16));
  });

  describe("structural PNG validation", () => {
    it("accepts a structurally complete PNG (IHDR + IEND)", () => {
      const data = buildPng({ width: 1440, height: 2500 });
      expect(isCompletePng(data)).toBe(true);
    });

    it("rejects a PNG missing the IEND chunk (truncated)", () => {
      const data = buildPng({ width: 1440, height: 2500, omitIend: true });
      expect(isCompletePng(data)).toBe(false);
      const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(SCREENSHOT_REJECT_TRUNCATED);
    });

    it("rejects a PNG with trailing bytes after IEND as corrupt", () => {
      const data = buildPng({ width: 1440, height: 2500, trailingBytes: 8 });
      expect(isCompletePng(data)).toBe(false);
      const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(SCREENSHOT_REJECT_CORRUPT);
    });

    it("rejects a PNG with a corrupt IHDR CRC", () => {
      const data = buildPng({ width: 1440, height: 2500, corruptIhdrCrc: true });
      expect(isCompletePng(data)).toBe(false);
      const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(SCREENSHOT_REJECT_CORRUPT);
    });

    it("rejects a header-only PNG (no IEND) as truncated despite a valid-looking signature/IHDR", () => {
      const data = buildPngHeaderOnly(1440, 2500);
      expect(parsePngDimensions(data)).toEqual({ width: 1440, height: 2500 });
      const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(SCREENSHOT_REJECT_TRUNCATED);
    });
  });

  describe("full-page suitability heuristic", () => {
    it("rejects an image below the minimum dimensions with SCREENSHOT_TOO_SMALL", () => {
      const data = buildPng({ width: 800, height: 2000 });
      const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(SCREENSHOT_REJECT_TOO_SMALL);
    });

    it("rejects a viewport-only screenshot that is not full-page (low height/width ratio)", () => {
      const data = buildPng({ width: 1440, height: 900 });
      const ratio = 900 / 1440;
      expect(ratio).toBeLessThan(MIN_FULL_PAGE_RATIO);
      const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(SCREENSHOT_REJECT_NOT_FULL_PAGE);
    });

    it("accepts a tall full-page capture above the ratio floor", () => {
      const height = Math.ceil(MIN_SCREENSHOT_WIDTH * MIN_FULL_PAGE_RATIO) + 100;
      const data = buildPng({ width: MIN_SCREENSHOT_WIDTH, height });
      const ratio = height / MIN_SCREENSHOT_WIDTH;
      expect(ratio).toBeGreaterThanOrEqual(MIN_FULL_PAGE_RATIO);
      const result = validateScreenshot({ data, byteSize: data.byteLength, mimeType: "image/png" });
      expect(result.ok).toBe(true);
    });
  });
});
