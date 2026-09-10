// Deterministic DESIGN-BLUEPRINT.md renderer for design-blueprint/2
// (operator GO, 2026-09-10). Same quality bar as the v1 renderer: a senior
// web designer could hand it directly to a developer. Hero specs and hero
// image briefs render as first-class required elements; slot ids and
// priorities appear as the deterministic values the system assigned.

import type { BlueprintHeroImageBrief, BlueprintSectionSpecV2, DesignBlueprint, DesignBlueprintV2 } from "./contracts";

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderHero(page: string, hero: DesignBlueprintV2["pages"]["home"]["hero"]): string {
  const fields: string[] = [];
  if (hero.visualMass) fields.push(`Visual mass: ${hero.visualMass}`);
  if (hero.surface) fields.push(`Surface: ${hero.surface}`);
  if (hero.typography) fields.push(`Typography: ${hero.typography}`);
  if (hero.mediaTreatment) fields.push(`Media treatment: ${hero.mediaTreatment}`);
  if (hero.cta) fields.push(`CTA: ${hero.cta}`);
  if (hero.responsive) fields.push(`Responsive: ${hero.responsive}`);
  return `#### ${page} §1 — Hero (required page opener)\n\nPurpose: ${hero.purpose}\n\nLayout: ${hero.layout}${fields.length ? `\n\n${fields.map((line) => `- ${line}`).join("\n")}` : ""}`;
}

function renderSectionV2(page: string, sections: BlueprintSectionSpecV2[], startIndex: number): string {
  return sections
    .map((section, index) => {
      const fields: string[] = [];
      if (section.visualMass) fields.push(`Visual mass: ${section.visualMass}`);
      if (section.surface) fields.push(`Surface: ${section.surface}`);
      if (section.typography) fields.push(`Typography: ${section.typography}`);
      if (section.media) fields.push(`Media: ${section.media}`);
      if (section.cta) fields.push(`CTA: ${section.cta}`);
      if (section.responsive) fields.push(`Responsive: ${section.responsive}`);
      return `#### ${page} §${startIndex + index} — ${section.name}\n\nPurpose: ${section.purpose}\n\nLayout: ${section.layout}${fields.length ? `\n\n${fields.map((line) => `- ${line}`).join("\n")}` : ""}`;
    })
    .join("\n\n");
}

function renderPageSpecV2(page: string, spec: DesignBlueprintV2["pages"]["home"]): string {
  return [renderHero(page, spec.hero), renderSectionV2(page, spec.sections, 2)].filter(Boolean).join("\n\n");
}

function renderHeroBrief(slotId: string, page: string, brief: BlueprintHeroImageBrief): string {
  return `### \`${slotId}\` — ${page} · hero · CRITICAL · composition ${brief.compositionAspectRatio} → generate ${brief.generationAspectRatio}
- Subject: ${brief.subjectDirection}
${brief.compositionDirection ? `- Composition: ${brief.compositionDirection}\n` : ""}${brief.cropStrategy ? `- Crop strategy: ${brief.cropStrategy}\n` : ""}${brief.lighting ? `- Lighting: ${brief.lighting}\n` : ""}${brief.palette ? `- Palette: ${brief.palette}\n` : ""}${brief.cropBehavior ? `- Crop: ${brief.cropBehavior}\n` : ""}- Alt: ${brief.altText}
- KIE prompt: "${brief.kiePrompt}"
- Avoid: ${brief.negativePrompt}`;
}

function renderSlot(slot: DesignBlueprint["imagery"]["imageSlots"][number]): string {
  return `### \`${slot.id}\` — ${slot.page}${slot.section ? ` · ${slot.section}` : ""} · ${slot.priority} · composition ${slot.compositionAspectRatio} → generate ${slot.generationAspectRatio}
- Subject: ${slot.subjectDirection}
${slot.compositionDirection ? `- Composition: ${slot.compositionDirection}\n` : ""}${slot.cropStrategy ? `- Crop strategy: ${slot.cropStrategy}\n` : ""}${slot.lighting ? `- Lighting: ${slot.lighting}\n` : ""}${slot.palette ? `- Palette: ${slot.palette}\n` : ""}${slot.cropBehavior ? `- Crop: ${slot.cropBehavior}\n` : ""}- Alt: ${slot.altText}
- KIE prompt: "${slot.kiePrompt}"
- Avoid: ${slot.negativePrompt}`;
}

