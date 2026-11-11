// Admin site-review read model (operator GO 2026-09-12): everything the site
// review page/API shows about one Site — generations, builds, versions,
// terminal outcomes, preview URL and generation history — DERIVED from
// canonical V2 state. No duplicate lifecycle state is invented here.

import type { Env } from "../env.d";
import { listSiteNotes } from "./admin-site-notes";
import { BUILD_LIFECYCLE_STATES } from "./lifecycle-schema";
import { getSiteAddress } from "./site-address";

export interface AdminBuildSummary {
  buildId: string;
  kind: string | null;
  state: string;
  workflowInstanceId: string | null;
  parentBuildId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: Array<{ id: string; versionNumber: number; createdAt: string }>;
  previewUrl: string | null;
  scoreSummary: string | null;
  /** The terminal workflow event's human-readable detail — WHY a build ended
   *  RELEASE_READY / HUMAN_REVIEW_REQUIRED / DEGRADED / FAILED (incident
   *  remediation 2026-09-23: the badge alone told the operator nothing). */
  terminalReason: string | null;
  repairUsed: boolean;
  /** Terminal QA verdict derived from the canonical workflow events, so the
   *  review surface can distinguish "passed automation" from "failed after
   *  the ONE repair, escalated to a human" instead of showing both as the
   *  same neutral Human Review badge (operator GO 2026-11-09). */
  qaOutcome: { status: "passed" | "failed"; visualScore: number | null; reasons: string[] } | null;
}

export interface AdminSiteReview {
  siteId: string;
  businessName: string;
  /** Stable public Site Address (issue #48) — allocated once per Site; null
   *  only for a legacy Site still awaiting backfill. */
  siteAddress: { slug: string; host: string; url: string } | null;
  /** True once the Site has a current Published Version served at the
   *  Site Address. */
  published: boolean;
  generations: Array<{
    id: string;
    sequenceNumber: number;
    buildMode: string;
    createdAt: string;
    builds: AdminBuildSummary[];
  }>;
  latestState: string | null;
  latestPreviewUrl: string | null;
  notes: Awaited<ReturnType<typeof listSiteNotes>>;
}

/** States whose terminal event detail explains the build outcome. */
const TERMINAL_EVENT_STATES = new Set(["RELEASE_READY", "HUMAN_REVIEW_REQUIRED", "DEGRADED", "FAILED"]);

/** The most recent terminal transition's detail — the canonical "why" string
 *  written by the pipeline (e.g. "Final QA still failing after the ONE
 *  pre-QA repair: visual fidelity 87 < 90"). */
function extractTerminalReason(events: Array<{ to_state: string | null; detail: string | null }>): string | null {
  for (const event of [...events].reverse()) {
    if (event.to_state && TERMINAL_EVENT_STATES.has(event.to_state) && event.detail) {
      return event.detail;
    }
  }
  return null;
}

/** Extracts the score summary (visual/content/technical) from the terminal
 *  workflow event detail — the canonical provenance string written by the
 *  pipeline (e.g. "…(visual 93, content 95, technical 95)" or the failing
 *  form "…visual fidelity 84 < 90…"). */
function extractScoreSummary(events: Array<{ stage: string | null; detail: string | null }>): string | null {
  for (const event of [...events].reverse()) {
    const detail = event.detail ?? "";
    const match = detail.match(/visual (?:fidelity )?(\d+)(?:, content (\d+))?(?:, technical (\d+))?/);
    if (match) {
      const [, visual, content, technical] = match;
      const parts = [`visual ${visual}`];
      if (content) parts.push(`content ${content}`);
      if (technical) parts.push(`technical ${technical}`);
      return parts.join(", ");
    }
  }
  return null;
}

const QA_EVENT_STAGES = new Set(["qa", "simple_qa", "simple_final_qa"]);

/** Derives the terminal QA outcome from the last QA workflow event. The
 *  pipeline writes exactly two shapes per evaluation:
 *    passed: "SIMPLE QA passed (visual 93, content 95, technical 95)" /
 *            "Final QA passed after the ONE repair (visual 91)"
 *    failed: "SIMPLE QA found: visual fidelity 84 < 90; 3 P1 finding(s); …" /
 *            "Final QA still failing after the ONE repair: visual fidelity 84 < 90; …"
 *  A failed outcome on a HUMAN_REVIEW_REQUIRED build means automation could
 *  NOT reach release quality — the review surface must say so. */
