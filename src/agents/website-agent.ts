import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.d";

export class WebsiteAgent extends DurableObject<Env> {
  private state: DurableObjectState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/session" && request.method === "POST") {
      const body = await request.json<{ jobId: string; siteId: string }>();
      await this.state.storage.put("jobId", body.jobId);
      await this.state.storage.put("siteId", body.siteId);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/session" && request.method === "GET") {
      const jobId = await this.state.storage.get<string>("jobId");
      const siteId = await this.state.storage.get<string>("siteId");
      return Response.json({ jobId, siteId });
    }

    if (url.pathname === "/spec" && request.method === "PUT") {
      const body = await request.json<{ spec: object }>();
      await this.state.storage.put("currentSpec", body.spec);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/spec" && request.method === "GET") {
      const spec = await this.state.storage.get<object>("currentSpec");
      return Response.json({ spec });
    }

    return new Response("Not found", { status: 404 });
  }
}
