import type { Env } from "../env.d";
import { buildContactWorker } from "../builders/contact-worker-builder";

function cfAuthHeaders(env: Env): Record<string, string> {
  return { Authorization: `Bearer ${env.CF_DEPLOY_API_TOKEN}` };
}

type CfEndpoint =
  | "workers/scripts/assets-upload-session"
  | "workers/assets/upload"
  | "workers/workers"
  | "workers/workers/versions"
  | "workers/scripts/deployments"
  | "workers/scripts"
  | "workers/subdomain";

type AssetManifestEntry = {
  hash: string;
  size: number;
};

type CfApiError = {
  code: number;
  message: string;
};

function toBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function cfGlobalAuthHeaders(env: Env): Record<string, string> | null {
  if (env.CF_API_EMAIL && env.CF_GLOBAL_API_KEY) {
    return {
      "X-Auth-Email": env.CF_API_EMAIL,
      "X-Auth-Key": env.CF_GLOBAL_API_KEY,
    };
  }
  return null;
}

async function cfApiFetch(url: string, init: RequestInit, env: Env, endpoint: CfEndpoint): Promise<Response> {
  const headers = { ...cfAuthHeaders(env), ...(init.headers as Record<string, string>) };
  const authModes = ["bearer"];

  let response = await fetch(url, { ...init, headers });

  if ((response.status === 401 || response.status === 403) && env.CF_API_EMAIL && env.CF_GLOBAL_API_KEY) {
    const globalHeaders = cfGlobalAuthHeaders(env)!;
    const retryHeaders = { ...globalHeaders, ...(init.headers as Record<string, string>) };
    authModes.push("global_key");
    response = await fetch(url, { ...init, headers: retryHeaders });
  }

  if (response.status === 401 || response.status === 403) {
    const text = await response.text();
    console.error("Cloudflare deploy auth failed", {
      endpoint,
      url,
      status: response.status,
      accountId: env.CF_ACCOUNT_ID,
      authModesTried: authModes,
      responseSnippet: text.slice(0, 300),
    });
    throw new Error(`Cloudflare API auth failed (${response.status}): ${text}`);
  }

  return response;
}

