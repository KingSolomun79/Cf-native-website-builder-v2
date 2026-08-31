import type {
  NormalizedIntake,
  ApprovedSourceFactV1,
  ProvenanceClaimV1,
  ProvenanceManifestV1,
  ProvenancePageEvidenceV1,
  ProvenanceSourceV1,
  ProvenanceValidationIssue,
  ProvenanceValidationResult,
  SiteSpec,
} from "../types";
import type { RenderContent } from "../render/primitives";

export interface ProvenanceBlockInput {
  path: string;
  text: string;
  page?: string;
}

export interface BuildProvenanceInput {
  jobId: string;
  siteId: string;
  clientSlug: string;
  siteVersion: number;
  intake: NormalizedIntake;
  blocks: ProvenanceBlockInput[];
  createdAt?: string;
  parentArtifactId?: string | null;
  approvedSources?: ApprovedSourceFactV1[];
}

interface SourceCandidate {
  source: ProvenanceSourceV1;
  value: string;
}

const HIGH_RISK_PATTERNS = [
  /\b\d+(?:[.,]\d+)?\s*(?:%|percent|years?|clients?|projects?|programs?|locations?|countries?|awards?|members?|students?|patients?|employees?)\b/i,
  /\b(?:19|20)\d{2}\b/,
  /\b(?:testimonial|reviewed by|five[- ]star|rated|client says|customer says)\b/i,
  /\b(?:certified|accredited|licensed|registered|credentialed|iso\s*\d+|award(?:ed|[- ]winning)?)\b/i,
  /\b(?:partner(?:ed|ship)?|affiliated|endorsed|sponsored)\s+(?:with|by)\b/i,
  /\b(?:founded|established|incorporated|nonprofit|non-profit|ngo|charity)\b/i,
  /\b(?:largest|leading|number one|#1|best-in-class|industry-leading)\b/i,
  /\b(?:street|road|avenue|boulevard|lane|county|city|postal code|zip code)\b/i,
  /\b(?:eligibility|cohort|curriculum|tuition|scholarship|enrolment|enrollment|programme details|program details)\b/i,
];

const FACTUAL_PATTERNS = [
  /\b(?:we|our\s+(?:team|business|company|organization|organisation|studio|agency|practice)|the\s+(?:team|business|company|organization|organisation|studio|agency|practice))\s+(?:are|is|has|have|helps?|supports?|creates?|makes?|builds?|provides?|offers?|serves?|operates?|works?|delivers?|specializes?|specialises?)\b/i,
  /\b(?:based|located|headquartered)\s+(?:in|at)\b/i,
  /\b(?:trusted|recognized|recognised|endorsed|sponsored)\s+by\b/i,
  /\b(?:member|winner|recipient)\s+of\b/i,
  /\b(?:clients?|customers?|students?|patients?)\s+(?:receive|get|benefit|can expect)\b/i,
];

const NON_FACTUAL_LABELS = new Set(["who we are"]);

const SAFE_DERIVED_PHRASES = [
  "all rights reserved",
  "business details",
  "business focus",
  "common questions",
  "contact information",
  "follow us",
  "get in touch with",
  "how do i contact",
  "intended clients",
  "learn more about",
  "reach us directly",
  "see all",
  "use the contact page to ask about its location",
  "use the contact page to send an enquiry",
  "what do you offer",
  "where are you located",
];

const SAFE_DERIVED_WORDS = new Set([
  "about",
  "address",
  "and",
  "business",
  "contact",
  "copyright",
  "email",
  "home",
  "location",
  "mailto",
  "our",
  "phone",
  "service",
  "services",
  "tel",
  "the",
]);

const CLIENT_FIELDS: Array<[keyof NormalizedIntake, string]> = [
  ["companyName", "companyName"],
  ["clientEmail", "clientEmail"],
  ["businessType", "businessType"],
  ["businessDescription", "businessDescription"],
  ["idealClientProfile", "idealClientProfile"],
  ["addressLine1", "addressLine1"],
  ["addressLine2", "addressLine2"],
  ["city", "city"],
  ["county", "county"],
  ["zipCode", "zipCode"],
  ["country", "country"],
  ["facebookUrl", "facebookUrl"],
  ["instagramUrl", "instagramUrl"],
  ["twitterUrl", "twitterUrl"],
  ["linkedinUrl", "linkedinUrl"],
  ["otherSocialUrl", "otherSocialUrl"],
  ["extraInformation", "extraInformation"],
  ["whatsappNumber", "whatsappNumber"],
];

function normalizeText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|copy);/gi, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? "";
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sourceMatchesBlock(sourceValue: string, blockText: string): boolean {
  const source = normalizeText(sourceValue);
  const block = normalizeText(blockText);
  if (!source || !block) return false;
  if (source === block) return true;
  if (source.length >= 4) return block.includes(source);
  return new RegExp(`(?:^|\\W)${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\W)`, "i").test(block);
}

