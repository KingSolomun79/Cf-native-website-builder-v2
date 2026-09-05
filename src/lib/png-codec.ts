// Minimal, dependency-free PNG codec for deterministic visual evidence
// extraction (issue #41) and normalized visual-input production.
//
// Runtime: Cloudflare Workers (workerd). Inflate/deflate go through the
// platform Compression Streams API ('deflate' = RFC1950 zlib, exactly what
// PNG IDAT requires). No Node APIs, no third-party decoders.
//
// Decode support: 8-bit depth, color types 0 (grayscale), 2 (RGB), 3
// (palette) and 6 (RGBA), non-interlaced — the space Playwright/capture PNGs
// live in. Anything else fails with a precise reason so the extraction
// channel can record `decoded: false` instead of fabricating data.
// Alpha is dropped (not composited) — surface/band analysis is unaffected.
// Encode: RGB, filter 0, single IDAT.
//
// Distinct from src/lib/png.ts, which builds header-only structural fixture
// PNGs for validation tests (no pixel data).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface DecodedPng {
  width: number;
  height: number;
  /** Packed RGB rows: length = width * height * 3. */
  rgb: Uint8Array;
}

export type PngDecodeFailure = { ok: false; reason: string };
export type PngDecodeSuccess = { ok: true; png: DecodedPng };

// Inflates with a hard output bound: a crafted PNG (small declared
// dimensions, huge inflated IDAT) must fail loudly instead of exhausting
// worker memory (decompression-bomb guard).
async function inflateZlibBounded(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("inflated size exceeds bound").catch(() => {});
      throw new Error(`inflated pixel data exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunkBytes of chunks) {
    out.set(chunkBytes, at);
    at += chunkBytes.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export async function decodePng(bytes: Uint8Array): Promise<PngDecodeSuccess | PngDecodeFailure> {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return { ok: false, reason: "not a PNG (bad signature)" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idatParts: Uint8Array[] = [];
  let palette: Uint8Array | null = null;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.length) return { ok: false, reason: `truncated ${type} chunk` };
    const data = bytes.subarray(dataStart, dataStart + length);
    if (type === "IHDR") {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (!width || !height) return { ok: false, reason: "missing IHDR" };
  if (bitDepth !== 8) return { ok: false, reason: `unsupported bit depth ${bitDepth} (only 8)` };
  if (interlace !== 0) return { ok: false, reason: "interlaced PNG not supported" };
  if (![0, 2, 3, 6].includes(colorType)) return { ok: false, reason: `unsupported color type ${colorType}` };
  if (colorType === 3 && !palette) return { ok: false, reason: "palette PNG without PLTE chunk" };
  if (idatParts.length === 0) return { ok: false, reason: "no IDAT pixel data" };
  if (width * height > 40_000_000) return { ok: false, reason: "image too large to decode within bounded worker memory" };

  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 1;
  const stride = width * channels;
  let raw: Uint8Array;
  try {
    const total = idatParts.reduce((sum, part) => sum + part.length, 0);
    const idat = new Uint8Array(total);
    let at = 0;
    for (const part of idatParts) {
      idat.set(part, at);
      at += part.length;
    }
    raw = await inflateZlibBounded(idat, (stride + 1) * height + 65_536);
  } catch (error) {
    return { ok: false, reason: `pixel data is not decodable: ${(error as Error).message}` };
  }
  if (raw.length < (stride + 1) * height) {
    return { ok: false, reason: `pixel data truncated (${raw.length} bytes for ${height} scanlines)` };
  }

  // Undo per-scanline filters.
  const filtered = new Uint8Array(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? filtered[outStart + x - bpp] : 0;
      const up = y > 0 ? filtered[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? filtered[(y - 1) * stride + x - bpp] : 0;
      const value = raw[rowStart + x];
      let out: number;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + left; break;
        case 2: out = value + up; break;
        case 3: out = value + Math.floor((left + up) / 2); break;
        case 4: out = value + paeth(left, up, upLeft); break;
        default: return { ok: false, reason: `unknown scanline filter ${filter}` };
      }
      filtered[outStart + x] = out & 0xff;
    }
  }

  // Expand to packed RGB.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const src = i * channels;
    const dst = i * 3;
    if (colorType === 2) {
      rgb[dst] = filtered[src];
      rgb[dst + 1] = filtered[src + 1];
      rgb[dst + 2] = filtered[src + 2];
    } else if (colorType === 6) {
      rgb[dst] = filtered[src];
      rgb[dst + 1] = filtered[src + 1];
      rgb[dst + 2] = filtered[src + 2];
    } else if (colorType === 3) {
      const index = filtered[src];
      rgb[dst] = palette![index * 3];
      rgb[dst + 1] = palette![index * 3 + 1];
      rgb[dst + 2] = palette![index * 3 + 2];
    } else {
      rgb[dst] = rgb[dst + 1] = rgb[dst + 2] = filtered[src];
    }
  }
  return { ok: true, png: { width, height, rgb } };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/** Encodes packed RGB rows as an 8-bit RGB PNG (filter 0). */
export async function encodePng(input: { width: number; height: number; rgb: Uint8Array }): Promise<Uint8Array> {
  const { width, height, rgb } = input;
  if (rgb.length !== width * height * 3) throw new Error("encodePng: rgb buffer size mismatch");
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Filter-0 scanlines.
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const stream = new Blob([raw.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("deflate"));
  const idat = new Uint8Array(await new Response(stream).arrayBuffer());

  const signature = new Uint8Array(PNG_SIGNATURE);
  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", idat);
  const iendChunk = chunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let at = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Deterministic block-average downscale (aspect ratio preserved). */
export function downscaleRgb(
  input: { width: number; height: number; rgb: Uint8Array },
  targetWidth: number
): { width: number; height: number; rgb: Uint8Array } {
  const { width, height, rgb } = input;
  if (targetWidth >= width) return { width, height, rgb: rgb.slice() };
  const scale = width / targetWidth;
  const outWidth = targetWidth;
  const outHeight = Math.max(1, Math.round(height / scale));
  const out = new Uint8Array(outWidth * outHeight * 3);
  for (let oy = 0; oy < outHeight; oy++) {
    const srcY0 = Math.floor(oy * scale);
    const srcY1 = Math.min(height, Math.max(srcY0 + 1, Math.floor((oy + 1) * scale)));
    for (let ox = 0; ox < outWidth; ox++) {
      const srcX0 = Math.floor(ox * scale);
      const srcX1 = Math.min(width, Math.max(srcX0 + 1, Math.floor((ox + 1) * scale)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = srcY0; sy < srcY1; sy++) {
        for (let sx = srcX0; sx < srcX1; sx++) {
          const at = (sy * width + sx) * 3;
          r += rgb[at];
          g += rgb[at + 1];
          b += rgb[at + 2];
          n += 1;
        }
      }
      const dst = (oy * outWidth + ox) * 3;
      out[dst] = Math.round(r / n);
      out[dst + 1] = Math.round(g / n);
      out[dst + 2] = Math.round(b / n);
    }
  }
  return { width: outWidth, height: outHeight, rgb: out };
}

/** Extracts a vertical slice [startY, endY) from packed RGB rows. */
export function sliceRgbRows(
  input: { width: number; height: number; rgb: Uint8Array },
  startY: number,
  endY: number
): { width: number; height: number; rgb: Uint8Array } {
  const { width, height, rgb } = input;
  const from = Math.max(0, Math.min(height, startY));
  const to = Math.max(from, Math.min(height, endY));
  const rows = to - from;
  return { width, height: rows, rgb: rgb.slice(from * width * 3, to * width * 3) };
}
