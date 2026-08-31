import type { BrowserWorker } from "@cloudflare/playwright";

export interface Env {
  DB: D1Database;
  SITE_BUCKET: R2Bucket;
  WEBSITE_AGENT: DurableObjectNamespace;
  SITE_BUILD_WORKFLOW: Workflow;
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
  SMTP2GO_API_KEY: string;
  WEBHOOK_SECRET: string;
  APPROVAL_SECRET: string;
  APPROVAL_TIMEOUT_DAYS: string;
  MAX_REVISIONS: string;
  VISUAL_QA_MIN_SCORE?: string;
  INTERNAL_NOTIFICATION_EMAIL: string;

  GITHUB_TOKEN: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  GITHUB_BRANCH: string;

  ZHIPU_API_KEY?: string;
  ZHIPU_API_URL?: string;
  ZHIPU_GATEWAY_PROVIDER?: string;
  ZHIPU_MODEL?: string;
  PRIMARY_PROVIDER?: string;

  OPENROUTER_API_KEY: string;
  R2_PUBLIC_URL?: string;
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
  CANDIDATE_VALIDATION_ENABLED?: string;
  CANDIDATE_VALIDATION_SECRET?: string;
  FALLBACK_MODEL?: string;
}