function sourceExactlyMatchesBlock(sourceValue: string, blockText: string): boolean {
  return normalizeText(sourceValue) === normalizeText(blockText);
}

function supportsDerivedBlock(blockText: string, candidates: SourceCandidate[]): boolean {
  let residual = normalizeText(blockText)
    .replace(/(?:©|copyright)\s*(?:19|20)\d{2}/gi, " copyright ");
  const sourceValues = candidates
    .map((candidate) => normalizeText(candidate.value))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const sourceValue of sourceValues) {
    residual = residual.replace(new RegExp(sourceValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  for (const phrase of SAFE_DERIVED_PHRASES) {
    residual = residual.replace(new RegExp(`\\b${phrase.split(/\s+/).join("\\W+")}\\b`, "gi"), " ");
  }
  const remainingWords = residual.match(/[a-z0-9]+/g) ?? [];
  return remainingWords.every((word) => SAFE_DERIVED_WORDS.has(word));
}

function isHighRisk(text: string): boolean {
  const withoutCopyrightYear = text.replace(/(?:©|copyright)\s*(?:19|20)\d{2}/gi, "");
  return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(withoutCopyrightYear));
}

function isFactualAssertion(text: string): boolean {
  if (NON_FACTUAL_LABELS.has(normalizeText(text))) return false;
  return FACTUAL_PATTERNS.some((pattern) => pattern.test(text));
}

async function buildSources(input: BuildProvenanceInput): Promise<SourceCandidate[]> {
  const candidates: SourceCandidate[] = [];
  const extractedAt = input.createdAt ?? new Date().toISOString();
  for (const [field, location] of CLIENT_FIELDS) {
    const raw = input.intake[field];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    candidates.push({
      value: raw.trim(),
      source: {
        id: `client:${location}`,
        type: "client_input",
        location: `intake.${location}`,
        extractedAt,
        confidence: null,
        valueHash: await sha256(normalizeText(raw)),
      },
    });
  }
  for (const approved of input.approvedSources ?? input.intake.approvedSourceFacts ?? []) {
    if (!approved.value.trim()) continue;
    candidates.push({
      value: approved.value.trim(),
      source: {
        id: `approved:${approved.id}`,
        type: "approved_source",
        location: approved.location,
        extractedAt: approved.extractedAt,
        confidence: approved.confidence ?? null,
        valueHash: await sha256(normalizeText(approved.value)),
      },
    });
  }
  return candidates;
}

export async function buildProvenanceManifest(input: BuildProvenanceInput): Promise<ProvenanceManifestV1> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const candidates = await buildSources({ ...input, createdAt });
  const claims: ProvenanceClaimV1[] = [];
  for (let index = 0; index < input.blocks.length; index++) {
    const block = input.blocks[index];
    const text = block.text.trim();
    if (!text) continue;
    const matched = candidates.filter((candidate) => sourceMatchesBlock(candidate.value, text));
    const highRisk = isHighRisk(text);
    const factualAssertion = isFactualAssertion(text);
    const exactMatches = matched.filter((candidate) => sourceExactlyMatchesBlock(candidate.value, text));
    const supportingSources = exactMatches.length > 0
      ? exactMatches
      : supportsDerivedBlock(text, matched)
        ? matched
        : [];
    const factual = matched.length > 0 || highRisk || factualAssertion;
    claims.push({
      id: `claim:${input.siteVersion}:${index + 1}`,
      path: block.path,
      textHash: await sha256(normalizeText(text)),
      classification: factual ? "factual" : "marketing",
      risk: highRisk ? "high" : "standard",
      status: factual && supportingSources.length === 0 ? "unsupported" : "accepted",
      sourceIds: supportingSources.map((candidate) => candidate.source.id),
    });
  }
  const pageEvidence = await buildPageEvidence(input.blocks);
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    jobId: input.jobId,
    siteId: input.siteId,
    clientSlug: input.clientSlug,
    siteVersion: input.siteVersion,
    parentArtifactId: input.parentArtifactId ?? null,
    createdAt,
    sources: candidates.map((candidate) => candidate.source),
    claims,
    pageEvidence,
  };
}

