#!/usr/bin/env node
// Generates src/domain/generated/prompt-bodies.ts from v2-docs/prompts/*.md.
//
// The Worker runtime cannot read the repository filesystem, so the canonical
// prompt bodies (domain contract + retained detailed stage bodies named by
// PROMPT-MANIFEST.md) are transported as a generated module. vitest.config.ts
// imports the SAME generation functions before tests; this script serves
// dev/deploy. The markdown files remain the single source of truth.
//
// DETERMINISM (prompt-generation idempotence hygiene, 2026-09-12): the
// generator normalizes line endings explicitly on input and output so the
// generated module is byte-identical on every platform. Git autocrlf smudges
// the markdown working-tree copies to CRLF on Windows (and PowerShell heredocs
// can introduce CR anywhere), which previously leaked \r\n into the embedded
// string literals and rewrote the tracked module between test runs. Canonical
// newline is LF everywhere; .gitattributes pins eol=lf for the prompt markdown
// and the generated module so the developer's global Git settings cannot
// change this.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";

/** Canonical newline for every generated prompt body: LF. */
export function normalizeToLf(text) {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The canonical prompt-body file set: top-level bodies (minus the manifest)
 * plus the simple/ stage bodies keyed as "simple/<file>", deterministically
 * sorted. PROMPT-MANIFEST.md is documentation, not a runtime body.
 */
export function collectPromptFiles(promptsDir) {
  const simpleDir = resolve(promptsDir, "simple");
  return [
    ...readdirSync(promptsDir)
      .filter((name) => name.endsWith(".md") && name !== "PROMPT-MANIFEST.md")
      .sort(),
    ...(existsSync(simpleDir)
      ? readdirSync(simpleDir)
          .filter((name) => name.endsWith(".md"))
          .sort()
          .map((name) => `simple/${name}`)
      : []),
  ];
}

/**
 * Builds the full module source from the markdown sources. Input line endings
 * are normalized to LF BEFORE embedding, so the output never contains a CR
 * byte regardless of the platform's Git smudge or editor.
 */
export function buildPromptBodiesModuleSource(promptsDir) {
  const files = collectPromptFiles(promptsDir);
  const entries = files
    .map((name) => {
      const content = normalizeToLf(readFileSync(resolve(promptsDir, name), "utf8"));
      return `  ${JSON.stringify(name)}: ${JSON.stringify(content)},`;
    })
    .join("\n");
  return `// AUTO-GENERATED from v2-docs/prompts/*.md — do not edit.\n// Source of truth: v2-docs/prompts/ + v2-docs/prompts/PROMPT-MANIFEST.md.\nexport const PROMPT_BODY_FILES: Record<string, string> = {\n${entries}\n};\n`;
}

/** Writes the module through the single canonical write path (LF bytes). */
export function writePromptBodiesModule(promptsDir, outPath) {
  const source = buildPromptBodiesModuleSource(promptsDir);
  if (source.includes("\r")) {
    throw new Error("prompt-bodies generator produced CR bytes — normalization failed");
  }
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, source);
  return source;
}

function runAsCli() {
  const promptsDir = resolve(process.cwd(), "v2-docs", "prompts");
  const outPath = resolve(process.cwd(), "src", "domain", "generated", "prompt-bodies.ts");

  const source = writePromptBodiesModule(promptsDir, outPath);
  console.log(`Wrote ${outPath} from ${collectPromptFiles(promptsDir).length} prompt bodies (LF-normalized).`);

  // Also transport the machine-readable capability envelope (mirrors the
  // generation vitest.config.ts performs for tests).
  const envelope = readFileSync(resolve(process.cwd(), "v2-docs", "capability-envelope.json"), "utf8");
  writeFileSync(
    resolve(process.cwd(), "src", "domain", "generated", "capability-envelope.ts"),
    `// AUTO-GENERATED from v2-docs/capability-envelope.json — do not edit.
export const CAPABILITY_ENVELOPE = ${envelope.trim()} as const;
`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAsCli();
}
