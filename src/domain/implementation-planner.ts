// V2 Implementation Contract planner (issue #8, PRD section 14).
//
// Deterministic realization plan derived from one Visual Blueprint plus the
// effective Business Facts. The planner may choose technical structure,
// shared CSS/JS architecture, component boundaries, responsive strategy and
// form hooks — but it cannot change topology, signature traits, first
// viewport, image roles or the visual thesis: the contract mirrors those
// verbatim from the Blueprint and any contradiction is surfaced as an
// explicit blocker instead of being silently simplified.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { storeBuildStageArtifact, type StoredStageArtifact } from "./stage-artifacts";
import type { VisualBlueprint } from "./visual-blueprint";
import type { BusinessFacts } from "./lifecycle-schema";

export const IMPLEMENTATION_CONTRACT_SCHEMA_VERSION = "implementation-contract/1";

export const PageIdSchema = Type.Union([
  Type.Literal("home"),
  Type.Literal("about"),
  Type.Literal("services"),
  Type.Literal("contact"),
]);

// PRD section 36: browser code sends only public site/form identity plus
// visitor fields; destination/sender/templates are platform-side.
export const FormContractSchema = Type.Object(
  {
    formServiceEndpoint: Type.String({ pattern: "^https?://", maxLength: 2048 }),
    siteFormId: Type.String({ minLength: 1, maxLength: 200 }),
    fields: Type.Array(Type.Union([Type.Literal("name"), Type.Literal("email"), Type.Literal("message"), Type.Literal("phone"), Type.Literal("subject")])),
    turnstile: Type.Boolean(),
  },
  { additionalProperties: false }
);
export type FormContract = Static<typeof FormContractSchema>;

export const ImplementationContractSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    // Verbatim carry-overs from the Blueprint — the planner may not alter
    // them, and validation below enforces equality.
    blueprintVisualThesis: Type.String({ minLength: 1 }),
    blueprintSignatureTraitIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    blueprintFirstViewportRegionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    pages: Type.Array(
      Type.Object({
        id: PageIdSchema,
        path: Type.String({ minLength: 1, maxLength: 200 }),
        // Home mirrors the Blueprint homepage region order exactly; inner
        // pages derive from the Blueprint inner-page vocabulary.
        regions: Type.Array(
          Type.Object({ id: Type.String({ minLength: 1 }), realization: Type.String({ minLength: 1 }) })
        ),
      }),
      { minItems: 4, maxItems: 4 }
    ),
    files: Type.Object({
      sharedCss: Type.String({ minLength: 1 }),
      sharedJs: Type.String({ minLength: 1 }),
      pageFiles: Type.Record(Type.String(), Type.String()),
    }),
    tokens: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
    components: Type.Array(Type.Unknown()),
    responsiveStrategy: Type.Unknown(),
    imageSlotStrategy: Type.Unknown(),
    formContract: FormContractSchema,
    approvedDependencies: Type.Array(Type.String()),
    blockers: Type.Array(Type.Unknown()),
  },
  { additionalProperties: false }
);
export type ImplementationContract = Static<typeof ImplementationContractSchema>;

export class ImplementationPlannerError extends Error {
  readonly code: "CONTRACT_CONTRADICTS_BLUEPRINT" | "ARTIFACT_ALREADY_EXISTS";

  constructor(code: ImplementationPlannerError["code"], message: string) {
    super(message);
    this.name = "ImplementationPlannerError";
    this.code = code;
  }
}

// The contract cannot change topology, signature traits, first viewport,
// image roles or visual thesis (PRD section 14).
export function validateContractAgainstBlueprint(
  contract: ImplementationContract,
  blueprint: VisualBlueprint
): { valid: true } | { valid: false; problems: string[] } {
  const problems: string[] = [];
  if (contract.blueprintVisualThesis !== blueprint.visualThesis) {
    problems.push("visual thesis was altered");
  }
  const blueprintTraitIds = blueprint.signatureTraits.map((trait) => trait.id);
  if (
    contract.blueprintSignatureTraitIds.length !== blueprintTraitIds.length ||
    !contract.blueprintSignatureTraitIds.every((id, index) => id === blueprintTraitIds[index])
  ) {
    problems.push("signature traits were added, removed or reordered");
  }
  const home = contract.pages.find((page) => page.id === "home");
  if (!home) {
    problems.push("home page missing");
  } else {
    const blueprintRegionIds = blueprint.homepageRegions.map((region) => region.id);
    const contractRegionIds = home.regions.map((region) => region.id);
    if (
      contractRegionIds.length !== blueprintRegionIds.length ||
      !contractRegionIds.every((id, index) => id === blueprintRegionIds[index])
    ) {
      problems.push("homepage topology (region order) was changed");
    }
    if (
      !contract.blueprintFirstViewportRegionIds.every(
        (id, index) => blueprint.homepageFirstViewport.regionIds[index] === id
      ) ||
      contract.blueprintFirstViewportRegionIds.length !== blueprint.homepageFirstViewport.regionIds.length
    ) {
      problems.push("first viewport was changed");
    }
  }
  const imageSlotStrategy = contract.imageSlotStrategy as { roleIds?: string[] } | null;
  if (imageSlotStrategy && Array.isArray(imageSlotStrategy.roleIds)) {
    const blueprintRoleIds = new Set(blueprint.imageSystem.imageRoles.map((role) => role.id));
    for (const roleId of imageSlotStrategy.roleIds) {
      if (!blueprintRoleIds.has(roleId)) {
        problems.push(`image role '${roleId}' was invented or changed`);
      }
    }
  }
  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

export interface PlanImplementationContractInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  /** Stable Site identity backing the public form identifier. */
  siteId: string;
  blueprint: VisualBlueprint;
  facts: BusinessFacts;
  formServiceBaseurl?: string;
}