function deriveQaOutcome(events: Array<{ stage: string | null; detail: string | null }>): AdminBuildSummary["qaOutcome"] {
  const qaEvent = [...events].reverse().find((event) => event.stage !== null && QA_EVENT_STAGES.has(event.stage));
  if (!qaEvent) return null;
  const detail = qaEvent.detail ?? "";
  const visualMatch = /visual (?:fidelity )?(\d+)/.exec(detail);
  const visualScore = visualMatch ? Number.parseInt(visualMatch[1], 10) : null;
  const failedMatch = /(?:SIMPLE QA found:|still failing after the ONE repair:)\s*(.+)$/.exec(detail);
  if (failedMatch) {
    return {
      status: "failed",
      visualScore,
      reasons: failedMatch[1].split(";").map((reason) => reason.trim()).filter(Boolean),
    };
  }
  if (/QA passed/.test(detail)) {
    return { status: "passed", visualScore, reasons: [] };
  }
  return null;
}

export async function getAdminSiteReview(env: Env, siteId: string): Promise<AdminSiteReview | null> {
  const site = await env.DB.prepare(
    `SELECT s.id AS site_id, b.name AS business_name
     FROM site_identities s JOIN businesses b ON b.id = s.business_id WHERE s.id = ?`
  )
    .bind(siteId)
    .first<{ site_id: string; business_name: string }>();
  if (!site) return null;

  const generations = await env.DB.prepare(
    "SELECT id, sequence_number, build_mode, created_at FROM site_generations WHERE site_id = ? ORDER BY sequence_number"
  )
    .bind(siteId)
    .all<{ id: string; sequence_number: number; build_mode: string; created_at: string }>();

  const notes = await listSiteNotes(env, siteId);
  const [address, publishedState] = await Promise.all([
    getSiteAddress(env, siteId),
    env.DB.prepare("SELECT 1 AS live FROM site_published_state WHERE site_id = ?")
      .bind(siteId)
      .first<{ live: number }>(),
  ]);
  const review: AdminSiteReview = {
    siteId: site.site_id,
    businessName: site.business_name,
    siteAddress: address ? { slug: address.slug, host: address.host, url: address.url } : null,
    published: publishedState != null,
    generations: [],
    latestState: null,
    latestPreviewUrl: null,
    notes,
  };

  for (const generation of generations.results ?? []) {
    const builds = await env.DB.prepare(
      "SELECT id, kind, state, workflow_instance_id, parent_build_id, created_at, updated_at FROM builds WHERE site_generation_id = ? ORDER BY created_at, id"
    )
      .bind(generation.id)
      .all<{
        id: string;
        kind: string;
        state: string;
        workflow_instance_id: string | null;
        parent_build_id: string | null;
        created_at: string;
        updated_at: string;
      }>();

    const summaries: AdminBuildSummary[] = [];
    for (const build of builds.results ?? []) {
      const versions = await env.DB.prepare(
        "SELECT id, version_number, created_at FROM build_versions WHERE build_id = ? ORDER BY version_number"
      )
        .bind(build.id)
        .all<{ id: string; version_number: number; created_at: string }>();      const events = await env.DB.prepare(
        "SELECT stage, detail, to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at, id"
      )
        .bind(build.id)
        .all<{ stage: string | null; detail: string | null; to_state: string | null }>();
      const preview = await env.DB.prepare(
        `SELECT preview_url FROM build_deployments
         WHERE build_id = ? AND role = 'preview' AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`
      )
        .bind(build.id)
        .first<{ preview_url: string }>();
      summaries.push({
        buildId: build.id,
        kind: build.kind,
        state: build.state,
        workflowInstanceId: build.workflow_instance_id,
        parentBuildId: build.parent_build_id,
        createdAt: build.created_at,
        updatedAt: build.updated_at,
        versions: (versions.results ?? []).map((version) => ({
          id: version.id,
          versionNumber: version.version_number,
          createdAt: version.created_at,
        })),
        previewUrl: preview?.preview_url ?? null,
        scoreSummary: extractScoreSummary(events.results ?? []),
        terminalReason: extractTerminalReason(events.results ?? []),
        qaOutcome: deriveQaOutcome(events.results ?? []),
        repairUsed: (versions.results ?? []).length > 1,
      });
    }
    review.generations.push({
      id: generation.id,
      sequenceNumber: generation.sequence_number,
      buildMode: generation.build_mode,
      createdAt: generation.created_at,
      builds: summaries,
    });
  }

  const allBuilds = review.generations.flatMap((generation) => generation.builds);
  const terminalBuild = [...allBuilds].reverse().find((build) => BUILD_LIFECYCLE_STATES.includes(build.state as never));
  review.latestState = terminalBuild?.state ?? null;
  review.latestPreviewUrl = [...allBuilds].reverse().find((build) => build.previewUrl)?.previewUrl ?? null;
  return review;
}
