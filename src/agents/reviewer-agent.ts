import type { Env } from "../env.d";
import type { SiteSpec, SiteSpecPage, RevisionPlan, QaReport, GatewayMeta } from "../types";
import { generateWithGateway } from "../lib/ai-gateway";
import { buildRevisionPlannerPrompt } from "../lib/prompts";

export async function createRevisionPlan(
  env: Env,
  jobId: string,
  siteId: string,
  clientSlug: string,
  currentSpec: SiteSpec,
  qaReport: QaReport,
  revisionPrompt: string
): Promise<RevisionPlan> {
  const qaReportJson = JSON.stringify(qaReport, null, 2);
  const systemPrompt = buildRevisionPlannerPrompt(currentSpec, qaReportJson, revisionPrompt);

  const meta: GatewayMeta = {
    job_id: jobId,
    site_id: siteId,
    client_slug: clientSlug,
    prompt_type: "revision_planner",
    style_key: "reference-driven",
  };

  const response = await generateWithGateway(
    env,
    systemPrompt,
    `Plan revisions for ${currentSpec.site.companyName} based on: "${revisionPrompt}"`,
    meta,
    {
      temperature: 0.3,
      maxTokens: 4096,
      jsonMode: true,
    }
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from revision planner model");
  }

  let plan: RevisionPlan;
  try {
    const cleaned = content.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    plan = JSON.parse(cleaned) as RevisionPlan;
  } catch {
    throw new Error(`Failed to parse revision plan JSON: ${content.slice(0, 500)}`);
  }

  if (!plan.summary || !Array.isArray(plan.changes) || plan.changes.length === 0) {
    throw new Error("Revision plan must have a summary and at least one change");
  }

  return plan;
}

export function applyRevisionToSpec(spec: SiteSpec, plan: RevisionPlan): SiteSpec {
  const newSpec = JSON.parse(JSON.stringify(spec)) as SiteSpec;

  for (const change of plan.changes) {
    const { instruction, target, page: pageSlug } = change;
    const resolvedTarget = resolveTarget(newSpec, target, pageSlug);

    if (instruction.startsWith("Replace with:")) {
      const rawValue = instruction.replace("Replace with:", "").trim().replace(/^['"]|['"]$/g, "");
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawValue);
      } catch {
        parsed = rawValue;
      }
      if (resolvedTarget !== null) {
        setNestedValue(newSpec, resolvedTarget, parsed);
      }
    } else if (instruction.startsWith("Replace section at:")) {
      const rest = instruction.replace("Replace section at:", "").trim();
      const jsonMatch = rest.match(/^\d+\s*:\s*(\{[\s\S]*\})$/);
      if (jsonMatch) {
        const idx = parseInt(rest, 10);
        try {
          const section = JSON.parse(jsonMatch[1]);
          applySectionReplace(newSpec, resolvedTarget, pageSlug, idx, section);
        } catch {
          // skip malformed section
        }
      }
    } else if (instruction.startsWith("Add section:")) {
      const sectionJson = instruction.replace("Add section:", "").trim();
      try {
        const section = JSON.parse(sectionJson);
        applySectionAdd(newSpec, resolvedTarget, pageSlug, section);
      } catch {
        // skip malformed section
      }
    } else if (instruction.startsWith("Remove section at:")) {
      const idxMatch = instruction.match(/Remove section at:\s*(\d+)/);
      if (idxMatch) {
        const idx = parseInt(idxMatch[1], 10);
        applySectionRemove(newSpec, resolvedTarget, pageSlug, idx);
      }
    } else if (target === "append") {
      const sectionJson = instruction.replace(/^Append section:\s*/,"").trim();
      try {
        const section = JSON.parse(sectionJson);
        applySectionAdd(newSpec, resolvedTarget, pageSlug, section);
      } catch {
        // skip malformed section
      }
    }
  }

  return newSpec;
}

function findPageIndex(spec: SiteSpec, pageSlug: string): number {
  return spec.pages.findIndex((p) => p.slug === pageSlug);
}

function resolveTarget(spec: SiteSpec, target: string, pageSlug: string): string | null {
  if (target.startsWith("pages[")) {
    return target;
  }
  const pageIdx = findPageIndex(spec, pageSlug);
  if (pageIdx === -1) return null;
  if (target === "append" || target === "sections") {
    return `pages[${pageIdx}].sections`;
  }
  if (target.startsWith("sections[")) {
    return `pages[${pageIdx}].${target}`;
  }
  if (target.startsWith("site.")) {
    return target;
  }
  return `pages[${pageIdx}].${target}`;
}

function applySectionAdd(spec: SiteSpec, resolvedTarget: string | null, pageSlug: string, section: unknown): void {
  if (!resolvedTarget) return;
  const pageMatch = resolvedTarget.match(/^pages\[(\d+)\]\.sections$/);
  if (pageMatch) {
    const pageIdx = parseInt(pageMatch[1], 10);
    if (spec.pages[pageIdx]) {
      spec.pages[pageIdx].sections.push(section as SiteSpecPage["sections"][number]);
    }
  }
}

function applySectionRemove(spec: SiteSpec, resolvedTarget: string | null, pageSlug: string, idx: number): void {
  if (!resolvedTarget) return;
  const pageMatch = resolvedTarget.match(/^pages\[(\d+)\]\.sections/);
  if (pageMatch) {
    const pageIdx = parseInt(pageMatch[1], 10);
    if (spec.pages[pageIdx] && spec.pages[pageIdx].sections[idx] !== undefined) {
      spec.pages[pageIdx].sections.splice(idx, 1);
    }
  }
}

function applySectionReplace(spec: SiteSpec, resolvedTarget: string | null, pageSlug: string, idx: number, section: unknown): void {
  if (!resolvedTarget) return;
  const pageMatch = resolvedTarget.match(/^pages\[(\d+)\]\.sections/);
  if (pageMatch) {
    const pageIdx = parseInt(pageMatch[1], 10);
    if (spec.pages[pageIdx] && spec.pages[pageIdx].sections[idx] !== undefined) {
      spec.pages[pageIdx].sections[idx] = section as SiteSpecPage["sections"][number];
    }
  }
}

function setNestedValue(obj: unknown, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return;
    }
  }

  if (current && typeof current === "object") {
    const lastPart = parts[parts.length - 1];
    (current as Record<string, unknown>)[lastPart] = value;
  }
}
