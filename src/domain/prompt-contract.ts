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
  | "simple-original-design-blueprint"
  | "simple-website-builder"
  | "simple-visual-qa"
  | "simple-original-design-visual-qa"
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
  // v1 (issue #24, operator GO 2026-09-12): the ORIGINAL_DESIGN Blueprint —
  // Business Facts + Creative Direction in, NO Reference attached. Outputs the
  // SAME design-blueprint/2 schema as the reference mode, so all downstream
  // code stays shared. The Creative Thesis lives in projectFrame.
  "simple-original-design-blueprint": {
    promptId: "simple-original-design-blueprint",
    promptVersion: "v1",
    bodyFile: "simple/05-original-design-blueprint.md",
  },
  // v10 (operator GO 2026-11-10): TOUCH TARGETS (44x36 minimum for every
  // interactive control) + MOBILE COMPOSITION (marker systems must connect
  // to what they mark on mobile) hard requirements added; backed by the
  // TAP_TARGET_TOO_SMALL deterministic gate in bundle QA. Everything from
  // v9 unchanged.
  // v9 (operator GO 2026-11-09): COPY STYLE hard requirement added — no em
  // dash (—) or en dash (–) anywhere in page copy (headings, body, CTAs,
  // labels, alt text, title, meta description); no stock AI phrasing. Backed
  // deterministically by the COPY_STYLE_EMDASH technical check in bundle QA.
  // Everything else unchanged from v8 (operator GO 2026-09-11,
  // DOM-FIRST/CSS-LAST VISUAL FIDELITY): the SIX
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
    promptVersion: "v10",
    bodyFile: "simple/02-website-builder.md",
  },
  // v3 (operator GO, 2026-11-09): visual QA attaches and judges the desktop
  // render of EVERY routed page (home, about, services, contact), not only
  // home; hero treatment per page remains a finding.
  "simple-visual-qa": {
    promptId: "simple-visual-qa",
    promptVersion: "v4",
    bodyFile: "simple/03-visual-qa.md",
  },
  // v2 (operator GO, 2026-11-09): all-page candidate renders attached and
  // judged, same as simple-visual-qa v3.
  "simple-original-design-visual-qa": {
    promptId: "simple-original-design-visual-qa",
    promptVersion: "v3",
    bodyFile: "simple/06-original-design-visual-qa.md",
  },
  // v3 (operator GO 2026-11-09): the repair is MULTIMODAL — the candidate's
  // rendered screenshots (all routed pages) and the Reference are attached,
  // so it repairs a render it can see; structural-defect rule added (HTML
  // changes required for composition findings; v2's COPY STYLE rule kept).
  "simple-site-repair": {
    promptId: "simple-site-repair",
    promptVersion: "v3",
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
