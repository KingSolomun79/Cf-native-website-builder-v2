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
  WEBHOOK_SECRET: string;

  ZHIPU_API_KEY?: string;
  ZHIPU_API_URL?: string;
  ZHIPU_GATEWAY_PROVIDER?: string;
  ZHIPU_MODEL?: string;
  PRIMARY_PROVIDER?: string;

  OPENROUTER_API_KEY: string;
  VISION_MODEL?: string;
  VISION_PRIMARY_PROVIDER?: string;
  VISION_PRIMARY_MODEL?: string;
  VISION_FALLBACK_PROVIDER?: string;
  VISION_FALLBACK_MODEL?: string;
  VISION_REQUEST_TIMEOUT_MS?: string;
  VISION_MAX_ATTEMPTS_PER_PROVIDER?: string;
  VISION_RETRY_DELAY_MS?: string;
  VISION_INPUT_MAX_BYTES?: string;
  VISION_INPUT_MAX_WIDTH?: string;
  VISION_INPUT_MAX_HEIGHT?: string;
  FALLBACK_MODEL?: string;

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
