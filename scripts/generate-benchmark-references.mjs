// Frozen benchmark Reference Screenshot generator (issue #17, PRD section 43).
//
// Renders the five canonical benchmark Reference Screenshots as deterministic
// design-composition mocks and emits the runtime transport module the Worker
// isolate reads the frozen bytes from (Worker isolates cannot read the repo
// filesystem — the same transport pattern as the vitest-generated fixtures).
//
// The generator is PROVENANCE TOOLING, not a runtime dependency: it is run
// ONCE to produce the committed PNGs + module. Re-running it to change a
// frozen case requires an explicit operator decision that versions the case
// (a frozen target is never silently replaced) — see FINAL-DECISION-RECORD.
//
// Usage: node scripts/generate-benchmark-references.mjs
// Writes:
//   benchmarks/<case-id>/reference-screenshot.png   (human-reviewable asset)
//   src/domain/benchmark/generated-frozen-screenshots.ts (runtime bytes + sha256)

import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── Minimal deterministic PNG encoder (RGB, filter 0) ───────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixels) {
  // pixels: Uint8Array of RGB triplets, row-major.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * width * 3, width * 3).copy(raw, y * (1 + width * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Composition canvas ──────────────────────────────────────────────────────

function canvas(width, height, [r, g, b]) {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = r;
    pixels[i * 3 + 1] = g;
    pixels[i * 3 + 2] = b;
  }
  return { width, height, pixels };
}

function block(image, x, y, w, h, [r, g, b]) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(image.width, Math.round(x + w));
  const y1 = Math.min(image.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * image.width + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      image.pixels[i++] = r;
      image.pixels[i++] = g;
      image.pixels[i++] = b;
    }
  }
}

// Reads as "text" texture without breaking zlib runs too badly: alternating
// light rows inside a block, so the composition shows internal structure.
function textLines(image, x, y, w, h, lineColor, gap = 14) {
  for (let yy = y; yy < y + h; yy += gap) {
    block(image, x, yy, w, 4, lineColor);
  }
}

// ── The five frozen compositions (PRD section 43 archetypes) ────────────────
// Materially different TOPOLOGY, not merely color/content: asymmetric split
// vs full-bleed card grids vs narrow centered rhythm vs chunky stacked bands
// vs dense irregular bento with overlap.

const W = 1280;

// Palette anchors shared across cases (structure differs; tone stays plausible).
const PAPER = [246, 245, 242];
const INK = [38, 38, 42];
const MID = [122, 128, 136];
const LIGHT = [226, 224, 219];
const ACCENT = [188, 108, 60];

function editorialCase() {
  // 1. asymmetric/editorial — 60/40 off-grid split, staggered offset blocks,
  //    heavy whitespace, narrow accent rule column.
  const image = canvas(W, 4200, PAPER);
  block(image, 0, 0, W, 84, INK); // masthead
  textLines(image, 60, 26, 320, 30, PAPER, 12);
  block(image, 950, 0, 330, 84, ACCENT); // masthead end-slab (asymmetric weight)
  // hero: text column left, image block offset right + lower
  textLines(image, 84, 300, 560, 700, INK, 22);
  block(image, 90, 1010, 300, 10, ACCENT);
  block(image, 744, 470, 452, 1010, MID); // hero visual, hangs lower than text
  // pull-quote band, indented asymmetrically
  block(image, 170, 1660, 940, 210, LIGHT);
  textLines(image, 210, 1700, 700, 130, INK, 20);
  // staggered pair: left image low, right text higher (overlap in y only)
  block(image, 84, 2080, 500, 900, MID);
  textLines(image, 664, 2060, 520, 560, INK, 20);
  // second editorial spread: image right, text left-lower
  block(image, 640, 3080, 560, 760, LIGHT);
  textLines(image, 84, 3220, 480, 480, INK, 20);
  block(image, 84, 3860, 1112, 8, INK); // closing rule
  block(image, 0, 3980, W, 220, INK); // footer
  return image;
}

