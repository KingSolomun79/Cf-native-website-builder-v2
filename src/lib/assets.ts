import type { Env } from "../env.d";

export async function putObject(
  env: Env,
  key: string,
  value: ArrayBuffer | ReadableStream | string,
  options?: R2PutOptions
): Promise<void> {
  await env.SITE_BUCKET.put(key, value, options);
}

// Workflow-step retry safety: deterministic artifact keys are re-frozen when
// the engine retries a completed-but-uncommitted step. If the object already
// exists, treat the freeze as satisfied instead of colliding (content
// integrity for release artifacts remains guarded by the manifest-hash
// equality checks at the publication boundary).
export async function putImmutableObjectTolerant(
  env: Env,
  key: string,
  value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
  options?: Omit<R2PutOptions, "onlyIf">
): Promise<void> {
  try {
    await putImmutableObject(env, key, value, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      const head = await env.SITE_BUCKET.head(key);
      if (head) return;
    }
    throw error;
  }
}

export async function putImmutableObject(
  env: Env,
  key: string,
  value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
  options?: Omit<R2PutOptions, "onlyIf">
): Promise<void> {
  const stored = await env.SITE_BUCKET.put(key, value, {
    ...options,
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!stored) {
    throw new Error(`Immutable R2 artifact already exists: ${key}`);
  }
}

export async function getObject(
  env: Env,
  key: string
): Promise<ReadableStream | null> {
  const obj = await env.SITE_BUCKET.get(key);
  return obj?.body ?? null;
}

export async function getObjectWithMetadata(
  env: Env,
  key: string
): Promise<R2ObjectBody | null> {
  return env.SITE_BUCKET.get(key) ?? null;
}

export async function deleteObject(env: Env, key: string): Promise<void> {
  await env.SITE_BUCKET.delete(key);
}

export function visionInputDerivativeKey(
  clientSlug: string,
  version: number,
  jobId: string,
  checksum: string
): string {
  return `${clientSlug}/versions/v${version}/reference/vision-inputs/${jobId}/${checksum}.webp`;
}
