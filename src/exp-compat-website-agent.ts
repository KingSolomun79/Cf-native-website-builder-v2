// Sandbox deploy-compatibility shim (NOT dead code — do not remove without a
// DO-namespace migration).
//
// The operator's sandbox Worker still owns a Durable Object namespace backed
// by the class `WebsiteAgent` from its V1-era deployment. The Cloudflare API
// rejects any new script version that stops exporting a class an existing DO
// namespace depends on (error 10064). This empty stub satisfies that export
// contract without implementing anything: the V2 runtime never references the
// namespace, and no route reaches it. Restoring the V1 sandbox deploy
// restores the real class unchanged — no delete-class migration was used, so
// no DO storage was destroyed.
import { DurableObject } from "cloudflare:workers";

export class WebsiteAgent extends DurableObject {}
