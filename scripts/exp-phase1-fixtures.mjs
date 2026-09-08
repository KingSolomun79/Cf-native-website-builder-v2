#!/usr/bin/env node
// EXPERIMENT BRANCH ONLY — generates the FIXED Accepted Image fixture set for
// the Finch known-good builder test (benchmark Phase 1, spec sections 59-61).
// No AI image generation: aspect ratios and dark/light photographic mass are
// what the test evaluates (image treatment/layout), not subject accuracy.
// Output: .tmp-exp-phase1/fixtures/<slotId>.png + reference-screenshot.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Two-stop vertical gradient PNG (RGB), with a soft horizontal vignette so the
// surface reads as a photograph placeholder rather than flat color.
function gradientPng(width, height, top, bottom) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    const t = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const vignette = 1 - 0.35 * Math.abs(x / (width - 1) - 0.5) * 2;
      for (let c = 0; c < 3; c += 1) {
        const value = Math.round((top[c] + (bottom[c] - top[c]) * t) * vignette);
        raw[offset] = Math.max(0, Math.min(255, value));
        offset += 1;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SLOTS = [
  { id: "home-hero", w: 1600, h: 900, top: [94, 62, 34], bottom: [24, 16, 10] },
  { id: "home-chapters-tents", w: 1200, h: 900, top: [72, 74, 48], bottom: [20, 22, 14] },
  { id: "home-chapters-wildlife", w: 1200, h: 900, top: [110, 78, 40], bottom: [30, 20, 12] },
  { id: "home-location", w: 1350, h: 900, top: [64, 70, 58], bottom: [18, 20, 16] },
  { id: "home-closing", w: 1600, h: 900, top: [36, 34, 66], bottom: [10, 10, 22] },
  { id: "about-story", w: 1200, h: 900, top: [96, 80, 64], bottom: [28, 22, 18] },
  { id: "services-hero", w: 1600, h: 900, top: [168, 160, 132], bottom: [92, 88, 70] },
  { id: "contact-atmosphere", w: 1600, h: 900, top: [178, 182, 170], bottom: [108, 114, 104] },
];

mkdirSync(".tmp-exp-phase1/fixtures", { recursive: true });
for (const slot of SLOTS) {
  writeFileSync(`.tmp-exp-phase1/fixtures/${slot.id}.png`, gradientPng(slot.w, slot.h, slot.top, slot.bottom));
  console.log(`${slot.id}.png ${slot.w}x${slot.h}`);
}
// The intake's vision-input derivation needs a decodable reference surface.
writeFileSync(".tmp-exp-phase1/fixtures/reference-screenshot.png", gradientPng(1440, 3200, [26, 24, 20], [12, 11, 9]));
console.log("reference-screenshot.png 1440x3200");