function hospitalityCase() {
  // 2. image-heavy hospitality/travel — full-bleed hero, 3-across card rows,
  //    wide gallery band, 2x2 grid.
  const image = canvas(W, 5200, PAPER);
  block(image, 0, 0, W, 1250, [45, 52, 58]); // full-bleed hero visual
  textLines(image, 340, 520, 600, 220, PAPER, 26); // hero overlay text
  textLines(image, 440, 1080, 400, 60, PAPER, 14);
  textLines(image, 200, 1350, 880, 90, INK, 20); // intro strip
  // 3-across card row
  for (const x of [60, 460, 860]) {
    block(image, x, 1560, 360, 520, MID);
    textLines(image, x + 24, 2130, 312, 60, INK, 14);
  }
  textLines(image, 200, 2230, 880, 60, INK, 18);
  block(image, 0, 2400, W, 700, [88, 104, 96]); // wide gallery band
  // 2x2 card grid
  for (const y of [3220, 3810]) {
    for (const x of [60, 660]) {
      block(image, x, y, 560, 540, LIGHT);
      textLines(image, x + 24, y + 460, 400, 40, INK, 12);
    }
  }
  block(image, 0, 4470, W, 260, INK); // CTA strip
  textLines(image, 440, 4560, 400, 60, PAPER, 18);
  textLines(image, 200, 4820, 880, 40, INK, 14);
  block(image, 0, 4980, W, 220, [45, 52, 58]); // footer
  return image;
}

function corporateCase() {
  // 3. restrained corporate/professional — header bar, narrow centered
  //    column, even vertical rhythm, thin rules, symmetric.
  const image = canvas(W, 3400, [252, 252, 253]);
  block(image, 0, 0, W, 64, [255, 255, 255]);
  block(image, 0, 64, W, 2, [210, 210, 214]);
  textLines(image, 60, 20, 260, 24, INK, 10);
  const cx = 340; // centered column 600 wide
  textLines(image, cx, 200, 600, 160, INK, 22); // headline block
  for (let i = 0; i < 4; i++) {
    const y = 520 + i * 460;
    block(image, cx, y, 600, 300, i % 2 === 0 ? [238, 239, 241] : [226, 228, 231]);
    textLines(image, cx + 24, y + 30, 552, 120, INK, 16);
  }
  block(image, cx, 2400, 290, 260, [231, 233, 236]); // symmetric pair left
  block(image, cx + 310, 2400, 290, 260, [231, 233, 236]); // symmetric pair right
  textLines(image, cx, 2760, 600, 120, INK, 18);
  block(image, cx, 3000, 600, 2, [210, 210, 214]); // closing rule
  block(image, 0, 3220, W, 180, [72, 74, 80]); // footer
  return image;
}

function tradesCase() {
  // 4. bold trades/local service — chunky stacked bands, accent slabs,
  //    minimal whitespace, wide CTA strips.
  const image = canvas(W, 2600, [240, 240, 238]);
  block(image, 0, 0, W, 70, [24, 24, 26]);
  block(image, 40, 12, 260, 46, [196, 60, 40]); // nav accent slab
  block(image, 0, 90, W, 520, [214, 106, 34]); // giant headline band
  textLines(image, 80, 220, 760, 260, [255, 250, 244], 30);
  block(image, 880, 200, 320, 300, [30, 30, 32]); // badge slab
  block(image, 0, 630, W, 150, [24, 24, 26]); // trust strip
  textLines(image, 90, 670, 1100, 60, [235, 235, 235], 16);
  // 3 service cards (bordered)
  for (const x of [50, 450, 850]) {
    block(image, x, 840, 380, 480, [225, 225, 222]);
    block(image, x, 840, 380, 12, [196, 60, 40]);
    textLines(image, x + 20, 890, 340, 240, INK, 18);
  }
  block(image, 0, 1420, W, 480, [214, 106, 34]); // big CTA band
  textLines(image, 320, 1580, 640, 160, [255, 250, 244], 26);
  for (const x of [50, 450, 850]) {
    block(image, x, 1960, 380, 260, [226, 226, 224]);
    textLines(image, x + 20, 2010, 340, 120, INK, 14);
  }
  block(image, 0, 2300, W, 300, [24, 24, 26]); // contact + footer
  textLines(image, 90, 2360, 500, 100, [235, 235, 235], 16);
  return image;
}

