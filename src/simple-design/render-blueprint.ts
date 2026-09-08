// Deterministic DESIGN-BLUEPRINT.md renderer (spec sections 10/31).
//
// The JSON is the machine authority; this file is the human-readable
// inspection output. Quality bar (spec section 63): a senior web designer
// could hand it directly to a developer. If the output reads mostly like IDs,
// scores and machine metadata, the implementation has missed the point.

import type { DesignBlueprint } from "./contracts";

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderSection(page: string, sections: DesignBlueprint["pages"]["home"]["sections"]): string {
  return sections
    .map((section, index) => {
      const fields: string[] = [];
      if (section.visualMass) fields.push(`Visual mass: ${section.visualMass}`);
      if (section.surface) fields.push(`Surface: ${section.surface}`);
      if (section.typography) fields.push(`Typography: ${section.typography}`);
      if (section.media) fields.push(`Media: ${section.media}`);
      if (section.cta) fields.push(`CTA: ${section.cta}`);
      if (section.responsive) fields.push(`Responsive: ${section.responsive}`);
      return `#### ${page} §${index + 1} — ${section.name}\n\nPurpose: ${section.purpose}\n\nLayout: ${section.layout}${fields.length ? `\n\n${fields.map((line) => `- ${line}`).join("\n")}` : ""}`;
    })
    .join("\n\n");
}

export function renderDesignBlueprintMarkdown(bp: DesignBlueprint): string {
  const typeScale = bp.tokens.typography.scale
    .map(
      (row) =>
        `| ${row.element} | ${row.family}${row.weight ? ` ${row.weight}` : ""} | \`${row.sizeClamp}\` | ${row.lineHeight ?? "—"} | ${row.maxWidthCh ? `${row.maxWidthCh}ch` : "—"} |`
    )
    .join("\n");

  const colorRows = [
    ["Ground", bp.tokens.colors.ground],
    ["Ink / text", bp.tokens.colors.ink],
    ...(bp.tokens.colors.textSecondary ? [["Secondary text", bp.tokens.colors.textSecondary]] : []),
    ["Accent", bp.tokens.colors.accent],
    ...(bp.tokens.colors.accentLight ? [["Accent (light)", bp.tokens.colors.accentLight]] : []),
    ["Hairlines", bp.tokens.colors.hairline],
    ...(bp.tokens.colors.hairlineOnDark ? [["Hairlines on dark", bp.tokens.colors.hairlineOnDark]] : []),
    ...(bp.tokens.colors.error ? [["Error", bp.tokens.colors.error]] : []),
  ]
    .map(([role, value]) => `| ${role} | \`${value}\` |`)
    .join("\n");

  const slots = bp.imagery.imageSlots
    .map(
      (slot) => `### \`${slot.id}\` — ${slot.page}${slot.section ? ` · ${slot.section}` : ""} · ${slot.priority} · ${slot.aspectRatio}
- Subject: ${slot.subjectDirection}
${slot.compositionDirection ? `- Composition: ${slot.compositionDirection}\n` : ""}${slot.lighting ? `- Lighting: ${slot.lighting}\n` : ""}${slot.palette ? `- Palette: ${slot.palette}\n` : ""}${slot.cropBehavior ? `- Crop: ${slot.cropBehavior}\n` : ""}- Alt: ${slot.altText}
- KIE prompt: "${slot.kiePrompt}"
- Avoid: ${slot.negativePrompt}`
    )
    .join("\n\n");

  const motion =
    bp.motion.interactions.length === 0
      ? "_No significant motion observed — keep the page calm._"
      : bp.motion.interactions
          .map((item) => `- **${item.element}** (${item.trigger}): ${item.effect}${item.duration ? ` — ${item.duration}` : ""}${item.easing ? `, ${item.easing}` : ""}`)
          .join("\n");

  return `# Design Blueprint

_${bp.projectFrame.siteType} · ${bp.projectFrame.industry}_

> Business Facts provenance: \`${bp.businessFactsRef}\` (immutable, supplied separately to the builder — this document deliberately does not own business content).

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

| Role | Value |
|---|---|
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

## 06 · Home — Section Spec (in order)

${renderSection("HOME", bp.pages.home.sections)}

## 07 · About

${renderSection("ABOUT", bp.pages.about.sections)}

## 08 · Services

${renderSection("SERVICES", bp.pages.services.sections)}

## 09 · Contact

${renderSection("CONTACT", bp.pages.contact.sections)}

## 10 · Signature Design Elements

${bp.signatureElements.map((element, index) => `${index + 1}. ${element}`).join("\n")}

## 11 · Anti-Patterns (forbidden)

${list(bp.antiPatterns)}

## 12 · Imagery Direction

**Grade**: ${bp.imagery.grade}

${slots}

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
