// Canonical V2 prompt contract (issue #6, PRD section 21).
//
// Runtime prompt identity comes ONLY from this manifest, which mirrors
// v2-docs/prompts/PROMPT-MANIFEST.md. The historical version suffix of a
// retained detailed body filename (e.g. 01-reference-analyzer-v2.md) is NOT
// the runtime prompt version. Every runtime stage prompt is composed as:
//
//   00-domain-contract-v1.md + retained detailed stage body
//
// The domain contract is prepended and is authoritative over contradictory
// legacy clauses inside the detailed body.

import { PROMPT_BODY_FILES } from "./generated/prompt-bodies";

export const DOMAIN_CONTRACT_FILE = "00-domain-contract-v1.md";
export const DOMAIN_CONTRACT_VERSION = "v1";

export interface PromptManifestEntry {
  /** Canonical runtime prompt id, e.g. 'reference-analyzer'. */
  promptId: string;
  /** Canonical runtime prompt version from PROMPT-MANIFEST.md. */
  promptVersion: string;
  /** Retained detailed body file (filename version is historical only). */
  bodyFile: string;
}

export type PromptStageKey =
  | "reference-analyzer"
  | "visual-blueprint-generator"
  | "original-design-blueprint-generator"
  | "website-generator"
  | "kie-image-prompt-generator"
  | "qa-a-visual-content"
  | "qa-b-browser-technical"
  | "fix-coordinator"
  | "qa-a-confirmation"
  | "qa-b-confirmation"
  | "release-blocker-fix"
  | "realization-repair"
  // Experiment branch only (experiment/simplified-design-pipeline): the
  // SIMPLE design pipeline's four stages. Never invoked by the legacy chain.
  | "simple-design-blueprint"
  | "simple-website-builder"
  | "simple-visual-qa"
  | "simple-site-repair";

export const PROMPT_MANIFEST: Record<PromptStageKey, PromptManifestEntry> = {
  "reference-analyzer": {
    promptId: "reference-analyzer",
    promptVersion: "v3",
    bodyFile: "01-reference-analyzer-v2.md",
  },
  "visual-blueprint-generator": {
    promptId: "visual-blueprint-generator",
    // v5 (issue #59): trait obligation ledger + fidelityPriorities string format.
    promptVersion: "v5",
    bodyFile: "02-visual-blueprint-generator-v2.md",
  },
  "original-design-blueprint-generator": {
    promptId: "original-design-blueprint-generator",
    promptVersion: "v3",
    bodyFile: "03-original-design-blueprint-generator-v2.md",
  },
  "website-generator": {
    promptId: "website-generator",
    promptVersion: "v4",
    bodyFile: "04-website-generator-v3.md",
  },
  "kie-image-prompt-generator": {
    promptId: "kie-image-prompt-generator",
    promptVersion: "v2",
    bodyFile: "05-kie-image-prompt-generator-v1.md",
  },
  "qa-a-visual-content": {
    promptId: "qa-a-visual-content",
    promptVersion: "v4",
    bodyFile: "06-qa-a-visual-content-v2.md",
  },
  "qa-b-browser-technical": {
    promptId: "qa-b-browser-technical",
    promptVersion: "v3",
    bodyFile: "07-qa-b-browser-technical-v2.md",
  },
  "fix-coordinator": {
    promptId: "fix-coordinator",
    promptVersion: "v3",
    bodyFile: "08-fix-coordinator-v2.md",
  },
  "qa-a-confirmation": {
    promptId: "qa-a-confirmation",
    promptVersion: "v3",
    bodyFile: "09-qa-a-confirmation-v2.md",
  },
  "qa-b-confirmation": {
    promptId: "qa-b-confirmation",
    promptVersion: "v3",
    bodyFile: "10-qa-b-confirmation-v2.md",
  },
  "release-blocker-fix": {
    promptId: "release-blocker-fix",
    promptVersion: "v2",
    bodyFile: "11-release-blocker-fix-v1.md",
  },
  // Issue #67: the informed realization repair is a content-preserving patch
  // stage, not full-page regeneration — its contract lives in the stage body.
  "realization-repair": {
    promptId: "realization-repair",
    promptVersion: "v1",
    bodyFile: "12-realization-repair-v1.md",
  },
  // ── SIMPLE design pipeline (experiment branch only) ─────────────────────
  "simple-design-blueprint": {
    promptId: "simple-design-blueprint",
    promptVersion: "v1",
    bodyFile: "simple/01-design-blueprint.md",
  },
  "simple-website-builder": {
    promptId: "simple-website-builder",
    promptVersion: "v1",
    bodyFile: "simple/02-website-builder.md",
  },
  "simple-visual-qa": {
    promptId: "simple-visual-qa",
    promptVersion: "v1",
    bodyFile: "simple/03-visual-qa.md",
  },
  "simple-site-repair": {
    promptId: "simple-site-repair",
    promptVersion: "v1",
    bodyFile: "simple/04-site-repair.md",
  },
};

export class PromptContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptContractError";
  }
}

function requireBody(file: string): string {
  const body = PROMPT_BODY_FILES[file];
  if (typeof body !== "string") {
    throw new PromptContractError(`Prompt body file '${file}' is missing from the generated transport`);
  }
  return body;
}

export function getDomainContractBody(): string {
  return requireBody(DOMAIN_CONTRACT_FILE);
}

export interface ComposedStagePrompt {
  stage: PromptStageKey;
  promptId: string;
  promptVersion: string;
  promptDomainContractVersion: string;
  /** domain contract + retained detailed stage body, in that order. */
  systemPrompt: string;
}

// Composes the runtime stage prompt: the domain contract is prepended and
// stays authoritative over contradictory legacy clauses in the detailed body.
export function composeStagePrompt(stage: PromptStageKey): ComposedStagePrompt {
  const entry = PROMPT_MANIFEST[stage];
  if (!entry) {
    throw new PromptContractError(`Stage '${stage}' has no canonical prompt manifest entry`);
  }
  const contract = getDomainContractBody();
  const body = requireBody(entry.bodyFile);
  return {
    stage,
    promptId: entry.promptId,
    promptVersion: entry.promptVersion,
    promptDomainContractVersion: DOMAIN_CONTRACT_VERSION,
    systemPrompt: `${contract}\n\n---\n\n# Retained detailed stage prompt body (subordinate to the domain contract above)\n\n${body}`,
  };
}