function denseModularCase() {
  // 5. difficult but supported responsive/motion Reference — dense irregular
  //    bento grid, overlap slab, tall page, dense footer grid.
  const image = canvas(W, 7800, [245, 244, 240]);
  block(image, 0, 0, W, 76, [252, 252, 250]);
  block(image, 0, 76, W, 2, [214, 212, 208]);
  const gutter = 14;
  const m = 40;
  const tones = [
    [58, 62, 70],
    [128, 132, 138],
    [206, 204, 198],
    [168, 172, 178],
    [92, 96, 104],
  ];
  let y = 120;
  const splits = [
    [2, 1],
    [1, 1, 1],
    [1, 2],
    [1, 1, 1],
    [2, 1],
    [1, 2],
    [1, 1, 1],
  ];
  const rowHeights = [560, 480, 700, 480, 620, 540, 480];
  for (let r = 0; r < splits.length; r++) {
    const parts = splits[r];
    const h = rowHeights[r];
    const innerW = W - 2 * m - gutter * (parts.length - 1);
    let x = m;
    for (let p = 0; p < parts.length; p++) {
      const w = Math.floor((innerW * parts[p]) / parts.reduce((a, b) => a + b, 0));
      const tone = tones[(r * 3 + p) % tones.length];
      block(image, x, y, w, h, tone);
      textLines(image, x + 18, y + 20, Math.max(60, w - 36), Math.min(200, h - 40), r % 2 === 0 ? [240, 240, 238] : INK, 16);
      x += w + gutter;
    }
    y += h + gutter;
  }
  // overlap slab across two rows (compositionally unusual — declared in the
  // frozen Adaptation Contract)
  block(image, m + 180, 2380, 620, 260, ACCENT);
  // long dense directory band
  block(image, m, 6660, W - 2 * m, 560, [34, 34, 38]);
  for (let c = 0; c < 4; c++) {
    for (let rr = 0; rr < 5; rr++) {
      textLines(image, m + 30 + c * 300, 6700 + rr * 70, 240, 30, [200, 200, 202], 10);
    }
  }
  block(image, 0, 7420, W, 380, [24, 24, 26]); // footer
  for (let c = 0; c < 5; c++) textLines(image, 60 + c * 244, 7480, 180, 120, [180, 180, 184], 14);
  return image;
}

// ── Frozen case registry (must mirror src/domain/benchmark/definitions.ts) ──

export const CASES = [
  { caseId: "bench-01-editorial-asymmetric", render: editorialCase },
  { caseId: "bench-02-hospitality-image-heavy", render: hospitalityCase },
  { caseId: "bench-03-corporate-restrained", render: corporateCase },
  { caseId: "bench-04-trades-bold", render: tradesCase },
  { caseId: "bench-05-dense-modular", render: denseModularCase },
];

const moduleHeader = `// AUTO-GENERATED by scripts/generate-benchmark-references.mjs — do not edit.
// Frozen benchmark Reference Screenshot bytes (issue #17, PRD section 43) and
// their canonical sha256 identities. The five screenshots are FROZEN inputs:
// regenerating or replacing one requires an explicit operator decision that
// versions the case (a difficult benchmark is never silently replaced).
// PNG bytes are base64 (RGB, deterministic compositions; sha256 over the raw
// PNG bytes) so the Worker isolate can verify/freeze them without filesystem
// access.

`;

const pngHeader = (caseId, sha) => `// AUTO-GENERATED by scripts/generate-benchmark-references.mjs — do not edit.
// Frozen benchmark Reference Screenshot for case ${caseId} (sha256 ${sha}).
`;

const results = [];
const moduleCases = [];
for (const { caseId, render } of CASES) {
  const image = render();
  const png = encodePng(image.width, image.height, image.pixels);
  const sha = createHash("sha256").update(png).digest("hex");
  const dir = join(root, "benchmarks", caseId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "reference-screenshot.png"), png);
  writeFileSync(join(dir, "reference-screenshot.png.sha256"), `${sha}  reference-screenshot.png\n`);
  moduleCases.push(`  "${caseId}": {
    sha256: "${sha}",
    width: ${image.width},
    height: ${image.height},
    base64: \`${png.toString("base64")}\`,
  },`);
  results.push(`${caseId}: ${image.width}x${image.height} png=${(png.length / 1024).toFixed(1)}KiB sha256=${sha.slice(0, 16)}…`);
}

const moduleDir = join(root, "src", "domain", "benchmark");
mkdirSync(moduleDir, { recursive: true });
writeFileSync(
  join(moduleDir, "generated-frozen-screenshots.ts"),
  `${moduleHeader}export const FROZEN_SCREENSHOTS: Record<string, { sha256: string; width: number; height: number; base64: string }> = {
${moduleCases.join("\n")}
};
`
);
console.log(results.join("\n"));