async function buildPageEvidence(blocks: ProvenanceBlockInput[]): Promise<ProvenancePageEvidenceV1[]> {
  const grouped = new Map<string, string[]>();
  for (const block of blocks) {
    if (!block.page || !block.text.trim()) continue;
    const values = grouped.get(block.page) ?? [];
    values.push(normalizeText(block.text));
    grouped.set(block.page, values);
  }
  const evidence: ProvenancePageEvidenceV1[] = [];
  for (const [page, values] of grouped) {
    evidence.push({ page, textHash: await sha256(values.join("\n")), blockCount: values.length });
  }
  return evidence.sort((a, b) => a.page.localeCompare(b.page));
}

export function validateProvenanceManifest(manifest: ProvenanceManifestV1 | null | undefined): ProvenanceValidationResult {
  const issues: ProvenanceValidationIssue[] = [];
  if (!manifest || manifest.schemaVersion !== 1) {
    return {
      valid: false,
      blocking: true,
      issues: [{
        id: "provenance:manifest-missing",
        severity: "critical",
        code: "PROVENANCE_MANIFEST_MISSING",
        path: "provenance",
        claimId: null,
        message: "A valid provenance manifest is required.",
        recommendedFix: "Rebuild provenance from accepted client or approved-source inputs.",
      }],
    };
  }
  const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
  const sourceIds = new Set<string>();
  for (const source of manifest.sources) {
    if (sourceIds.has(source.id)) {
      issues.push({
        id: `provenance:duplicate-source:${source.id}`,
        severity: "critical",
        code: "PROVENANCE_DUPLICATE_SOURCE",
        path: source.location,
        claimId: null,
        message: "Duplicate provenance source identifier.",
        recommendedFix: "Rebuild the source catalog with unique identifiers.",
      });
    }
    sourceIds.add(source.id);
    if (!source.location || !source.extractedAt || !["client_input", "approved_source", "reference_design"].includes(source.type) || !/^[a-f0-9]{64}$/.test(source.valueHash) || (source.confidence !== null && (source.confidence < 0 || source.confidence > 1))) {
      issues.push({
        id: `provenance:invalid-source:${source.id}`,
        severity: "critical",
        code: "PROVENANCE_INVALID_SOURCE",
        path: source.location || "provenance.sources",
        claimId: null,
        message: "A provenance source is missing required metadata or has an invalid confidence/hash value.",
        recommendedFix: "Store source identifier, type, location, extraction timestamp, confidence, and a valid value hash.",
      });
    }
  }
  const claimIds = new Set<string>();
  for (const claim of manifest.claims) {
    if (claimIds.has(claim.id)) {
      issues.push(issueFor(claim, "PROVENANCE_DUPLICATE_CLAIM", "Duplicate provenance claim identifier.", "Rebuild the manifest with unique claim identifiers."));
    }
    claimIds.add(claim.id);
    if (claim.classification === "marketing" && claim.sourceIds.length > 0) {
      issues.push(issueFor(claim, "PROVENANCE_MARKETING_HAS_SOURCES", "Marketing language must remain distinguishable from factual assertions.", "Remove factual source references from the marketing block."));
    }
    if (claim.classification === "factual") {
      const acceptedSources = claim.sourceIds.map((id) => sourceById.get(id)).filter((source): source is ProvenanceSourceV1 => !!source && source.type !== "reference_design");
      if (claim.status === "unsupported" || acceptedSources.length === 0) {
        issues.push(issueFor(claim, "PROVENANCE_UNSUPPORTED_FACT", "A factual assertion has no accepted client or approved-source record.", "Omit the claim or attach an accepted source before rendering."));
      }
      if (claim.sourceIds.some((id) => sourceById.get(id)?.type === "reference_design")) {
        issues.push(issueFor(claim, "PROVENANCE_REFERENCE_AS_CLIENT_FACT", "Reference-design content cannot establish a fact about the client.", "Use the reference only for design evidence and source the claim from client input or an approved source."));
      }
    }
  }
  return { valid: issues.length === 0, blocking: issues.length > 0, issues };
}

