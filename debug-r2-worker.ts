// TEMPORARY diagnostic (issue #30 smoke debugging) — remote-dev only, never deployed.
// POST body -> R2 put; GET ?key= -> R2 get summary.
export default {
  async fetch(request: Request, env: { SITE_BUCKET: R2Bucket }): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") ?? "references/smoke/issue30-ref.png";
    if (request.method === "POST") {
      const body = new Uint8Array(await request.arrayBuffer());
      await env.SITE_BUCKET.put(key, body, { httpMetadata: { contentType: "image/png" } });
      return Response.json({ put: key, bytes: body.byteLength });
    }
    const obj = await env.SITE_BUCKET.get(key);
    return Response.json({
      key,
      get: obj ? { size: obj.size, etag: obj.etag } : null,
    });
  },
};
