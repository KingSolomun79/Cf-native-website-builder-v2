// Shared platform types for the V2 runtime. The V1 product type surface
// (clients, jobs, site versions, intake, blueprints, prompt registry, QA
// reports, contact delivery) was removed with the migration contraction;
// what remains is the infrastructure contract used by the AI gateway, the
// browser boundary and the KIE image provider.

export type PromptType =
  | "site_generation"
  | "image_generation"
  | "revision_planner"
  | "qa_reviewer"
  | "vision_analysis"
  | "blueprint_generation";

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

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3";

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
  /** Model identity the provider reports for this completion; recorded in
   *  AI-stage provenance when present (issue #30 model-routing correctness). */
  model?: string;
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
  // V1 identity fields (legacy pipeline callers). V2 stages populate the
  // build-centric fields below instead; both stay optional so each pipeline
  // sends only its own vocabulary.
  job_id?: string;
  site_id?: string;
  client_slug?: string;
  prompt_type?: PromptType;
  style_key?: string;
  // V2 Build-centric observability fields (PRD section 42).
  build_id?: string;
  site_generation_id?: string;
  build_version_id?: string;
  stage?: string;
  prompt_id?: string;
  prompt_version?: string;
  attempt?: number;
}
