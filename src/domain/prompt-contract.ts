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
  | "simple-design-blueprint"
  | "simple-website-builder"
  | "simple-visual-qa"
  | "simple-site-repair";

export const PROMPT_MANIFEST: Record<PromptStageKey, PromptManifestEntry> = {
  // v5 (operator GO, 2026-09-10): the design-blueprint/2 contract — required
  // per-page hero spec + required page-hero image briefs; hero slot ids, page
  // ownership and priorities are deterministic, never model bookkeeping.
  "simple-design-blueprint": {
    promptId: "simple-design-blueprint",
    promptVersion: "v5",
    bodyFile: "simple/01-design-blueprint.md",
  },
  // v8 (operator GO 2026-09-11, DOM-FIRST/CSS-LAST VISUAL FIDELITY): the SIX
  // calls reorder to home → about → services → contact → site.css → site.js.
  // Home defines the semantic DOM, the shared chrome and the structural class
  // vocabulary; the inner pages are realized on the frozen chrome +
  // vocabulary; the CSS call STYLES THE ACTUAL FINAL MARKUP of all four
  // completed documents (the CSS-first order made the stylesheet predict
  // markup that did not exist yet — the tested root cause of the 82-score
  // realization failures); site.js stays last. Per-file raw output, no
  // response_format, one tolerated Markdown fence, full GLM-5.3, no
  // Reference screenshots attached — all unchanged. The Blueprint remains the
  // complete, implementation-ready design authority; NO new geometry
  // ontology, region graph, trait ledger or second design-analysis call.
  "simple-website-builder": {
    promptId: "simple-website-builder",
    promptVersion: "v8",
    bodyFile: "simple/02-website-builder.md",
  },
  // v2 (operator GO, 2026-09-09): visual QA verifies photographic hero
  // treatment on every routed page.
  "simple-visual-qa": {
    promptId: "simple-visual-qa",
    promptVersion: "v2",
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
