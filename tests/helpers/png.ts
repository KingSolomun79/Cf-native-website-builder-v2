// PNG test helpers: build structurally complete or deliberately corrupt PNG
// payloads for the reference-input / persistence tests.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

function chunk(type: string, data: Uint8Array): Uint8Array {
  const length = data.length;
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(typeBytes, 0);
  typeAndData.set(data, 4);
  const crc = crc32(typeAndData);

  const out = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc, false);
  return out;
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8; // bit depth
  data[9] = 2; // color type (RGB)
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return chunk("IHDR", data);
}

function iend(): Uint8Array {
  return chunk("IEND", new Uint8Array(0));
}

function idat(payload: Uint8Array): Uint8Array {
  return chunk("IDAT", payload);
}

export interface BuildPngOptions {
  width?: number;
  height?: number;
  idatBytes?: number;
  omitIend?: boolean;
  trailingBytes?: number;
  corruptIhdrCrc?: boolean;
}

export function buildPng(options: BuildPngOptions = {}): ArrayBuffer {
  const width = options.width ?? 1440;
  const height = options.height ?? 2500;
  const parts: Uint8Array[] = [
    new Uint8Array(PNG_SIGNATURE),
    ihdr(width, height),
  ];

  if (options.corruptIhdrCrc) {
    const ihdrPart = parts[1];
    // Flip the last byte of the IHDR chunk (its CRC) to invalidate the CRC.
    ihdrPart[ihdrPart.length - 1] ^= 0xff;
  }

  if (options.idatBytes && options.idatBytes > 0) {
    parts.push(idat(new Uint8Array(options.idatBytes)));
  }

  if (!options.omitIend) {
    parts.push(iend());
  }

  if (options.trailingBytes && options.trailingBytes > 0) {
    parts.push(new Uint8Array(options.trailingBytes));
  }

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out.buffer;
}

export function buildPngHeaderOnly(width: number, height: number): ArrayBuffer {
  return buildPng({ width, height, omitIend: true, idatBytes: 0 });
}