export function renderDesignBlueprintV2Markdown(bp: DesignBlueprintV2): string {
  const typeScale = bp.tokens.typography.scale
    .map(
      (row) =>
        `| ${row.element} | ${row.family}${row.weight ? ` ${row.weight}` : ""} | \`${row.sizeClamp}\` | ${row.lineHeight ?? "—"} | ${row.maxWidthCh ? `${row.maxWidthCh}ch` : "—"} |`
    )
    .join("\n");

  const colorRows = bp.tokens.colors
    .map((color) => `| ${color.role} | \`${color.value}\` | ${color.usage} |`)
    .join("\n");

  const heroBriefs = (["home", "about", "services", "contact"] as const)
    .map((page) => renderHeroBrief(`${page}-hero`, page.toUpperCase(), bp.imagery.pageHeroes[page]))
    .join("\n\n");
  const supportingSlots = bp.imagery.supportingImageSlots.map(renderSlot).join("\n\n");

  const motion =
    bp.motion.interactions.length === 0
      ? "_No significant motion observed — keep the page calm._"
      : bp.motion.interactions
          .map((item) => `- **${item.element}** (${item.trigger}): ${item.effect}${item.duration ? ` — ${item.duration}` : ""}${item.easing ? `, ${item.easing}` : ""}`)
          .join("\n");

  return `# Design Blueprint

_${bp.projectFrame.siteType} · ${bp.projectFrame.industry}_

> Business Facts provenance: \`${bp.businessFactsRef}\` (immutable, supplied separately to the builder — this document deliberately does not own business content).
>
> design-blueprint/2: every routed page's photographic hero is a REQUIRED structural element; hero slot ids, page ownership and priorities are assigned deterministically by the system.

## 01 · Project Frame

- **Page job**: ${bp.projectFrame.pageJob}
- **Design character**: ${bp.projectFrame.designCharacter}
- **Reference design thesis**: ${bp.projectFrame.referenceDesignThesis}
${bp.projectFrame.emotionalReference ? `- **Emotional reference**: ${bp.projectFrame.emotionalReference}\n` : ""}
- **Anti-pattern**: ${bp.projectFrame.antiPattern}

## 02 · Design DNA — Non-Negotiable Rules

${list(bp.designDna)}

## 03 · Design Tokens

### Color

| Role | Value | Usage |
|---|---|---|
${colorRows}

### Typography

- **Display**: ${bp.tokens.typography.display.family}${bp.tokens.typography.display.fallback ? ` (fallback: ${bp.tokens.typography.display.fallback})` : ""} — ${bp.tokens.typography.display.weightGuidance}
- **Body/UI**: ${bp.tokens.typography.body.family}${bp.tokens.typography.body.fallback ? ` (fallback: ${bp.tokens.typography.body.fallback})` : ""} — ${bp.tokens.typography.body.weightGuidance}

| Element | Family/weight | Size | Line-height | Measure |
|---|---|---|---|---|
${typeScale}

### Shape & layout

- **Radius**: ${bp.tokens.shape.borderRadius}
- **Shadows**: ${bp.tokens.shape.shadowPolicy}
${bp.tokens.shape.texture ? `- **Texture**: ${bp.tokens.shape.texture}\n` : ""}
- **Container**: ${bp.tokens.layout.containerWidth}
- **Section spacing**: ${bp.tokens.layout.sectionSpacing}
- **Image treatment**: ${bp.tokens.layout.imageTreatment}

## 04 · Global Chrome

**Header** — ${bp.globalChrome.header.layout}

Header states:

${list(bp.globalChrome.header.states)}

- **Navigation (desktop)**: ${bp.globalChrome.navigation.desktop}
- **Navigation (mobile)**: ${bp.globalChrome.navigation.mobile}
- **Primary CTA**: ${bp.globalChrome.primaryCta}
- **Footer**: ${bp.globalChrome.footer}
- **Form behavior**: ${bp.globalChrome.formBehavior}
${bp.globalChrome.overlays ? `- **Overlays**: ${bp.globalChrome.overlays}` : ""}

## 05 · Motion & Interaction

${motion}

**Reduced motion**: ${bp.motion.reducedMotion}
${bp.motion.scrollBehavior ? `\n**Scroll behavior**: ${bp.motion.scrollBehavior}` : ""}

## 06 · Home — Page Spec (hero first)

${renderPageSpecV2("HOME", bp.pages.home)}

## 07 · About

${renderPageSpecV2("ABOUT", bp.pages.about)}

## 08 · Services

${renderPageSpecV2("SERVICES", bp.pages.services)}

## 09 · Contact

${renderPageSpecV2("CONTACT", bp.pages.contact)}

## 10 · Signature Design Elements

${bp.signatureElements.map((element, index) => `${index + 1}. ${element}`).join("\n")}

## 11 · Anti-Patterns (forbidden)

${list(bp.antiPatterns)}

## 12 · Imagery Direction

**Grade**: ${bp.imagery.grade}

### Page heroes (deterministically materialized)

${heroBriefs}
${supportingSlots ? `\n### Supporting imagery\n\n${supportingSlots}` : ""}

## 13 · Responsive Specification

- **Desktop**: ${bp.responsive.desktop}
- **Tablet**: ${bp.responsive.tablet}
- **Mobile**: ${bp.responsive.mobile}

## 14 · Accessibility & Performance

- **Reduced motion**: ${bp.accessibility.reducedMotion}
${bp.accessibility.focusVisible ? `- **Focus**: ${bp.accessibility.focusVisible}\n` : ""}${bp.accessibility.keyboardNavigation ? `- **Keyboard**: ${bp.accessibility.keyboardNavigation}\n` : ""}${bp.accessibility.forms ? `- **Forms**: ${bp.accessibility.forms}\n` : ""}${bp.accessibility.performance ? `- **Performance**: ${bp.accessibility.performance}` : ""}

## 15 · Acceptance Checklist

${bp.acceptanceChecklist.map((item) => `- [ ] ${item}`).join("\n")}
`;
}
