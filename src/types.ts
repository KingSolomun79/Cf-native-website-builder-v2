export type StyleKey =
  | "minimalist-monochrome"
  | "minimalist-modern"
  | "editorial-serif"
  | "high-contrast-luxury"
  | "flat-design"
  | "bold-typographic";

export type JobType = "initial_build" | "revision" | "redeploy" | "qa_only";

export type JobStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "failed"
  | "failed_validation"
  | "needs_input"
  | "timed_out"
  | "completed";

export type SiteStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "building"
  | "revision_requested";

export type WorkerStatus = "active" | "scheduled_delete" | "deleted";

export type ImageAssetStatus = "pending" | "complete" | "failed" | "placeholder";

export type QaVerdict =
  | "pass"
  | "pass_with_minor_issues"
  | "needs_revision"
  | "failed";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revise_requested"
  | "timed_out";

export type RevisionStatus = "planned" | "applied" | "failed";

export type PromptType =
  | "site_generation"
  | "image_generation"
  | "revision_planner"
  | "qa_reviewer"
  | "vision_analysis"
  | "blueprint_generation";

export type SectionType =
  | "hero"
  | "services-grid"
  | "about-preview"
  | "stats"
  | "cta"
  | "contact-form"
  | "text-block"
  | "image-text";

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3";

export type ImageSlot = "hero" | "services-grid" | "about-story" | "contact-hero";

export interface FluentFormsPayload {
  company_name?: string;
  client_email?: string;
  business_type?: string;
  business_description?: string;
  ideal_client_profile?: string;
  logo_url?: string;
  preferred_colour_1?: string;
  preferred_colour_2?: string;
  mode?: string;
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  county?: string;
  zip_code?: string;
  country?: string;
  facebook_url?: string;
  instagram_url?: string;
  twitter_url?: string;
  linkedin_url?: string;
  other_social_url?: string;
  extra_information?: string;
  whatsapp_number?: string;
  reference_site_url?: string;
  inspiration_url?: string;
  reference_homepage_screenshot?: string;
}

export interface ApprovedSourceFactV1 {
  schemaVersion: 1;
  id: string;
  value: string;
  location: string;
  extractedAt: string;
  confidence?: number | null;
}

export interface NormalizedIntake {
  companyName: string;
  clientEmail: string;
  businessType: string | null;
  businessDescription: string | null;
  idealClientProfile: string | null;
  logoUrl: string | null;
  preferredColour1: string | null;
  preferredColour2: string | null;
  mode: "light" | "dark";
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  county: string | null;
  zipCode: string | null;
  country: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  otherSocialUrl: string | null;
  extraInformation: string | null;
  whatsappNumber: string | null;
  referenceSiteUrl: string | null;
  referenceScreenshotR2Key: string | null;
  referenceHomeScreenshotUploadId: string | null;
  approvedSourceFacts?: ApprovedSourceFactV1[];
}

