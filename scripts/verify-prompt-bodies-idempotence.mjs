#!/usr/bin/env node
// Prompt-generation idempotence gate (hygiene 2026-09-12).
//
// Proves that prompt-body generation is deterministic and that the TRACKED
// module is exactly what the generator produces:
//
//   generation 1: rebuild from v2-docs/prompts in memory -> byte-equal to the
//                 tracked src/domain/generated/prompt-bodies.ts (no diff)
//   generation 2: write through the SAME write path to a temp file, read
//                 back -> byte-equal again (no diff)
//
// It also enforces prompt integrity: every canonical prompt body embedded in
// the module is byte-identical to its LF-normalized markdown source, so a
// newline normalization alone can never masquerade as (or hide) a content
// change. Any byte difference — including a CRLF regression — fails the run.
// Runs as part of `npm test`, before vitest regenerates the module.

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildPromptBodiesModuleSource,
  collectPromptFiles,
  normalizeToLf,
  writePromptBodiesModule,
} from "./generate-prompt-bodies.mjs";

const promptsDir = resolve(process.cwd(), "v2-docs", "prompts");
const trackedPath = resolve(process.cwd(), "src", "domain", "generated", "prompt-bodies.ts");

function fail(message, actual, expected) {
  console.error(`FAIL: ${message}`);
  if (typeof actual === "string" && typeof expected === "string") {
    const max = Math.max(actual.length, expected.length);
    for (let i = 0; i < max; i++) {
      if (actual[i] !== expected[i]) {
        const ctx = actual.slice(Math.max(0, i - 60), i + 60);
        console.error(
          `  first differing byte at index ${i} (actual U+${actual.charCodeAt(i)?.toString(16) ?? "eof"}, expected U+${expected.charCodeAt(i)?.toString(16) ?? "eof"}): ...${JSON.stringify(ctx)}...`
        );
        break;
      }
    }
    console.error(`  tracked length ${actual.length}, generated length ${expected.length}`);
  }
  process.exit(1);
}

const generated = buildPromptBodiesModuleSource(promptsDir);
if (generated.includes("\r")) {
  fail("generator output contains CR bytes — canonical newline is LF");
}

// Generation 1: the tracked module must already BE the canonical output.
const tracked = readFileSync(trackedPath, "utf8");
if (tracked !== generated) {
  fail(
    "generation 1 produced a diff — run `node scripts/generate-prompt-bodies.mjs` and commit the result (newline drift or content drift)"
  , tracked, generated);
}

// Generation 2: the canonical write path must be idempotent.
const tempDir = mkdtempSync(join(tmpdir(), "prompt-bodies-idempotence-"));
try {
  const tempOut = join(tempDir, "prompt-bodies.ts");
  writePromptBodiesModule(promptsDir, tempOut);
  const rewritten = readFileSync(tempOut, "utf8");
  if (rewritten !== tracked) {
    fail("generation 2 produced a diff — generation is not idempotent", rewritten, tracked);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

// Prompt integrity: every embedded body is byte-identical to its
// LF-normalized markdown source (wording untouched; newlines canonical). Each
// transport entry is exactly one deterministic line, so byte-exact matching
// needs no TS parsing.
const canonicalBodies = [
  "00-domain-contract-v1.md",
  "simple/01-design-blueprint.md",
  "simple/02-website-builder.md",
  "simple/03-visual-qa.md",
  "simple/04-site-repair.md",
  "simple/05-original-design-blueprint.md",
  "simple/06-original-design-visual-qa.md",
];
const allFiles = collectPromptFiles(promptsDir);
for (const name of allFiles) {
  const source = normalizeToLf(readFileSync(resolve(promptsDir, name), "utf8"));
  const expectedLine = `  ${JSON.stringify(name)}: ${JSON.stringify(source)},`;
  if (!tracked.includes(expectedLine)) {
    fail(`embedded body '${name}' does not byte-match its markdown source (content drift)`);
  }
}
for (const name of canonicalBodies) {
  if (!allFiles.includes(name)) {
    fail(`canonical prompt body '${name}' is missing from the markdown sources`);
  }
}

console.log(
  `prompt bodies idempotent: generation 1 clean, generation 2 clean, ${allFiles.length} bodies intact (${canonicalBodies.length} canonical stage bodies byte-verified)`
);
