import type { BrowserWorker } from "@cloudflare/playwright";

/** Subset of the documented Cloudflare Email Service send() message shape used by the Form Service. */
export interface CloudflareEmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/** Structural type for the Cloudflare Email Service `send_email` binding (wrangler: send_email / name: EMAIL). */
export interface CloudflareEmailSender {
  send(message: CloudflareEmailMessage): Promise<{ messageId: string }>;
}

export interface Env {
  DB: D1Database;
  SITE_BUCKET: R2Bucket;
  WEBSITE_BUILD_WORKFLOW: Workflow;
  BROWSER: BrowserWorker;
  IMAGES: ImagesBinding;

  CF_ACCOUNT_ID: string;
  CF_AI_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
  CF_DEPLOY_API_TOKEN: string;
  CF_API_EMAIL?: string;
  CF_GLOBAL_API_KEY?: string;
  PUBLIC_APP_URL: string;
  KIE_API_URL: string;
  KIE_API_KEY: string;
  KIE_MODEL: string;
  // V2 image budget accounting (issue #10 production wiring): estimated USD
  // cost debited per KIE task against the USD 3.00 hard site spend gate, and
  // the bounded poll window for one task inside fetchResult.
  KIE_TASK_COST_USD?: string;
  KIE_POLL_TIMEOUT_MS?: string;
  // Durable image lifecycle (issue #58): poll cadence and per-attempt
  // provider wait bound for the submit -> sleep -> poll state machine.
  KIE_POLL_INTERVAL_MS?: string;
  KIE_ATTEMPT_TIMEOUT_MS?: string;
  WEBHOOK_SECRET: string;

  ZHIPU_API_KEY?: string;
  ZHIPU_API_URL?: string;
  ZHIPU_GATEWAY_PROVIDER?: string;
  PRIMARY_PROVIDER?: string;
  // One canonical LLM model for every V2 textual/multimodal call (issue
  // #30). Version-controlled default: src/lib/ai-gateway.ts
  // CANONICAL_LLM_MODEL. Per-provider/per-stage model names are retired;
  // provider failover must keep serving this exact model.
  LLM_MODEL?: string;

  // OpenRouter leg (operator decision 2026-09-02): optional — ZAI is primary
  // and the Cloudflare AI Gateway is the working fallback; provider chains
  // are key-driven, so an absent key skips the OpenRouter leg without error.
  OPENROUTER_API_KEY?: string;
  VISION_PRIMARY_PROVIDER?: string;
  VISION_FALLBACK_PROVIDER?: string;
  VISION_REQUEST_TIMEOUT_MS?: string;
  VISION_MAX_ATTEMPTS_PER_PROVIDER?: string;
  VISION_RETRY_DELAY_MS?: string;
  VISION_INPUT_MAX_BYTES?: string;
  VISION_INPUT_MAX_WIDTH?: string;
  VISION_INPUT_MAX_HEIGHT?: string;

  // Central WAZIBIZ Form Service (V2, issue #11). Outbound email goes
  // through the native Cloudflare Email Service `send_email` binding
  // (issue #28 follow-up): no provider API key, no shared transport
  // secret, no HTTP email-router hop. Fail-closed when the binding is
  // absent (delivery classifies transient, bounded retry). The Turnstile
  // secret is a Worker secret (`wrangler secret put`). The structural
  // sender type below matches the documented Workers Email Sending API
  // (`send({to, from, subject, text, html?, replyTo?})` returning
  // `{messageId}` and throwing Errors with an `E_*` code property)
  // independently of the ambient workers-types version.
  EMAIL?: CloudflareEmailSender;
  TURNSTILE_SECRET_KEY?: string;
  // Platform Sender Identity for outbound Form Service email (issue #32).
  // Worker VAR, not a secret: the default outbound From, swappable per
  // environment (local/staging/production) without source changes. Resolved
  // and validated at the delivery boundary; missing or malformed fails
  // closed — no fallback address and never a visitor From.
  WAZIBIZ_SENDER_EMAIL?: string;
  // Days a superseded Published Version stays available as Rollback Version.
  ROLLBACK_WINDOW_DAYS?: string;
  // HMAC secret for operator capability tokens on the Approval/Rollback
  // routes (Worker secret, never a var). Optional at the type level so the
  // Worker still boots without it: verification then fails closed and every
  // operator route denies (issue #29). Minting happens offline only.
  OPERATOR_CAPABILITY_SECRET?: string;
}