// Deterministic planner: no AI. Where realization would be impossible inside
// the capability envelope, an explicit blocker is recorded rather than
// silently simplifying the Blueprint.
export function planImplementationContract(input: PlanImplementationContractInput): ImplementationContract {
  const blockers: unknown[] = [];

  const homepageRegionIds = input.blueprint.homepageRegions.map((region) => region.id);
  const imageRoleIds = input.blueprint.imageSystem.imageRoles.map((role) => role.id);
  for (const region of input.blueprint.homepageRegions) {
    if (region.imageRoleId && !imageRoleIds.includes(region.imageRoleId)) {
      blockers.push({ kind: "BLUEPRINT_REGION_IMAGE_ROLE_UNKNOWN", regionId: region.id, imageRoleId: region.imageRoleId });
    }
  }

  // Page-aware inner-page composition (issue #45): the inner pages share ONE
  // design language — the Blueprint's innerPageVocabulary — but must not be
  // clones. Each page realizes a page-appropriate composition from that
  // vocabulary: About is narrative, Services leads with its offer and repeats
  // its content band, Contact is short and form-led. When the Blueprint's
  // vocabulary uses different tokens, a deterministic per-page rotation keeps
  // the pages distinct without inventing design language.
  const INNER_PAGE_COMPOSITION: Record<"about" | "services" | "contact", string[]> = {
    about: ["page-header", "content-section", "fact-list", "cta-band"],
    services: ["page-header", "content-section", "fact-list", "content-section", "cta-band"],
    contact: ["page-header", "content-section", "cta-band"],
  };
  const INNER_PAGE_ROTATION: Record<"about" | "services" | "contact", number> = {
    about: 0,
    services: 1,
    contact: 2,
  };
  const innerPageTemplate = (pageId: "about" | "services" | "contact", vocabulary: string[]) => {
    const desired = INNER_PAGE_COMPOSITION[pageId];
    const realized = desired.every((entry) => vocabulary.includes(entry))
      ? desired
      : vocabulary.map((_, index) => vocabulary[(index + INNER_PAGE_ROTATION[pageId]) % vocabulary.length]);
    return {
      id: pageId,
      path: `/${pageId}`,
      regions: realized.map((entry, index) => ({
        id: `${pageId}-region-${index + 1}`,
        realization: entry,
      })),
    };
  };

  const contract: ImplementationContract = {
    version: "1",
    blueprintVisualThesis: input.blueprint.visualThesis,
    blueprintSignatureTraitIds: input.blueprint.signatureTraits.map((trait) => trait.id),
    blueprintFirstViewportRegionIds: [...input.blueprint.homepageFirstViewport.regionIds],
    pages: [
      {
        id: "home",
        path: "/",
        regions: homepageRegionIds.map((id) => ({ id, realization: "section" })),
      },
      innerPageTemplate("about", input.blueprint.innerPageVocabulary),
      innerPageTemplate("services", input.blueprint.innerPageVocabulary),
      innerPageTemplate("contact", input.blueprint.innerPageVocabulary),
    ],
    files: {
      sharedCss: "site.css",
      sharedJs: "site.js",
      pageFiles: {
        home: "index.html",
        about: "about.html",
        services: "services.html",
        contact: "contact.html",
      },
    },
    tokens: { ...input.blueprint.tokens },
    components: [
      { id: "site-header", realizes: "headerNavigation" },
      { id: "site-footer", realizes: "innerPageVocabulary/footer" },
    ],
    responsiveStrategy: {
      contract: input.blueprint.responsiveContract,
      implementation: "fluid grid + breakpoint overrides from Blueprint responsive contract",
    },
    imageSlotStrategy: { roleIds: imageRoleIds },
    formContract: {
      formServiceEndpoint: `${input.formServiceBaseurl ?? "https://forms.wazibiz.example"}/api/v2/forms/submit`,
      siteFormId: `site:${input.siteId}`,
      fields: ["name", "email", "message"],
      turnstile: false,
    },
    approvedDependencies: [],
    blockers,
  };
  return contract;
}

export async function produceImplementationContract(
  env: Env,
  input: PlanImplementationContractInput
): Promise<StoredStageArtifact & { contract: ImplementationContract }> {
  const contract = planImplementationContract(input);

  const validation = validateContractAgainstBlueprint(contract, input.blueprint);
  if (!validation.valid) {
    throw new ImplementationPlannerError(
      "CONTRACT_CONTRADICTS_BLUEPRINT",
      `Implementation Contract contradicts the Visual Blueprint: ${validation.problems.join("; ")}`
    );
  }
  if (!Value.Check(ImplementationContractSchema, contract)) {
    throw new ImplementationPlannerError("CONTRACT_CONTRADICTS_BLUEPRINT", "Planned contract failed its versioned schema");
  }

  const stored = await storeBuildStageArtifact(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "implementation_contract",
    schemaVersion: IMPLEMENTATION_CONTRACT_SCHEMA_VERSION,
    value: contract,
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "BLUEPRINT",
    toState: "IMPLEMENTATION_PLAN",
    stage: "implementation_plan",
    detail: `Implementation Contract planned (${contract.pages.length} pages${contract.blockers.length ? `, ${contract.blockers.length} blocker(s) surfaced` : ""})`,
  });

  return { ...stored, contract };
}

export function parseImplementationContract(raw: unknown): ImplementationContract | null {
  return Value.Check(ImplementationContractSchema, raw) ? (raw as ImplementationContract) : null;
}