async function getExistingWorkerId(env: Env, workerName: string): Promise<string> {
  const response = await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/workers/${workerName}`,
    {},
    env,
    "workers/workers"
  );

  let result: { success: boolean; errors?: CfApiError[]; result?: { id?: string } };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    const text = await response.text();
    throw new Error(`Existing worker lookup returned non-JSON: ${text.slice(0, 200)}`);
  }

  const workerId = result.result?.id;
  if (!result.success || !workerId) {
    throw new Error(`Existing worker lookup failed: ${JSON.stringify(result.errors)}`);
  }

  return workerId;
}

export async function uploadAssets(
  env: Env,
  workerName: string,
  files: Map<string, string | ArrayBuffer>
): Promise<string> {
  const manifest: Record<string, AssetManifestEntry> = {};
  const fileContents = new Map<string, Uint8Array>();

  const hashPromises = Array.from(files.entries()).map(async ([path, content]) => {
    const data = typeof content === "string"
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const hashHex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);

    manifest[`/${path}`] = { hash: hashHex, size: data.byteLength };
    fileContents.set(hashHex, data);
  });

  await Promise.all(hashPromises);

  const uploadSessionResponse = await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${workerName}/assets-upload-session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest }),
    },
    env,
    "workers/scripts/assets-upload-session"
  );

  let uploadSessionResult: {
    success: boolean;
    errors?: Array<{ code: number; message: string }>;
    result?: { jwt?: string; buckets?: string[][] };
  };
  try {
    uploadSessionResult = (await uploadSessionResponse.json()) as typeof uploadSessionResult;
  } catch {
    const text = await uploadSessionResponse.text();
    throw new Error(`Asset upload session returned non-JSON: ${text.slice(0, 200)}`);
  }

  const uploadJwt = uploadSessionResult.result?.jwt;
  const buckets = uploadSessionResult.result?.buckets ?? [];
  if (!uploadSessionResult.success || !uploadJwt) {
    throw new Error(`Asset upload session failed: ${JSON.stringify(uploadSessionResult.errors)}`);
  }

  if (buckets.length === 0) {
    return uploadJwt;
  }

  let completionJwt: string | null = null;

  for (const bucket of buckets) {
    const isLastBucket = bucket === buckets[buckets.length - 1];
    const formData = new FormData();
    for (const hash of bucket) {
      const data = fileContents.get(hash);
      if (!data) {
        throw new Error(`Missing file data for asset hash ${hash}`);
      }
      formData.append(hash, toBase64(data));
    }

    const uploadResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/assets/upload?base64=true`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${uploadJwt}` },
        body: formData,
      }
    );

    if (uploadResponse.status === 401 || uploadResponse.status === 403) {
      const text = await uploadResponse.text();
      console.error("Cloudflare deploy auth failed", {
        endpoint: "workers/assets/upload",
        url: `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/assets/upload?base64=true`,
        status: uploadResponse.status,
        accountId: env.CF_ACCOUNT_ID,
        authModesTried: ["upload_jwt"],
        responseSnippet: text.slice(0, 300),
      });
      throw new Error(`Cloudflare API auth failed (${uploadResponse.status}): ${text}`);
    }

    let uploadResult: {
      success?: boolean;
      errors?: Array<{ code: number; message: string }>;
      result?: { jwt?: string };
      jwt?: string;
    };
    try {
      uploadResult = (await uploadResponse.json()) as typeof uploadResult;
    } catch {
      const text = await uploadResponse.text();
      throw new Error(`Asset upload returned non-JSON: ${text.slice(0, 200)}`);
    }

    const returnedJwt = uploadResult.result?.jwt ?? uploadResult.jwt;
    if (uploadResult.success === false) {
      throw new Error(`Asset upload failed: ${JSON.stringify(uploadResult.errors)}`);
    }

    if (!returnedJwt) {
      console.log("Cloudflare asset upload bucket completed without JWT", {
        bucketSize: bucket.length,
        isLastBucket,
        resultKeys: Object.keys(uploadResult.result ?? {}),
        topLevelKeys: Object.keys(uploadResult),
      });
      if (isLastBucket) {
        throw new Error(`Asset upload failed: ${JSON.stringify(uploadResult.errors ?? [])}`);
      }
      continue;
    }

    completionJwt = returnedJwt;
  }

  if (!completionJwt) {
    throw new Error("Asset upload completed without a completion JWT");
  }

  return completionJwt;
}

export async function createWorker(
  env: Env,
  workerName: string,
  uploadJwt: string,
  contactEmail: string
): Promise<void> {
  const workerScript = generateContactWorkerScript(contactEmail);
  const createWorkerResponse = await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/workers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: workerName,
        subdomain: { enabled: true },
        observability: { enabled: true },
      }),
    },
    env,
    "workers/workers"
  );

  let createWorkerResult: {
    success: boolean;
    errors?: CfApiError[];
    result?: { id?: string };
  };
  try {
    createWorkerResult = (await createWorkerResponse.json()) as typeof createWorkerResult;
  } catch {
    const text = await createWorkerResponse.text();
    throw new Error(`Worker resource creation returned non-JSON: ${text.slice(0, 200)}`);
  }

  let workerId = createWorkerResult.result?.id;
  if (!createWorkerResult.success) {
    const alreadyExists = createWorkerResult.errors?.some((error) => error.code === 10040) ?? false;
    if (alreadyExists) {
      workerId = await getExistingWorkerId(env, workerName);
    }
  }

  if (!createWorkerResult.success && !workerId) {
    throw new Error(`Worker resource creation failed: ${JSON.stringify(createWorkerResult.errors)}`);
  }

  const createVersionResponse = await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/workers/${workerId}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main_module: "worker.js",
        compatibility_date: "2026-04-22",
        assets: {
          jwt: uploadJwt,
          config: { run_worker_first: ["/api/*"] },
        },
        bindings: [
          { name: "ASSETS", type: "assets" },
          { name: "SMTP2GO_API_KEY", type: "secret_text", text: env.SMTP2GO_API_KEY },
        ],
        modules: [
          {
            name: "worker.js",
            content_type: "application/javascript+module",
            content_base64: toBase64(new TextEncoder().encode(workerScript)),
          },
        ],
      }),
    },
    env,
    "workers/workers/versions"
  );

  let createVersionResult: {
    success: boolean;
    errors?: Array<{ code: number; message: string }>;
    result?: { id?: string };
  };
  try {
    createVersionResult = (await createVersionResponse.json()) as typeof createVersionResult;
  } catch {
    const text = await createVersionResponse.text();
    throw new Error(`Worker version creation returned non-JSON: ${text.slice(0, 200)}`);
  }

  const versionId = createVersionResult.result?.id;
  if (!createVersionResult.success || !versionId) {
    throw new Error(`Worker version creation failed: ${JSON.stringify(createVersionResult.errors)}`);
  }

  const deployResponse = await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${workerName}/deployments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionId }],
      }),
    },
    env,
    "workers/scripts/deployments"
  );

  let deployResult: { success: boolean; errors?: Array<{ code: number; message: string }> };
  try {
    deployResult = (await deployResponse.json()) as typeof deployResult;
  } catch {
    const text = await deployResponse.text();
    throw new Error(`Worker deployment returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!deployResult.success) {
    throw new Error(`Worker deployment failed: ${JSON.stringify(deployResult.errors)}`);
  }

  await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${workerName}/subdomain`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    },
    env,
    "workers/subdomain"
  );

  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const checkResp = await fetch(`https://${workerName}.wazibizwebsites.workers.dev/`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (checkResp.status === 200 || checkResp.status === 404) {
        break;
      }
    } catch {
      // not ready yet
    }
  }
}

export async function getWorkerPreviewUrl(env: Env, workerName: string): Promise<string> {
  const response = await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/subdomain`,
    {},
    env,
    "workers/subdomain"
  );

  let result: { success: boolean; result?: { subdomain: string } };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    const text = await response.text();
    throw new Error(`Worker subdomain fetch returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!result.success || !result.result?.subdomain) {
    throw new Error("Failed to retrieve account workers.dev subdomain");
  }

  return `https://${workerName}.${result.result.subdomain}.workers.dev`;
}

export async function deleteWorker(env: Env, workerName: string): Promise<void> {
  const response = await cfApiFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${workerName}`,
    { method: "DELETE" },
    env,
    "workers/scripts"
  );

  if (!response.ok) {
    throw new Error(`Worker deletion failed: ${response.status}`);
  }
}

export function generateContactWorkerScript(contactEmail: string): string {
  return buildContactWorker({ recipient: { type: "literal", value: contactEmail } }).trim();
}
