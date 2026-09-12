// SIMPLE stage 4: the ONE site repair (spec sections 49-53).
//
// Maximum ONE semantic repair call per Build. The repair agent is one
// coherent owner of HTML/CSS/JS; its preservation set (Business Facts,
// contact details, form contract, Accepted Image identities, Blueprint
// direction) is frozen. The output is the COMPLETE repaired bundle stored as
// a new immutable Build Version's site bundle — never a mutation of the
// failed version.

import type { Env } from "../env.d";
import { getObject } from "../lib/assets";
import {
  runSchemaValidatedAiStage,
  type AiProvenance,
  type RawAiGenerate,
} from "../domain/ai-boundary";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "../domain/stage-artifacts";
import { Type } from "@sinclair/typebox";
import type { BusinessFacts } from "../domain/lifecycle-schema";
import {
  SITE_BUNDLE_SCHEMA_VERSION,
  type DesignBlueprintV2,
  type QaPackage,
  type SiteBundle,
} from "./contracts";
import { bytesToBase64, mimeForKey } from "./vision";
import { generateZaiCodingPlan, resolveCodingModel } from "../lib/zai-coding-plan";
import { SIMPLE_PAGE_FILES } from "./bundle-qa";
import type { SimpleBuilderVisualInput } from "./contracts";

export class SimpleRepairBudgetExceededError extends Error {
  constructor() {
    super("the SIMPLE pipeline allows at most ONE semantic repair call per Build");
    this.name = "SimpleRepairBudgetExceededError";
  }
}

// Changed-files repair (benchmark hardening F3): the repair owns HTML/CSS/JS
// conceptually, but re-emitting the complete ~100K-char bundle exceeded the
// streaming output budget. The repair still RECEIVES the complete current
// bundle as context; it returns ONLY the files it changes, which are merged
// deterministically over the immutable bundle to form the repaired Build
// Version. Allowed paths are the six bundle files — nothing else.
export const REPAIR_ALLOWED_PATHS = ["index.html", "about.html", "services.html", "contact.html", "site.css", "site.js"] as const;
export type RepairFilePath = (typeof REPAIR_ALLOWED_PATHS)[number];
export const SITE_REPAIR_FILES_SCHEMA_VERSION = "site-repair-files/1";

