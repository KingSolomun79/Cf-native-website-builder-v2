import type { BrowserWorker } from "@cloudflare/playwright";

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

  // Central WAZIBIZ Form Service (V2, issue #11). The transport URL is a
  // non-secret var; the transport bearer token and Turnstile secret are set
  // as Worker secrets (`wrangler secret put`).
  WAZIBIZ_EMAIL_TRANSPORT_URL?: string;
  WAZIBIZ_EMAIL_TRANSPORT_TOKEN?: string;
  // Same-account service binding to the wazibiz-email-router Worker
  // (issue #28). Workers cannot fetch each other via *.workers.dev URLs
  // within one account (the edge unrouts the same-zone request), so the
  // platform transports delivery calls through this binding when present.
  // The URL var still names the endpoint (and its /send path) and stays the
  // fallback channel when no binding exists.
  EMAIL_ROUTER?: Fetcher;
  TURNSTILE_SECRET_KEY?: string;
  // Days a superseded Published Version stays available as Rollback Version.
  ROLLBACK_WINDOW_DAYS?: string;
  // HMAC secret for operator capability tokens on the Approval/Rollback
  // routes (Worker secret, never a var). Optional at the type level so the
  // Worker still boots without it: verification then fails closed and every
  // operator route denies (issue #29). Minting happens offline only.
  OPERATOR_CAPABILITY_SECRET?: string;
}
