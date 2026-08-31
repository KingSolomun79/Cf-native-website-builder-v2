export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const MIN_SCREENSHOT_WIDTH = 1024;
export const MIN_SCREENSHOT_HEIGHT = 768;
export const MIN_FULL_PAGE_RATIO = 0.75;
export const REFERENCE_SCREENSHOT_MIME = "image/png";

export const SCREENSHOT_REJECT_TOO_LARGE = "SCREENSHOT_TOO_LARGE";
export const SCREENSHOT_REJECT_EMPTY = "SCREENSHOT_EMPTY";
export const SCREENSHOT_REJECT_WRONG_MIME = "SCREENSHOT_WRONG_MIME";
export const SCREENSHOT_REJECT_NOT_PNG = "SCREENSHOT_NOT_PNG";
export const SCREENSHOT_REJECT_TRUNCATED = "SCREENSHOT_TRUNCATED";
export const SCREENSHOT_REJECT_CORRUPT = "SCREENSHOT_CORRUPT";
export const SCREENSHOT_REJECT_TOO_SMALL = "SCREENSHOT_TOO_SMALL";
export const SCREENSHOT_REJECT_NOT_FULL_PAGE = "SCREENSHOT_NOT_FULL_PAGE";

export interface ScreenshotInput {
  data: ArrayBuffer;
  byteSize: number;
  mimeType: string;
}

export interface ScreenshotMetadata {
  width: number;
  height: number;
  mimeType: string;
  byteSize: number;
}

export type ScreenshotValidation =
  | { ok: true; metadata: ScreenshotMetadata }
  | { ok: false; error: string; code: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_TYPE = 0x49484452;
const IEND_TYPE = 0x49454e44;

export function validateReferenceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateHostname(hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isPng(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 8));
  return bytes.length === PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function parsePngDimensions(data: ArrayBuffer): { width: number; height: number } | null {
  if (data.byteLength < 24 || !isPng(data)) return null;
  const view = new DataView(data, 0, 24);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (!width || !height || width > 1_000_000 || height > 1_000_000) return null;
  return { width, height };
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface PngStructure {
  width: number;
  height: number;
  hasIend: boolean;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function parsePngStructure(data: ArrayBuffer): PngStructure | null {
  if (data.byteLength < 8) return null;
  const bytes = new Uint8Array(data);

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let hasIend = false;

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readUint32(bytes, offset + 4);
    const chunkDataStart = offset + 8;
    const chunkEnd = chunkDataStart + length;

    if (chunkEnd + 4 > bytes.length) return null;
    if (length > 0x7fffffff) return null;

    const computed = crc32(bytes, offset + 4, chunkEnd) >>> 0;
    const stored = readUint32(bytes, chunkEnd) >>> 0;
    if (computed !== stored) return null;

    if (type === IHDR_TYPE) {
      if (length !== 13 || sawIhdr) return null;
      if (offset !== 8) return null;
      width = readUint32(bytes, chunkDataStart);
      height = readUint32(bytes, chunkDataStart + 4);
      if (!width || !height || width > 1_000_000 || height > 1_000_000) return null;
      sawIhdr = true;
    } else if (type === IEND_TYPE) {
      if (length !== 0) return null;
      hasIend = true;
      if (chunkEnd + 4 !== bytes.length) return null;
      break;
    }

    offset = chunkEnd + 4;
  }

  if (!sawIhdr || !hasIend) return null;
  return { width, height, hasIend };
}

export function isCompletePng(data: ArrayBuffer): boolean {
  return parsePngStructure(data) !== null;
}

export function validateScreenshot(input: ScreenshotInput): ScreenshotValidation {
  if (input.byteSize <= 0) {
    return { ok: false, error: "Screenshot payload is empty.", code: SCREENSHOT_REJECT_EMPTY };
  }
  if (input.byteSize > MAX_SCREENSHOT_BYTES) {
    return { ok: false, error: `Screenshot exceeds the ${MAX_SCREENSHOT_BYTES} byte limit.`, code: SCREENSHOT_REJECT_TOO_LARGE };
  }
  if (input.mimeType !== REFERENCE_SCREENSHOT_MIME) {
    return { ok: false, error: `Screenshot must be a ${REFERENCE_SCREENSHOT_MIME} image.`, code: SCREENSHOT_REJECT_WRONG_MIME };
  }
  if (!isPng(input.data)) {
    return { ok: false, error: "Screenshot content is not a valid PNG image.", code: SCREENSHOT_REJECT_NOT_PNG };
  }

  const structure = parsePngStructure(input.data);
  if (!structure) {
    const truncated = !hasTerminalIend(input.data);
    return {
      ok: false,
      error: truncated
        ? "Screenshot PNG is truncated or structurally incomplete (missing IEND or trailing data)."
        : "Screenshot PNG failed structural validation (corrupt chunk CRC or malformed chunk).",
      code: truncated ? SCREENSHOT_REJECT_TRUNCATED : SCREENSHOT_REJECT_CORRUPT,
    };
  }

  const { width, height } = structure;
  if (width < MIN_SCREENSHOT_WIDTH || height < MIN_SCREENSHOT_HEIGHT) {
    return {
      ok: false,
      error: `Screenshot must be at least ${MIN_SCREENSHOT_WIDTH}x${MIN_SCREENSHOT_HEIGHT} for full-page homepage reference (got ${width}x${height}).`,
      code: SCREENSHOT_REJECT_TOO_SMALL,
    };
  }

  const ratio = height / width;
  if (ratio < MIN_FULL_PAGE_RATIO) {
    return {
      ok: false,
      error: `Screenshot does not look like a full-page capture (height/width ratio ${ratio.toFixed(2)} is below ${MIN_FULL_PAGE_RATIO}; got ${width}x${height}). Capture the entire homepage, not just the viewport.`,
      code: SCREENSHOT_REJECT_NOT_FULL_PAGE,
    };
  }

  return {
    ok: true,
    metadata: {
      width,
      height,
      mimeType: REFERENCE_SCREENSHOT_MIME,
      byteSize: input.byteSize,
    },
  };
}

function hasTerminalIend(data: ArrayBuffer): boolean {
  if (data.byteLength < 12) return false;
  const bytes = new Uint8Array(data);
  const marker = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  for (let i = bytes.length - marker.length; i >= 8; i--) {
    if (marker.every((b, idx) => bytes[i + idx] === b)) return true;
    if (bytes.length - i > 64) break;
  }
  return false;
}

export async function computeChecksum(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

export function checksumShort(checksum: string): string {
  return checksum.slice(0, 16);
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === "::" || hostname === "::1") {
    return true;
  }

  const mappedIpv4 = parseMappedIpv4(hostname);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

  if (hostname.includes(":")) {
    const first = Number.parseInt(hostname.split(":", 1)[0] || "0", 16);
    if (!Number.isInteger(first)) return true;
    return (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00;
  }

  return isPrivateIpv4(hostname);
}

function parseMappedIpv4(hostname: string): string | null {
  if (!hostname.startsWith("::ffff:")) return null;
  const tail = hostname.slice(7);
  if (tail.includes(".")) return tail;

  const groups = tail.split(":");
  if (groups.length !== 2) return null;
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null;
  }
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224;
}