export interface ClientRow {
  id: string;
  slug: string;
  company_name: string;
  client_email: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  zip_code: string | null;
  country: string | null;
  business_type: string | null;
  business_description: string | null;
  ideal_client_profile: string | null;
  logo_url: string | null;
  preferred_colour_1: string | null;
  preferred_colour_2: string | null;
  mode: string;
  website_overall_style: string;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  other_social_url: string | null;
  extra_information: string | null;
  whatsapp_number: string | null;
  reference_site_url: string | null;
  inspiration_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteRow {
  id: string;
  client_id: string;
  current_version_id: string | null;
  status: string;
  revisions_count: number;
  preview_url: string | null;
  production_url: string | null;
  style_key: string;
  style_version: string;
  created_at: string;
  updated_at: string;
}

export interface ReferenceAssetRow {
  id: string;
  job_id: string;
  client_slug: string;
  site_version: number;
  kind: string;
  r2_key: string;
  original_filename: string | null;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  checksum: string;
  source: string;
  capture_timestamp: string;
  created_at: string;
  upload_id: string | null;
}

export interface ReferenceScreenshotRef {
  uploadId: string;
  stagingR2Key: string;
}

export interface ReferenceCaptureRow {
  id: string;
  job_id: string;
  client_slug: string;
  site_version: number;
  viewport: string;
  width: number;
  height: number;
  final_url: string | null;
  status: string;
  failure_code: string | null;
  failure_message: string | null;
  screenshot_r2_key: string | null;
  capture_json_r2_key: string | null;
  redirects: string | null;
  limitations: string | null;
  captured_at: string;
  created_at: string;
}

export type CaptureStatus = "captured" | "partial" | "failed";

export interface CaptureEvidenceRef {
  viewport: string;
  selector: string;
  screenshotR2Key: string | null;
}

export interface CaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureSection {
  order: number;
  tag: string;
  role: string | null;
  heading: string | null;
  text: string | null;
  bounds: CaptureBounds;
  evidence: CaptureEvidenceRef;
}

export interface CaptureTypeStyle {
  element: string;
  fontFamily: string | null;
  fontSize: string | null;
  fontWeight: string | null;
  lineHeight: string | null;
  letterSpacing: string | null;
  textTransform: string | null;
  evidence: CaptureEvidenceRef;
}

export interface CaptureColors {
  background: string | null;
  text: string | null;
  accents: string[];
  evidence: CaptureEvidenceRef;
}

export interface CaptureNavItem {
  href: string;
  text: string | null;
  external: boolean;
  evidence: CaptureEvidenceRef;
}

export interface CaptureImage {
  src: string;
  alt: string | null;
  naturalWidth: number;
  naturalHeight: number;
  displayedWidth: number;
  evidence: CaptureEvidenceRef;
}

export interface CaptureFailure {
  code: string;
  message: string;
}

export interface ReferenceCapture {
  viewport: { name: string; width: number; height: number };
  referenceUrl: string;
  finalUrl: string | null;
  status: CaptureStatus;
  failure: CaptureFailure | null;
  screenshotR2Key: string | null;
  title: string | null;
  lang: string | null;
  description: string | null;
  viewportMeta: string | null;
  sections: CaptureSection[];
  typography: CaptureTypeStyle[];
  colors: CaptureColors;
  nav: CaptureNavItem[];
  images: CaptureImage[];
  redirects: string[];
  limitations: string[];
  capturedAt: string;
}

export interface ResponsiveDiff {
  kind: "layout" | "nav" | "typography" | "imagery" | "hidden";
  description: string;
  fromViewport: string;
  toViewport: string;
  evidence: CaptureEvidenceRef;
}

export interface ReferenceCaptureManifest {
  jobId: string;
  referenceUrl: string;
  finalUrl: string | null;
  overallStatus: CaptureStatus;
  viewports: ReferenceCapture[];
  responsiveDiffs: ResponsiveDiff[];
  manifestR2Key: string;
  capturedAt: string;
}

export type InteractionTrigger =
  | "hover"
  | "focus"
  | "active"
  | "toggle"
  | "scroll-reveal"
  | "sticky"
  | "section-transition";

export interface InteractionObservation {
  id: string;
  trigger: InteractionTrigger;
  target: string;
  selector: string;
  viewport: string;
  role: string | null;
  observed: boolean;
  changedProperties: string[];
  before: Record<string, string>;
  after: Record<string, string>;
  duration: string | null;
  easing: string | null;
  delay: string | null;
  motionSafe: boolean;
  relevance: number;
  evidence: CaptureEvidenceRef;
}

export interface InteractionCapture {
  viewport: { name: string; width: number; height: number };
  referenceUrl: string;
  status: CaptureStatus;
  reducedMotionDetected: boolean;
  fallbackReason: CaptureFailure | null;
  observations: InteractionObservation[];
  screenshotR2Key: string | null;
  interactionsR2Key: string;
  capturedAt: string;
}

export interface InteractionManifest {
  jobId: string;
  referenceUrl: string;
  overallStatus: CaptureStatus;
  viewports: InteractionCapture[];
  motionSafetyNotes: string[];
  manifestR2Key: string;
  capturedAt: string;
}

export interface ReferenceInteractionRow {
  id: string;
  job_id: string;
  client_slug: string;
  site_version: number;
  viewport: string;
  status: string;
  observed_count: number;
  inferred_count: number;
  reduced_motion_detected: number;
  fallback_reason: string | null;
  interactions_r2_key: string | null;
  manifest_r2_key: string | null;
  captured_at: string;
  created_at: string;
}

// ── Phase 16.R3: auditable evidence (v2) ────────────────────────────────────
// Append-only attempt-based evidence. Replaces metadata-only claims with
// structured navigation diagnostics, an explicit evidence classification, and
// paired reduced-motion experiments. See migrations/0012_evidence_attempts.sql.

export interface RedirectEntry {
  url: string;
  status: number | null;
}

export interface FailedResource {
  url: string;
  type: string | null;
  reason: string;
}

export interface BlockedResource {
  url: string;
  reason: string;
}

export interface NavDiagnostics {
  initialUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  redirectChain: RedirectEntry[];
  failedResources: FailedResource[];
  blockedResources: BlockedResource[];
  timedOut: boolean;
  overlayLimitations: string[];
}

export interface CaptureDiagnostics {
  httpStatus: number | null;
  redirects: RedirectEntry[];
  failedResources: FailedResource[];
  blockedResources: BlockedResource[];
  timedOut: boolean;
  overlayLimitations: string[];
}

export interface CaptureSpacing {
  sectionPadding: string | null;
  sectionMargin: string | null;
  rhythm: string | null;
  evidence: CaptureEvidenceRef;
}

export type EvidenceClassification =
  | "detected"
  | "observed"
  | "inferred"
  | "skipped"
  | "failed";

export type MotionMode = "default" | "reduced";

export type ReducedMotionOutcome = "removed" | "shortened" | "unchanged" | "n/a";

export interface ReducedMotionComparison {
  defaultChangedProperties: string[];
  reducedChangedProperties: string[];
  defaultDurationMs: number;
  reducedDurationMs: number;
  outcome: ReducedMotionOutcome;
  note: string;
}

export interface EvidenceInteraction {
  id: string;
  evidenceId: string;
  trigger: InteractionTrigger;
  target: string;
  selector: string;
  viewport: string;
  motionMode: MotionMode;
  role: string | null;
  classification: EvidenceClassification;
  changedProperties: string[];
  before: Record<string, string>;
  after: Record<string, string>;
  duration: string | null;
  easing: string | null;
  delay: string | null;
  motionSafe: boolean;
  relevance: number;
  traceR2Key: string | null;
  screenshotR2Key: string | null;
  reducedMotionComparison: ReducedMotionComparison | null;
  resetOutcome: "verified" | "skipped" | "failed";
  evidence: CaptureEvidenceRef;
}

export interface EvidenceInteractionCapture {
  attemptId: string;
  viewport: { name: string; width: number; height: number };
  motionMode: MotionMode;
  referenceUrl: string;
  finalUrl: string | null;
  status: CaptureStatus;
  fallbackReason: CaptureFailure | null;
  observations: EvidenceInteraction[];
  tracesR2Key: string | null;
  rawR2Key: string | null;
  screenshotR2Key: string | null;
  interactionsR2Key: string;
  capturedAt: string;
}

export interface EvidenceInteractionManifest {
  jobId: string;
  referenceUrl: string;
  overallStatus: CaptureStatus;
  viewports: EvidenceInteractionCapture[];
  motionSafetyNotes: string[];
  manifestR2Key: string;
  capturedAt: string;
}

export interface EvidenceReferenceCapture {
  attemptId: string;
  viewport: { name: string; width: number; height: number };
  referenceUrl: string;
  finalUrl: string | null;
  diagnostics: CaptureDiagnostics;
  status: CaptureStatus;
  failure: CaptureFailure | null;
  screenshotR2Key: string | null;
  rawR2Key: string | null;
  title: string | null;
  lang: string | null;
  description: string | null;
  viewportMeta: string | null;
  sections: CaptureSection[];
  typography: CaptureTypeStyle[];
  colors: CaptureColors;
  nav: CaptureNavItem[];
  images: CaptureImage[];
  spacing: CaptureSpacing | null;
  limitations: string[];
  capturedAt: string;
}

export interface EvidenceAttemptSummary {
  attemptId: string;
  jobId: string;
  clientSlug: string;
  siteVersion: number;
  status: "in_progress" | "complete" | "failed";
  startedAt: string;
  completedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface EvidenceReferenceCaptureRow {
  id: string;
  attempt_id: string;
  job_id: string;
  client_slug: string;
  site_version: number;
  viewport: string;
  http_status: number | null;
  status: string;
  diagnostics: string | null;
  raw_r2_key: string | null;
  screenshot_r2_key: string | null;
  capture_json_r2_key: string | null;
  checksum: string;
  captured_at: string;
  created_at: string;
}

export interface EvidenceInteractionRow {
  id: string;
  attempt_id: string;
  job_id: string;
  client_slug: string;
  site_version: number;
  viewport: string;
  motion_mode: string;
  status: string;
  observed_count: number;
  detected_count: number;
  inferred_count: number;
  reduced_motion_comparison: string | null;
  traces_r2_key: string | null;
  interactions_r2_key: string | null;
  raw_r2_key: string | null;
  checksum: string;
  captured_at: string;
  created_at: string;
}

export interface EvidenceCurrentRow {
  job_id: string;
  site_version: number;
  attempt_id: string;
  promoted_at: string;
  created_at: string;
}

export interface CandidateValidationRunRow {
  id: string;
  nonce: string;
  status: "running" | "passed" | "failed";
  report_r2_key: string;
  summary_json: string;
  created_at: string;
  completed_at: string | null;
}

export type ColorRole =
  | "background"
  | "text"
  | "primary"
  | "accent"
  | "surface"
  | "muted"
  | "border";

export type SemanticSectionType =
  | "hero"
  | "features"
  | "about"
  | "services"
  | "stats"
  | "testimonials"
  | "cta"
  | "contact"
  | "footer"
  | "navigation";

export type IconIntentCategory =
  | "education"
  | "health"
  | "community"
  | "location"
  | "contact"
  | "security"
  | "growth"
  | "support"
  | "accessibility";

export interface BlueprintEvidence {
  viewport?: string;
  selector?: string;
  screenshotR2Key?: string | null;
  source: "capture" | "interaction" | "screenshot" | "client_facts";
}

export interface BlueprintColorRole {
  role: ColorRole | string;
  value: string;
  evidence: BlueprintEvidence;
}

export interface BlueprintTypeSpec {
  element: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  evidence: BlueprintEvidence;
}

export interface BlueprintSection {
  id: string;
  type: SemanticSectionType | string;
  role: string | null;
  order: number;
  composition: string;
  evidence: BlueprintEvidence;
  confidence: number;
}

export interface BlueprintIconIntent {
  slot: string;
  intent: IconIntentCategory | string;
  evidence: BlueprintEvidence;
}

export interface DesignBlueprint {
  schemaVersion: 1;
  source: {
    referenceUrl: string;
    finalUrl: string | null;
    captureManifestR2Key: string | null;
    interactionManifestR2Key: string | null;
    screenshotR2Key: string | null;
  };
  layout: {
    navStyle: string;
    footerStyle: string;
    gridSystem: string;
    sections: BlueprintSection[];
  };
  typography: {
    body: BlueprintTypeSpec;
    headings: BlueprintTypeSpec[];
    scale: string;
  };
  colors: {
    roles: BlueprintColorRole[];
  };
  spacing: {
    sectionPadding: string;
    rhythm: string;
  };
  surfaces: {
    cards: string;
    buttons: string;
    inputs: string;
  };
  imagery: {
    treatment: string;
    slots: string[];
  };
  navigation: {
    structure: string;
    items: string[];
    responsiveBehavior: string;
  };
  responsive: {
    breakpoints: number[];
    changes: string[];
  };
  icons: {
    intents: BlueprintIconIntent[];
  };
  confidence: number;
}

export type InteractionTriggerKind =
  | "hover"
  | "focus"
  | "active"
  | "toggle"
  | "scroll-reveal"
  | "sticky"
  | "section-transition";

export interface BlueprintInteraction {
  trigger: InteractionTriggerKind | string;
  target: string;
  selector: string;
  property: string;
  duration: string;
  easing: string;
  delay: string;
  hover: string;
  focus: string;
  active: string;
  scrollBehavior: string;
  reducedMotionBehavior: string;
  observed: boolean;
  evidence: BlueprintEvidence;
  confidence: number;
}

export interface InteractionBlueprint {
  schemaVersion: 1;
  source: {
    interactionManifestR2Key: string | null;
  };
  interactions: BlueprintInteraction[];
  reducedMotionStrategy: string;
  confidence: number;
}

export interface BlueprintValidationIssue {
  severity: "critical" | "major" | "minor";
  code: string;
  message: string;
  path: string;
}

export interface BlueprintValidationResult {
  valid: boolean;
  errors: BlueprintValidationIssue[];
  rendererSpecificStrings: string[];
}

export interface BlueprintReviewIssue {
  severity: "critical" | "major" | "minor";
  category: "completeness" | "consistency" | "evidence" | "accessibility" | "unsupported";
  message: string;
}

export interface BlueprintPair {
  design: DesignBlueprint;
  interaction: InteractionBlueprint;
  validation: BlueprintValidationResult;
  reviewIssues: BlueprintReviewIssue[];
  schemaVersion: number;
  promptVersion: string;
  model: string | null;
  attempts: number;
}

export interface BlueprintRow {
  id: string;
  job_id: string;
  client_slug: string;
  site_version: number;
  kind: string;
  schema_version: number;
  prompt_version: string | null;
  model: string | null;
  r2_key: string;
  validation_valid: number;
  validation_errors: string | null;
  review_issues: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
}

export interface JobRow {
  id: string;
  site_id: string;
  client_id: string;
  job_type: string;
  status: string;
  current_step: string | null;
  error_code: string | null;
  error_message: string | null;
  job_validation_errors: string | null;
  workflow_instance_id: string | null;
  agent_session_id: string | null;
  raw_payload_r2_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteSpec {
  site: {
    companyName: string;
    clientEmail: string;
    businessType: string | null;
    brandSummary: string;
    idealClientProfile: string | null;
    styleKey: string;
    mode: "light" | "dark";
    logoUrl: string;
    address?: string | null;
    whatsappNumber?: string | null;
    socials: {
      facebook: string | null;
      instagram: string | null;
      twitter: string | null;
      linkedin: string | null;
      other: string | null;
    };
  };
  pages: SiteSpecPage[];
  seo: {
    localBusiness: {
      name: string;
      addressLocality: string | null;
      addressCountry: string | null;
      telephone: string | null;
      url: string;
    };
    sameAs: string[];
  };
  provenance?: ProvenanceManifestV1;
}

export interface SiteSpecPage {
  slug: string;
  name: string;
  seoTitle: string;
  metaDescription: string;
  h1: string;
  sections: SiteSpecSection[];
  images: SiteSpecImage[];
  internalLinks: string[];
  provenanceClaimIds?: string[];
  form?: {
    submitEndpoint: string;
    fields: string[];
    successMessage: string;
  };
}

export interface SiteSpecSection {
  type: SectionType;
  heading: string | null;
  subheading: string | null;
  body: string | null;
  items: Record<string, unknown>[] | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  inverted: boolean;
  provenanceClaimIds?: string[];
  sourceFields?: string[];
}

export type ProvenanceSourceType = "client_input" | "approved_source" | "reference_design";
export type ProvenanceClaimClassification = "factual" | "marketing";
export type ProvenanceClaimRisk = "standard" | "high";
export type ProvenanceClaimStatus = "accepted" | "unsupported";

export interface ProvenanceSourceV1 {
  id: string;
  type: ProvenanceSourceType;
  location: string;
  extractedAt: string;
  confidence: number | null;
  valueHash: string;
}

export interface ProvenanceClaimV1 {
  id: string;
  path: string;
  textHash: string;
  classification: ProvenanceClaimClassification;
  risk: ProvenanceClaimRisk;
  status: ProvenanceClaimStatus;
  sourceIds: string[];
}

export interface ProvenancePageEvidenceV1 {
  page: string;
  textHash: string;
  blockCount: number;
}

export interface ProvenanceManifestV1 {
  schemaVersion: 1;
  id: string;
  jobId: string;
  siteId: string;
  clientSlug: string;
  siteVersion: number;
  parentArtifactId: string | null;
  createdAt: string;
  sources: ProvenanceSourceV1[];
  claims: ProvenanceClaimV1[];
  pageEvidence: ProvenancePageEvidenceV1[];
}

export interface ProvenanceValidationIssue {
  id: string;
  severity: "critical" | "major";
  code: string;
  path: string;
  claimId: string | null;
  message: string;
  recommendedFix: string;
}

export interface ProvenanceValidationResult {
  valid: boolean;
  blocking: boolean;
  issues: ProvenanceValidationIssue[];
}

export interface SiteSpecImage {
  slot: ImageSlot;
  aspectRatio: AspectRatio;
  prompt: string;
  altText: string;
  targetPage: string;
  outputFilename: string;
}

export interface StyleTokens {
  cssVars: Record<string, string>;
  googleFonts: string[];
  framework?: "tailwind" | "bootstrap" | "none";
}

export interface StyleComponents {
  button: {
    primary: string;
    secondary: string;
  };
  card: {
    default: string;
    inverted: string;
  };
  section: {
    default: string;
    inverted: string;
  };
  divider: string;
  hero: {
    headline: string;
    subheadline: string;
  };
  input: {
    default: string;
  };
}

export interface ImageTask {
  slot: string;
  page: string;
  aspectRatio: AspectRatio;
  prompt: string;
  altText: string;
  outputFilename: string;
}

export interface ImageResult {
  slot: string;
  page: string;
  outputFilename: string;
  r2Key: string;
  mimeType: string;
  width: number;
  height: number;
  sourceJobRef: string;
}

export interface ImageProvider {
  createTask(task: ImageTask): Promise<string>;
  pollResult(taskId: string): Promise<{ status: "pending" | "complete" | "failed"; url?: string }>;
}

export interface QaReport {
  verdict: QaVerdict;
  summary: string;
  checks: {
    links: "pass" | "fail";
    socials: "pass" | "fail";
    images: "pass" | "fail";
    seo_meta: "pass" | "fail";
    overflow: "pass" | "fail";
    form_render: "pass" | "fail";
    accessibility: "pass" | "fail";
    provenance: "pass" | "fail";
    visual: "pass" | "fail";
    interaction: "pass" | "fail";
    icons: "pass" | "fail";
  };
  issues: QaIssue[];
  screenshots: {
    desktop: Record<string, string>;
    tablet: Record<string, string>;
    mobile: Record<string, string>;
  };
  qualityGate: {
    score: number;
    threshold: number;
    publishable: boolean;
    attempt: number;
    reportR2Key: string | null;
    interactionEvidenceR2Key: string | null;
  };
  provenance: {
    manifestId: string | null;
    schemaVersion: number | null;
    sourceCount: number;
    claimCount: number;
    failureIds: string[];
  };
}

export interface QaIssue {
  severity: "critical" | "major" | "minor";
  category: string;
  page: string;
  selector: string;
  issue: string;
  recommendedFix: string;
  expected?: string;
  actual?: string;
  evidence?: string;
}

export interface RevisionPlan {
  summary: string;
  changes: RevisionChange[];
  affectedPages: string[];
  requiresImageRegeneration: boolean;
  requiresFullQa: boolean;
  specDiff: {
    path: string;
    before: string;
    after: string;
  }[];
}

export interface RevisionChange {
  type: "content" | "layout" | "image" | "seo" | "nav" | "section";
  page: string;
  target: string;
  instruction: string;
  reason: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
  }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface GatewayMeta {
  job_id: string;
  site_id: string;
  client_slug: string;
  prompt_type: PromptType;
  style_key: string;
}