function issueFor(claim: ProvenanceClaimV1, code: string, message: string, recommendedFix: string): ProvenanceValidationIssue {
  return {
    id: `provenance:${claim.id}:${code.toLowerCase()}`,
    severity: claim.risk === "high" ? "critical" : "major",
    code,
    path: claim.path,
    claimId: claim.id,
    message,
    recommendedFix,
  };
}

function collectStrings(value: unknown, path: string, blocks: ProvenanceBlockInput[], page?: string): void {
  if (typeof value === "string") {
    if (value.trim()) blocks.push({ path, text: value, page });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, blocks, page));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "provenance" || key === "provenanceClaimIds" || key === "sourceFields") continue;
    collectStrings(nested, `${path}.${key}`, blocks, page);
  }
}

export function extractSiteSpecBlocks(spec: SiteSpec): ProvenanceBlockInput[] {
  const blocks: ProvenanceBlockInput[] = [];
  collectStrings(spec.site, "site", blocks);
  for (let pageIndex = 0; pageIndex < spec.pages.length; pageIndex++) {
    const page = spec.pages[pageIndex];
    collectStrings({ name: page.name, seoTitle: page.seoTitle, metaDescription: page.metaDescription, h1: page.h1 }, `pages[${pageIndex}]`, blocks, page.slug);
    collectStrings(page.sections, `pages[${pageIndex}].sections`, blocks, page.slug);
    collectStrings(page.images.map((image) => ({ altText: image.altText })), `pages[${pageIndex}].images`, blocks, page.slug);
  }
  collectStrings(spec.seo, "seo", blocks);
  return blocks;
}

export function extractRenderContentBlocks(content: RenderContent): ProvenanceBlockInput[] {
  const blocks: ProvenanceBlockInput[] = [];
  collectStrings(content, "renderContent", blocks);
  return blocks;
}

export function extractHtmlBlocks(files: Map<string, string | ArrayBuffer> | Record<string, string>): ProvenanceBlockInput[] {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  const blocks: ProvenanceBlockInput[] = [];
  for (const [path, content] of entries) {
    if (!path.endsWith(".html") || typeof content !== "string") continue;
    const withoutExecutable = content.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
    const title = withoutExecutable.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const description = withoutExecutable.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1]
      ?? withoutExecutable.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)?.[1];
    const altTexts = [...withoutExecutable.matchAll(/<img\b[^>]*\salt=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
    const visible = withoutExecutable.replace(/<[^>]+>/g, "\n").split(/\n+/).map((text) => decodeHtml(text).replace(/\s+/g, " ").trim()).filter(Boolean);
    const pageBlocks = [title, description, ...altTexts, ...visible].filter((text): text is string => !!text && text.trim().length > 0);
    pageBlocks.forEach((text, index) => blocks.push({ path: `${path}#text[${index}]`, text, page: path }));
  }
  return blocks;
}