export const RepairedFilesSchema = Type.Object(
  {
    files: Type.Array(
      Type.Object(
        {
          path: Type.Union(REPAIR_ALLOWED_PATHS.map((path) => Type.Literal(path))),
          content: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: REPAIR_ALLOWED_PATHS.length }
    ),
    notes: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

export interface RepairedFile {
  path: RepairFilePath;
  content: string;
}

const REPAIR_FILE_TO_PAGE: Record<string, keyof SiteBundle["pages"]> = {
  "index.html": "home",
  "about.html": "about",
  "services.html": "services",
  "contact.html": "contact",
};

// Deterministic merge over the immutable bundle: untouched files are
// preserved byte-for-byte; duplicates apply in order (last wins). A missing
// file can never delete an existing bundle file.
export function mergeRepairedFiles(
  bundle: SiteBundle,
  files: RepairedFile[]
): { bundle: SiteBundle; changedPaths: RepairFilePath[] } {
  const pages = { ...bundle.pages };
  let sharedCss = bundle.sharedCss;
  let sharedJs = bundle.sharedJs;
  const changed = new Set<RepairFilePath>();
  for (const file of files) {
    const page = REPAIR_FILE_TO_PAGE[file.path];
    if (page) pages[page] = file.content;
    else if (file.path === "site.css") sharedCss = file.content;
    else sharedJs = file.content;
    changed.add(file.path);
  }
  return {
    bundle: {
      version: bundle.version,
      pages,
      sharedCss,
      sharedJs,
      notes: `ONE repair, changed files only: ${[...changed].join(", ")}`,
    },
    changedPaths: [...changed],
  };
}

export interface RunSimpleSiteRepairInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  bundle: SiteBundle;
  blueprint: DesignBlueprintV2;
  facts: BusinessFacts;
  qaPackage: QaPackage;
  acceptedImages: Array<{ slotId: string; altText: string; aspectRatio: string }>;
  formServiceEndpoint: string;
  siteFormId: string;
  referenceVisualInputs: SimpleBuilderVisualInput[];
  candidateDesktopR2Key?: string;
  candidateMobileR2Key?: string;
  generate?: RawAiGenerate;
}

export interface SimpleSiteRepairResult {
  bundle: SiteBundle;
  artifactR2Key: string;
  provenance: AiProvenance | null;
  changedPaths: RepairFilePath[];
}

// SIMPLE repair seam (operator GO 2026-09-11, ZAI CODING PLAN UNIFICATION
// §26; live §28 evidence 2026-09-11): the repair runs on the ONE Coding Plan
// provider with the coding model (glm-5.3) — stream: true, thinking disabled,
// json_object mode. TEXT-ONLY, always: on the Coding Plan endpoint glm-5.3
// rejects non-text content parts with 400 "messages.content.type is invalid,
// allowed values: ['text']" (multimodal on this endpoint is glm-5.3-flash per
// the §9 canary; the repair's model routing is glm-5.3 per GO §27). The
// repair's visual context is carried by the QA package's textual findings and
// the prompt's textual image manifest. No Workers AI, no AI Gateway, no
// provider fallback.
function simpleRepairGenerate(
  env: Env,
  _images: Array<{ base64: string; mimeType: string }>,
  meta: { stage: string; buildId: string }
): RawAiGenerate {
  const model = resolveCodingModel(env);
  return async (systemPrompt, userPrompt, attempt) => {
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    const result = await generateZaiCodingPlan(env, {
      model,
      messages,
      maxTokens: 32000,
      stream: true,
      jsonMode: true,
      label: `${meta.stage}#${attempt}`,
    });
    return { content: result.content, provider: result.provider, model: result.model, finishReason: result.finishReason, reasoningControl: "thinking.type=disabled" };
  };
}

// The files the deterministic findings implicate: finding details are
// prefixed with the page id ("home: …"), mapped to bundle files; shared-file
// findings map to their own file (site.css / the contact form contract).
// Any finding that names NO known target could implicate anything, so the
// repair is told it owns the whole bundle.
const SHARED_CSS_FINDING_IDS = new Set(["CONTENT_HIDDEN_WITHOUT_JS", "REDUCED_MOTION_MISSING", "FOCUS_VISIBLE_MISSING", "PAGE_HORIZONTAL_OVERFLOW"]);
const FORM_CONTRACT_FINDING_IDS = new Set(["FORM_CONTRACT_FAILURE"]);

export function failedFilesFromQaPackage(pkg: QaPackage): string[] {
  const allFiles = Object.values(SIMPLE_PAGE_FILES);
  const files = new Set<string>();
  let unattributable = false;
  for (const finding of [...pkg.technical.findings, ...pkg.truth.findings]) {
    const page = /^(home|about|services|contact):/.exec(finding.detail)?.[1];
    if (page) {
      files.add(SIMPLE_PAGE_FILES[page as keyof typeof SIMPLE_PAGE_FILES]);
    } else if (SHARED_CSS_FINDING_IDS.has(finding.id)) {
      files.add("site.css");
    } else if (FORM_CONTRACT_FINDING_IDS.has(finding.id)) {
      files.add("contact.html");
    } else {
      unattributable = true;
    }
  }
  if (files.size === 0 || unattributable) return allFiles;
  const ordered = [...allFiles, "site.css", "site.js"] as string[];
  return ordered.filter((file) => files.has(file));
}

// Exported for regression tests: the repair must always receive the COMPLETE
// current bundle as context even though it returns only changed files.
export function buildRepairUserPrompt(input: RunSimpleSiteRepairInput): string {
  const images = input.acceptedImages
    .map((image) => `- ${image.slotId} [${image.aspectRatio}] — alt: ${image.altText}`)
    .join("\n");
  const failedFiles = failedFilesFromQaPackage(input.qaPackage);
  const visualMode = input.candidateDesktopR2Key
    ? "Attached images, in order: 1) REFERENCE desktop, 2) CANDIDATE desktop current render, then reference/candidate mobile when available. "
    : "MODE: deterministic preflight-failure repair. The candidate below was rejected BEFORE rendering — no screenshots exist and none are required. Fix the exact deterministic findings in the failed files listed; do not redesign. ";
  return `CURRENT SITE BUNDLE (complete repair context — you own HTML/CSS/JS whole):
${JSON.stringify(input.bundle)}

QA PACKAGE (complete repair brief):
${JSON.stringify(input.qaPackage)}

DESIGN BLUEPRINT (unchanged design authority — preserve its direction):
${JSON.stringify(input.blueprint)}

PRESERVATION SET (absolute — spec section 50): Business Facts below, contact details, Accepted Image identities (IMG: slot mappings), Blueprint design direction, and the FORM CONTRACT exactly:
- form action: ${input.formServiceEndpoint}
- hidden input: <input type="hidden" name="siteFormId" value="${input.siteFormId}">
- fields exactly: name, email, message with labels; no other delivery-control fields

ACCEPTED IMAGES (unchanged mappings): 
${input.acceptedImages.length > 0 ? images : "(none — keep the bundle image-free)"}

BUSINESS FACTS (unchanged content authority):
${JSON.stringify(input.facts)}

FAILED FILES (deterministic findings implicate these): ${failedFiles.join(", ")}

PROGRESSIVE ENHANCEMENT (hard rule, preserve or restore it): all content stays fully visible in plain HTML+CSS with JavaScript disabled; scroll/entrance animation only animates already-visible elements, and prefers-reduced-motion: reduce keeps everything visible.

${visualMode}Fix the highest-impact visual findings first; clear every truth and technical finding. Smallest coherent change set that materially increases fidelity.

OUTPUT (changed files only): return {"files":[{"path":"...","content":"..."}]} — the COMPLETE new content of ONLY the files you change. Allowed paths exactly: index.html, about.html, services.html, contact.html, site.css, site.js. At least one file; omit every unchanged file; never invent paths. Each changed file must be the full final version of that file.`;
}

export async function runSimpleSiteRepairStage(env: Env, input: RunSimpleSiteRepairInput): Promise<SimpleSiteRepairResult> {
  // The caller (pipeline) owns the budget truth: it must have already proven
  // via D1 that this Build has no repair site bundle yet. This guard keeps a
  // miswired caller honest; the pipeline check is the authoritative one.
  const existing = await getBuildStageArtifact<SiteBundle>(env, input.buildVersionId, "site_bundle");
  if (existing) {
    // This version already HAS its (repaired) bundle — reuse, never re-repair.
    const changedPaths = existing.value.notes?.startsWith("ONE repair, changed files only:")
      ? (existing.value.notes.replace("ONE repair, changed files only: ", "").split(", ") as RepairFilePath[])
      : [];
    return { bundle: existing.value, artifactR2Key: existing.artifactR2Key, provenance: existing.provenance, changedPaths };
  }

  const images: Array<{ base64: string; mimeType: string }> = [];
  const referenceFullPage =
    input.referenceVisualInputs.find((entry) => entry.kind === "full-page") ?? input.referenceVisualInputs[0];
  if (input.candidateDesktopR2Key) {
    for (const [key, mime] of [
      [referenceFullPage.artifact, mimeForKey(referenceFullPage.artifact)],
      [input.candidateDesktopR2Key, "image/png"],
      ...(input.candidateMobileR2Key ? [[input.candidateMobileR2Key, "image/png"] as const] : []),
    ] as Array<[string, string]>) {
      const body = await getObject(env, key);
      if (!body) continue;
      images.push({ base64: bytesToBase64(new Uint8Array(await new Response(body).arrayBuffer())), mimeType: mime });
    }
  }

  // Pinned SIMPLE transport with or without renders (see simpleRepairGenerate);
  // an injected test seam always wins.
  const generate: RawAiGenerate =
    input.generate ??
    simpleRepairGenerate(env, images, { stage: "simple-site-repair", buildId: input.buildId });

  const run = await runSchemaValidatedAiStage<unknown>(env, {
    stage: "simple-site-repair",
    schema: RepairedFilesSchema,
    schemaVersion: SITE_REPAIR_FILES_SCHEMA_VERSION,
    userPrompt: buildRepairUserPrompt(input),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [referenceFullPage.sha256],
    // The pinned SIMPLE seam (or the injected test seam) is always present —
    // there is no default provider path anywhere in the boundary.
    generate,
  });

  const repairedFiles = (run.value as { files: RepairedFile[] }).files;
  const { bundle, changedPaths } = mergeRepairedFiles(input.bundle, repairedFiles);
  // Stored on the NEW Build Version the pipeline created for this repair —
  // a material repair is a new immutable Build Version, never a mutation.
  const stored = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "site_bundle",
    schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    value: bundle,
    provenance: run.provenance,
  });
  return { bundle, artifactR2Key: stored.artifactR2Key, provenance: run.provenance, changedPaths };
}
