#!/usr/bin/env node
// Generates src/domain/generated/prompt-bodies.ts from v2-docs/prompts/*.md.
//
// The Worker runtime cannot read the repository filesystem, so the canonical
// prompt bodies (domain contract + retained detailed stage bodies named by
// PROMPT-MANIFEST.md) are transported as a generated module. vitest.config.ts
// runs the same generation before tests; this script serves dev/deploy. The
// markdown files remain the single source of truth.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";

const promptsDir = resolve(process.cwd(), "v2-docs", "prompts");
const outPath = resolve(process.cwd(), "src", "domain", "generated", "prompt-bodies.ts");

const files = readdirSync(promptsDir).filter((name) => name.endsWith(".md") && name !== "PROMPT-MANIFEST.md").sort();

const entries = files
  .map((name) => {
    const content = readFileSync(resolve(promptsDir, name), "utf8");
    return `  ${JSON.stringify(name)}: ${JSON.stringify(content)},`;
  })
  .join("\n");

const body = `// AUTO-GENERATED from v2-docs/prompts/*.md — do not edit.
// Source of truth: v2-docs/prompts/ + v2-docs/prompts/PROMPT-MANIFEST.md.
export const PROMPT_BODY_FILES: Record<string, string> = {
${entries}
};
`;

// Also transport the machine-readable capability envelope (mirrors the
// generation vitest.config.ts performs for tests).
const envelope = readFileSync(resolve(process.cwd(), "v2-docs", "capability-envelope.json"), "utf8");
writeFileSync(
  resolve(process.cwd(), "src", "domain", "generated", "capability-envelope.ts"),
  `// AUTO-GENERATED from v2-docs/capability-envelope.json — do not edit.
export const CAPABILITY_ENVELOPE = ${envelope.trim()} as const;
`
);

mkdirSync(resolve(process.cwd(), "src", "domain", "generated"), { recursive: true });
writeFileSync(outPath, body);
console.log(`Wrote ${outPath} from ${files.length} prompt bodies.`);
