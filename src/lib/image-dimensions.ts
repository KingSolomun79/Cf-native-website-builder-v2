// Deterministic pixel-dimension sniffing for generated image bytes (issue #47
// orientation conformance). Acceptance verifies an asset's actual orientation
// against its Image Slot requirement — a 16:9 collage must never be accepted
// for a 2:3 portrait role (frozen RankForge v3 defect). PNG, JPEG and all
// three WEBP bitstream forms are decoded from headers only; an unknown
// format returns null so the caller can decide (the acceptance gate accepts
// undecodable bytes — QA judges them visually — but never a measured
// mismatch).

export interface ImageDimensions {
  width: number;
  height: number;
}

export function sniffImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;

  // PNG: 8-byte signature, then IHDR with big-endian width/height at 16..24.
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // WEBP: RIFF container with WEBP form type; dimensions per chunk type.
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      if (bytes[offset + index] !== text.charCodeAt(index)) return false;
    }
    return true;
  };
  if (ascii(0, "RIFF") && ascii(8, "WEBP") && bytes.length >= 30) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8 ") {
      // Lossy: after the 10-byte frame tag, the 3-byte start code then
      // little-endian 14-bit dimensions at offset 26/28.
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === "VP8L") {
      // Lossless: 0x2F signature at 21, then 14-bit width-1 / height-1
      // packed LSB-first across bytes 22..25.
      if (bytes[21] !== 0x2f) return null;
      const width = 1 + (((bytes[22] | (bytes[23] << 8)) & 0x3fff));
      const height = 1 + (((bytes[23] >> 6) | (bytes[24] << 2) | (bytes[25] << 10)) & 0x3fff);
      return { width, height };
    }
    if (chunk === "VP8X") {
      // Extended: 24-bit little-endian canvas width-1 / height-1 at 24/27.
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    return null;
  }

  // JPEG: walk segment markers to the first SOF frame header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // SOF0-SOF15 except DHT (C4), JPG (C8), DAC (CC) carry frame dimensions.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + segmentLength;
    }
    return null;
  }

  return null;
}

// Compositional conformance of measured pixel dimensions against a slot's
// orientation requirement. Tolerances exist so a provider's 16:9 vs 1.5:1
// rounding cannot fail a landscape slot, but a landscape asset can never
// satisfy a portrait requirement (the frozen defect).
export function orientationConforms(
  orientation: "landscape" | "portrait" | "square",
  dimensions: ImageDimensions
): boolean {
  if (dimensions.width <= 0 || dimensions.height <= 0) return false;
  if (orientation === "portrait") return dimensions.height > dimensions.width;
  if (orientation === "square") {
    return Math.abs(dimensions.width - dimensions.height) <= Math.max(2, 0.05 * Math.max(dimensions.width, dimensions.height));
  }
  return dimensions.width >= dimensions.height;
}