export async function attachProvenanceToSiteSpec(
  spec: SiteSpec,
  context: Omit<BuildProvenanceInput, "blocks">
): Promise<SiteSpec> {
  const withoutProvenance = JSON.parse(JSON.stringify(spec)) as SiteSpec;
  delete withoutProvenance.provenance;
  const manifest = await buildProvenanceManifest({ ...context, blocks: extractSiteSpecBlocks(withoutProvenance) });
  return attachProvenanceManifestToSiteSpec(withoutProvenance, manifest);
}

export function attachProvenanceManifestToSiteSpec(
  spec: SiteSpec,
  manifest: ProvenanceManifestV1
): SiteSpec {
  const next = JSON.parse(JSON.stringify(spec)) as SiteSpec;
  delete next.provenance;
  for (let pageIndex = 0; pageIndex < next.pages.length; pageIndex++) {
    const page = next.pages[pageIndex];
    const pagePrefix = `pages[${pageIndex}]`;
    page.provenanceClaimIds = manifest.claims.filter((claim) => claim.path.startsWith(pagePrefix)).map((claim) => claim.id);
    page.sections.forEach((section, sectionIndex) => {
      const sectionPrefix = `${pagePrefix}.sections[${sectionIndex}]`;
      section.provenanceClaimIds = manifest.claims.filter((claim) => claim.path.startsWith(sectionPrefix)).map((claim) => claim.id);
    });
  }
  next.provenance = manifest;
  return next;
}

export async function verifyProvenanceAgainstBundle(
  manifest: ProvenanceManifestV1,
  files: Map<string, string | ArrayBuffer> | Record<string, string>
): Promise<ProvenanceValidationResult> {
  const structural = validateProvenanceManifest(manifest);
  const issues = [...structural.issues];
  const actualBlocks = extractHtmlBlocks(files);
  const actual = await buildPageEvidence(actualBlocks);
  for (const block of actualBlocks) {
    const textHash = await sha256(normalizeText(block.text));
    if (!manifest.claims.some((claim) => claim.path === block.path && claim.textHash === textHash)) {
      issues.push({
        id: `provenance:block-untracked:${block.path}`,
        severity: "critical",
        code: "PROVENANCE_BLOCK_UNTRACKED",
        path: block.path,
        claimId: null,
        message: "A rendered text block has no accepted provenance classification.",
        recommendedFix: "Rebuild provenance from the final rendered bundle.",
      });
    }
  }
  const expectedByPage = new Map(manifest.pageEvidence.map((entry) => [entry.page, entry]));
  for (const page of actual) {
    const expected = expectedByPage.get(page.page);
    if (!expected || expected.textHash !== page.textHash || expected.blockCount !== page.blockCount) {
      issues.push({
        id: `provenance:bundle-mismatch:${page.page}`,
        severity: "critical",
        code: "PROVENANCE_BUNDLE_MISMATCH",
        path: page.page,
        claimId: null,
        message: "Rendered text no longer matches the accepted provenance artifact.",
        recommendedFix: "Rebuild provenance from the final rendered bundle before publication.",
      });
    }
  }
  for (const expected of manifest.pageEvidence) {
    if (!actual.some((page) => page.page === expected.page)) {
      issues.push({
        id: `provenance:page-missing:${expected.page}`,
        severity: "critical",
        code: "PROVENANCE_PAGE_MISSING",
        path: expected.page,
        claimId: null,
        message: "A page covered by the provenance artifact was not available during validation.",
        recommendedFix: "Restore the page and rerun provenance validation.",
      });
    }
  }
  return { valid: issues.length === 0, blocking: issues.length > 0, issues };
}
