import type { Env } from "../env.d";
import type { SiteSpec } from "../types";

export async function loadPrompt(env: Env, promptType: string): Promise<string> {
  const result = await env.DB.prepare("SELECT content FROM prompts WHERE prompt_type = ? AND style_key IS NULL AND is_active = 1 ORDER BY version DESC LIMIT 1").bind(promptType).first<{ content: string }>();

  if (!result) throw new Error(`No active prompt found for type: ${promptType}`);
  return result.content;
}

export async function loadPromptVersion(env: Env, promptType: string): Promise<string> {
  const result = await env.DB.prepare("SELECT version FROM prompts WHERE prompt_type = ? AND style_key IS NULL AND is_active = 1 ORDER BY version DESC LIMIT 1").bind(promptType).first<{ version: string }>();

  return result?.version ?? "1.0.0";
}

export function buildRevisionPlannerPrompt(
  currentSpec: SiteSpec,
  qaReportJson: string,
  revisionPrompt: string
): string {
  return `You are a website revision planner. Given the current site specification, a QA report, and a human revision request, produce a machine-executable change plan.

## Current Site Spec
${JSON.stringify(currentSpec, null, 2)}

## QA Report
${qaReportJson}

## Human Revision Request
${revisionPrompt}

## Accepted Design Contract
The current DesignBlueprint and InteractionBlueprint remain the renderer source of truth. Changes must stay semantic and renderer-independent.

## Immutable Constraints
- Exactly 4 pages: /, /services, /about, /contact
- No external links except social links
- No fake testimonials or invented facts
- Every factual revision must remain linked to accepted provenance from client input or an approved source
- Reference-site content is design evidence only and cannot be introduced as a client fact
- Never add unsupported statistics, dates, testimonials, certifications, addresses, program details, partnerships, awards, guarantees, or organizational claims
- Provenance metadata is immutable input; do not target or manually rewrite provenance paths because it is rebuilt deterministically after applying the plan
- Do not introduce style-package keys, renderer classes, model-authored HTML, or unsupported design tokens
- All changes must be backwards-compatible (no removing required fields)

## Supported Instruction Formats (STRICT — use ONLY these)
The "instruction" field MUST begin with EXACTLY one of these prefixes. No other formats are accepted.

### 1. Replace a field value (string, number, boolean)
"Replace with: <value>"
- target: page-relative path like "sections[2].heading" or "sections[0].body"
- Example: {"page":"/","target":"sections[2].heading","instruction":"Replace with: 'Our Story'"}

### 2. Replace an entire section with a new one
"Replace section at: <index> : <JSON section object>"
- target: "sections" (page-relative)
- The section JSON MUST include all required fields: type, heading, body, inverted, etc.
- Example: {"page":"/","target":"sections","instruction":"Replace section at: 2 : {\\"type\\":\\"image-text\\",\\"heading\\":\\"Our Approach\\",\\"body\\":\\"We believe in...\\",\\"inverted\\":false}"}

### 3. Add a new section at the end of a page
"Add section: <JSON section object>"
- target: "append"
- Example: {"page":"/about","target":"append","instruction":"Add section: {\\"type\\":\\"text-block\\",\\"heading\\":\\"Leadership\\",\\"body\\":\\"Our team...\\",\\"inverted\\":false}"}

### 4. Remove a section by index
"Remove section at: <index>"
- target: "sections"
- Example: {"page":"/","target":"sections","instruction":"Remove section at: 3"}

### CRITICAL RULES
- The "target" field is page-relative. Use "sections[N].field" to target a section field, "sections" for array-level ops, or "append" to add.
- The "page" field identifies which page (e.g. "/", "/about", "/services", "/contact").
- When converting a section type (e.g. text-block → image-text), use "Replace section at:" with the full new section JSON.
- When both removing and replacing a section, prefer "Replace section at:" over separate remove+add.
- NEVER use free-form instruction text. ALWAYS use one of the 4 exact prefixes above.

## Output Format
Return ONLY valid JSON:
{
  "summary": "string (what will change and why)",
  "changes": [
    {
      "type": "content | layout | image | seo | nav | section",
      "page": "/",
      "target": "sections[3]",
      "instruction": "Replace section at: 3 : {\\"type\\":\\"image-text\\",\\"heading\\":\\"A Regional Standard\\",\\"body\\":\\"We deliver precise...\\",\\"inverted\\":false}",
      "reason": "Client requested visual separation and imagery"
    }
  ],
  "affectedPages": ["/"],
  "requiresImageRegeneration": false,
  "requiresFullQa": true,
  "specDiff": [
    {
      "path": "pages[0].sections[3]",
      "before": "text-block section",
      "after": "image-text section"
    }
  ]
}`;
}
