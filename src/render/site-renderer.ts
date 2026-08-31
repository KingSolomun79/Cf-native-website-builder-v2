// Deterministic blueprint-driven site renderer.
//
// Consumes a validated DesignBlueprint + InteractionBlueprint + deterministic
// content and emits a complete four-page static HTML/CSS/JS bundle. The model
// never contributes HTML, scripts, handlers, or class strings — only sanitized
// token values (colors, fonts, spacing) and interaction-kind selection flow
// through here. Section composition is decided by the blueprint's section list
// and rendered with the deterministic primitive library.

import type { DesignBlueprintV2, InteractionBlueprintV2 } from "../lib/blueprint-schema-v2";
import { designBlueprintToTokens } from "./blueprint-tokens";
import { interactionBlueprintToCss, interactionBlueprintToJs } from "./blueprint-interactions";
import { buildPrimitiveCss } from "./primitive-styles";
import { buildContactJs } from "../builders/worker-assets-builder";
import { generateSitemapXml, generateRobotsTxt } from "../lib/seo";
import { escapeHtml } from "../lib/html";
import { text, sanitizeUrl } from "./sanitize";
import { declaredIntents, inferIntentFromText } from "./icons/intent-map";
import { LUCIDE_NOTICE } from "./icons/registry";
import {
  renderNav,
  renderSection,
  renderButton,
  renderCard,
  renderMedia,
  renderCta,
  renderAccordion,
  renderContactForm,
} from "./primitives";
import type { RenderContent, NavItem } from "./primitives";

export interface RenderSiteInput {
  design: DesignBlueprintV2;
  interaction: InteractionBlueprintV2;
  content: RenderContent;
  siteUrl: string;
}

export interface RenderedImageTask {
  slot: string;
  page: string;
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3";
  prompt: string;
  altText: string;
  outputFilename: string;
}

interface RenderedPageImage {
  url: string;
  alt: string;
}

const PAGES = [
  { slug: "/", path: "index.html", name: "Home" },
  { slug: "/services", path: "services/index.html", name: "Services" },
  { slug: "/about", path: "about/index.html", name: "About" },
  { slug: "/contact", path: "contact/index.html", name: "Contact" },
] as const;

export function navItemsForSite(content: RenderContent, design: DesignBlueprintV2): NavItem[] {
  const standard: NavItem[] = [
    { label: "Home", href: "/" },
    { label: "Services", href: "/services" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
  ];
  const declared = design.navigation.items.map((s) => s.trim().toLowerCase());
  if (declared.length === 0) return standard;
  const matched = standard.filter((item) => declared.some((d) => d.includes(item.label.toLowerCase())));
  return matched.length >= 2 ? matched : standard;
}

// Icons render only from the intents the blueprint declared, and only on the
// card whose text matches that intent (so an icon is never forced onto a card it
// does not describe). The overuse cap keeps iconography intentional: no more
// than MAX_ICONS_PER_PAGE icons appear on any single page.
export const MAX_ICONS_PER_PAGE = 6;

export type IconResolver = (title: string, body: string) => string | null;

export function makeIconResolver(design: DesignBlueprintV2): IconResolver {
  const allowed = new Set(declaredIntents(design));
  if (allowed.size === 0) return () => null;
  let used = 0;
  return (title, body) => {
    if (used >= MAX_ICONS_PER_PAGE) return null;
    const inferred = inferIntentFromText(title, body);
    if (!inferred || !allowed.has(inferred)) return null;
    used += 1;
    return inferred;
  };
}

function heroSection(heading: string, subheading: string, eyebrow: string, variant: "default" | "inverted" | "accent", image: RenderedPageImage | null): string {
  const media = image ? `<div class="hero__media">${renderMedia({ src: image.url, alt: image.alt, ratio: "16/9", loading: "eager" })}</div>` : "";
  const sub = subheading ? `<p class="hero__sub">${text(subheading)}</p>` : "";
  const inner = `${eyebrow ? `<p class="section__eyebrow">${text(eyebrow)}</p>` : ""}<h1 class="hero__heading">${text(heading)}</h1>${sub}${media}`;
  return renderSection({ kind: "hero", variant, ariaLabel: "Introduction", innerHtml: inner });
}

function servicesPreviewSection(content: RenderContent, variant: "default" | "inverted" | "accent", resolveIcon: IconResolver): string {
  const cards = content.services.map((s) => renderCard({ title: s.title, body: s.description, iconIntent: resolveIcon(s.title, s.description) })).join("\n");
  const cols = Math.min(content.services.length || 3, 3);
  const inner = `<h2>${text(content.hero.servicesHeading)}</h2>\n<div class="grid grid--${cols}">${cards}</div>\n<div style="margin-top:1.5rem">${renderButton({ label: `See all ${content.company.businessType}`, href: "/services", variant: "secondary" })}</div>`;
  return renderSection({ kind: "features", variant, ariaLabel: "Services overview", innerHtml: inner });
}

function servicesGridSection(content: RenderContent, variant: "default" | "inverted" | "accent", resolveIcon: IconResolver): string {
  const cards = content.services.map((s) => renderCard({ title: s.title, body: s.description, iconIntent: resolveIcon(s.title, s.description) })).join("\n");
  const cols = Math.min(content.services.length || 3, 3);
  const inner = `<p class="section__eyebrow">What we do</p>\n<h2>${text(content.hero.servicesHeading)}</h2>\n<p class="lead">${text(content.hero.servicesSubheading)}</p>\n<div class="grid grid--${cols}" style="margin-top:2rem">${cards}</div>`;
  return renderSection({ kind: "services", variant, ariaLabel: "Services", innerHtml: inner });
}

function aboutPreviewSection(content: RenderContent, variant: "default" | "inverted" | "accent", image: RenderedPageImage | null): string {
  const media = image ? `<div style="margin-top:1.5rem">${renderMedia({ src: image.url, alt: image.alt, ratio: "4/3" })}</div>` : "";
  const inner = `<p class="section__eyebrow">Who we are</p>\n<h2>${text(content.hero.aboutHeading)}</h2>\n<p class="lead">${text(content.company.description)}</p>${media}\n<div style="margin-top:1.5rem">${renderButton({ label: `Learn more about ${content.company.name}`, href: "/about", variant: "secondary" })}</div>`;
  return renderSection({ kind: "about", variant, ariaLabel: "About preview", innerHtml: inner });
}

function aboutStorySection(content: RenderContent, variant: "default" | "inverted" | "accent"): string {
  const paragraphs = content.aboutParagraphs.map((p) => `<p>${text(p)}</p>`).join("\n");
  const inner = `<p class="section__eyebrow">Our story</p>\n<h2>${text(content.hero.aboutHeading)}</h2>\n<div class="prose" style="margin-top:1.5rem">${paragraphs}</div>`;
  return renderSection({ kind: "about", variant, ariaLabel: "About", innerHtml: inner });
}

function businessDetailsSection(content: RenderContent, variant: "default" | "inverted" | "accent", resolveIcon: IconResolver): string {
  const items = [
    { title: "Business focus", description: content.company.businessType },
    content.company.idealClient ? { title: "Intended clients", description: content.company.idealClient } : null,
    content.contact.address ? { title: "Location", description: content.contact.address } : null,
  ].filter((item): item is { title: string; description: string } => item !== null);
  const cards = items.map((s) => renderCard({ title: s.title, body: s.description, iconIntent: resolveIcon(s.title, s.description) })).join("\n");
  const inner = `<h2>Business details</h2>\n<div class="grid grid--${Math.min(items.length || 1, 3)}" style="margin-top:2rem">${cards}</div>`;
  return renderSection({ kind: "features", variant, ariaLabel: "Business details", innerHtml: inner });
}

function statsSection(content: RenderContent, variant: "default" | "inverted" | "accent"): string {
  const items = content.stats.map((s) => `<div class="stat"><div class="stat__value">${text(s.value)}</div><div class="stat__label">${text(s.label)}</div></div>`).join("\n");
  const inner = `<div class="stats">${items}</div>`;
  return renderSection({ kind: "stats", variant, ariaLabel: "At a glance", innerHtml: inner });
}

function accordionSection(content: RenderContent, variant: "default" | "inverted" | "accent"): string {
  const items = [
    { summary: `How do I contact ${content.company.name}?`, detail: `Use the contact page to send ${content.company.name} an enquiry.` },
    { summary: `What ${content.company.businessType} do you offer?`, detail: content.company.description },
    { summary: "Where are you located?", detail: content.contact.address ?? `Use the contact page to ask ${content.company.name} about its location.` },
  ];
  const inner = `<h2>Common questions</h2>\n<div style="margin-top:1.5rem">${renderAccordion(items)}</div>`;
  return renderSection({ kind: "features", variant, ariaLabel: "Frequently asked questions", innerHtml: inner });
}

function contactFormSection(content: RenderContent, variant: "default" | "inverted" | "accent"): string {
  const form = renderContactForm({
    action: "/api/contact",
    whatsappNumber: content.contact.whatsapp,
    submitLabel: "Send message",
    fields: [
      { name: "name", label: "Full name", type: "text", required: true, autocomplete: "name" },
      { name: "email", label: "Email address", type: "email", required: true, autocomplete: "email" },
      { name: "phone", label: "Phone number (optional)", type: "tel", required: false, autocomplete: "tel" },
      { name: "message", label: "Message", type: "textarea", required: true },
    ],
  });
  const details = renderContactDetails(content);
  const inner = `<h2>${text(content.hero.contactHeading)}</h2>\n<p class="lead">${text(content.hero.contactSubheading)}</p>\n<div class="grid grid--2" style="margin-top:2rem; align-items:start">${form}${details}</div>`;
  return renderSection({ kind: "contact", variant, ariaLabel: "Contact", innerHtml: inner });
}

function renderContactDetails(content: RenderContent): string {
  const lines: string[] = [];
  if (content.contact.email) lines.push(`<li>Email: <a href="${sanitizeUrl(`mailto:${content.contact.email}`, "#")}">${text(content.contact.email)}</a></li>`);
  if (content.contact.phone) lines.push(`<li>Phone: <a href="${sanitizeUrl(`tel:${content.contact.phone}`, "#")}">${text(content.contact.phone)}</a></li>`);
  if (content.contact.address) lines.push(`<li>Address: ${text(content.contact.address)}</li>`);
  const socials = [
    content.socials.facebook && `<li><a href="${sanitizeUrl(content.socials.facebook, "#")}" rel="noopener">Facebook</a></li>`,
    content.socials.instagram && `<li><a href="${sanitizeUrl(content.socials.instagram, "#")}" rel="noopener">Instagram</a></li>`,
    content.socials.linkedin && `<li><a href="${sanitizeUrl(content.socials.linkedin, "#")}" rel="noopener">LinkedIn</a></li>`,
  ].filter(Boolean);
  const inner = `<h3 class="section__eyebrow">Reach us directly</h3>\n<ul class="contact-details">${lines.join("\n")}${socials.length ? `\n<li>Follow us: </li>` : ""}${socials.join("")}</ul>`;
  return `<div>${inner}</div>`;
}

function ctaSection(content: RenderContent, variant: "default" | "inverted" | "accent"): string {
  const inner = renderCta({ heading: content.cta.heading, body: content.cta.body, button: { label: content.cta.buttonLabel, href: "/contact", variant: "primary" } });
  return renderSection({ kind: "cta", variant, ariaLabel: "Call to action", innerHtml: inner });
}

type SectionVariant = "default" | "inverted" | "accent";

function variantForBlueprintSection(section: DesignBlueprintV2["layout"]["sections"][number], index: number): SectionVariant {
  const signal = `${section.role ?? ""} ${section.composition}`.toLowerCase();
  if (/accent|highlight|call.to.action/.test(signal)) return "accent";
  if (/dark|invert|contrast/.test(signal)) return "inverted";
  return index > 0 && index % 3 === 0 ? "inverted" : "default";
}

function fallbackOverviewSection(content: RenderContent, index: number): string {
  const facts = [
    { heading: "Business overview", body: content.company.description },
    content.company.idealClient ? { heading: "Intended clients", body: content.company.idealClient } : null,
    content.contact.address ? { heading: "Location", body: content.contact.address } : null,
    { heading: "Contact information", body: "Use the contact page to view available contact options or submit an enquiry." },
  ].filter((item): item is { heading: string; body: string } => item !== null);
  const fact = facts[index % facts.length];
  const inner = `<h2>${text(fact.heading)}</h2>\n<p class="lead">${text(fact.body)}</p>`;
  return renderSection({ kind: "overview", variant: index % 2 === 0 ? "default" : "inverted", ariaLabel: fact.heading, innerHtml: inner });
}

function additionalImageSection(imageUrl: string, index: number, alt: string): string {
  return renderSection({
    kind: `imagery-${index + 1}`,
    ariaLabel: "Visual context",
    innerHtml: renderMedia({ src: imageUrl, alt, ratio: "16/9" }),
  });
}

function composeHomepage(content: RenderContent, design: DesignBlueprintV2, homeImages: RenderedPageImage[], resolveIcon: IconResolver): string[] {
  const ordered = design.layout.sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => a.section.order - b.section.order || a.index - b.index);
  const rendered: string[] = [];
  const emitted = new Set<string>();
  const usedImageIndexes = new Set<number>();

  for (const { section } of ordered) {
    const type = section.type.trim().toLowerCase();
    const family = type === "services" ? "features" : type === "contact" ? "cta" : type;
    if (emitted.has(family)) continue;
    const variant = variantForBlueprintSection(section, rendered.length);
    let html: string | null = null;
    if (type === "hero") {
      html = heroSection(content.hero.homeHeading, content.hero.homeSubheading, content.company.businessType, variant, homeImages[0] ?? null);
      if (homeImages[0]) usedImageIndexes.add(0);
    }
    else if (type === "features" || type === "services") html = servicesPreviewSection(content, variant, resolveIcon);
    else if (type === "about") {
      html = aboutPreviewSection(content, variant, homeImages[1] ?? null);
      if (homeImages[1]) usedImageIndexes.add(1);
    }
    else if (type === "stats") html = statsSection(content, variant);
    else if (type === "cta" || type === "contact") html = ctaSection(content, variant);
    if (!html) continue;
    emitted.add(family);
    rendered.push(html);
  }

  if (!emitted.has("hero")) {
    rendered.unshift(heroSection(content.hero.homeHeading, content.hero.homeSubheading, content.company.businessType, "default", homeImages[0] ?? null));
    if (homeImages[0]) usedImageIndexes.add(0);
  }
  for (const [index, image] of homeImages.entries()) {
    if (!usedImageIndexes.has(index)) rendered.push(additionalImageSection(image.url, index, image.alt));
  }
  while (rendered.length < 5) rendered.push(fallbackOverviewSection(content, rendered.length));
  return rendered;
}

function composePage(slug: string, content: RenderContent, design: DesignBlueprintV2, pageImages: RenderedPageImage[]): string[] {
  const resolveIcon = makeIconResolver(design);

  if (slug === "/") {
    return composeHomepage(content, design, pageImages, resolveIcon);
  }
  if (slug === "/services") {
    return [
      heroSection(content.hero.servicesHeading, content.hero.servicesSubheading, content.company.businessType, "default", pageImages[0] ?? null),
      servicesGridSection(content, "default", resolveIcon),
      ...pageImages.slice(1).map((image, index) => additionalImageSection(image.url, index, image.alt)),
      accordionSection(content, "inverted"),
      businessDetailsSection(content, "default", resolveIcon),
      ctaSection(content, "accent"),
    ];
  }
  if (slug === "/about") {
    return [
      heroSection(content.hero.aboutHeading, content.hero.aboutSubheading, "Our story", "default", pageImages[0] ?? null),
      aboutStorySection(content, "default"),
      ...pageImages.slice(1).map((image, index) => additionalImageSection(image.url, index, image.alt)),
      businessDetailsSection(content, "inverted", resolveIcon),
      ctaSection(content, "accent"),
    ];
  }
  return [
    heroSection(content.hero.contactHeading, content.hero.contactSubheading, "Contact", "default", pageImages[0] ?? null),
    ...pageImages.slice(1).map((image, index) => additionalImageSection(image.url, index, image.alt)),
    contactFormSection(content, "default"),
    ctaSection(content, "accent"),
  ];
}

function safeJsonLd(obj: object): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildHead(params: {
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  cssVars: Record<string, string>;
  googleFonts: string[];
  ogImage?: string | null;
  jsonLd?: object;
}): string {
  const fontLink = params.googleFonts.length > 0
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=${params.googleFonts.join("&family=")}&display=swap" rel="stylesheet">`
    : "";
  const varsString = Object.entries(params.cssVars).map(([k, v]) => `${k}: ${v};`).join("\n    ");
  const jsonLd = params.jsonLd ? `\n    <script type="application/ld+json">${safeJsonLd(params.jsonLd)}</script>` : "";
  const ogImage = params.ogImage ? `<meta property="og:image" content="${escapeHtml(params.ogImage)}">` : "";
  return `    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(params.title)}</title>
    <meta name="description" content="${escapeHtml(params.metaDescription)}">
    <link rel="canonical" href="${escapeHtml(params.canonicalUrl)}">
    <meta property="og:title" content="${escapeHtml(params.title)}">
    <meta property="og:description" content="${escapeHtml(params.metaDescription)}">
    <meta property="og:type" content="website">
    ${ogImage}
    ${fontLink}
    <link rel="stylesheet" href="/assets/styles.css">
    <style>
      :root {
    ${varsString}
      }
    </style>${jsonLd}`;
}

function buildFooter(content: RenderContent): string {
  const year = new Date().getFullYear();
  const socials = [
    content.socials.facebook && `<a href="${sanitizeUrl(content.socials.facebook, "#")}" rel="noopener">Facebook</a>`,
    content.socials.instagram && `<a href="${sanitizeUrl(content.socials.instagram, "#")}" rel="noopener">Instagram</a>`,
    content.socials.twitter && `<a href="${sanitizeUrl(content.socials.twitter, "#")}" rel="noopener">Twitter</a>`,
    content.socials.linkedin && `<a href="${sanitizeUrl(content.socials.linkedin, "#")}" rel="noopener">LinkedIn</a>`,
  ].filter(Boolean).join("\n");
  const socialsHtml = socials ? `<nav class="footer__socials" aria-label="Social links">\n      ${socials}\n    </nav>` : "";
  return `<footer class="footer" role="contentinfo">
  <div class="footer__inner">
    <div class="footer__brand">${text(content.company.name)}</div>
    ${socialsHtml}
    <p class="footer__copy">&copy; ${year} ${text(content.company.name)}. All rights reserved.</p>
  </div>
</footer>`;
}

function buildPageHtml(slug: string, sections: string[], head: string, nav: string, footer: string): string {
  const reveal = sections.map((s) => s.replace('data-section=', 'data-reveal data-section=')).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
${head}
</head>
<body>
<a href="#main" class="skip-link">Skip to content</a>
${nav}
<main id="main">
${reveal}
</main>
${footer}
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

export interface RenderSiteResult {
  files: Map<string, string>;
  tokens: { cssVars: Record<string, string>; googleFonts: string[] };
  imageTasks: RenderedImageTask[];
}

export function renderBlueprintSite(input: RenderSiteInput): RenderSiteResult {
  const { design, interaction, content, siteUrl } = input;
  const tokens = designBlueprintToTokens(design);
  const interactionCss = interactionBlueprintToCss(interaction);
  const navItems = navItemsForSite(content, design);
  const footer = buildFooter(content);

  const pageOrder = new Map([["/", 0], ["/services", 1], ["/about", 2], ["/contact", 3]]);
  const normalizedSlots = design.imagery.slots.map((slot, index) => typeof slot === "string"
    ? { id: slot.trim() || `image-${index + 1}`, page: "/" as const, placement: index === 0 ? "hero" as const : "section" as const, aspectRatio: index === 1 ? "4:3" as const : "16:9" as const, subject: `${content.company.name} ${slot.trim() || "visual"}` }
    : slot
  ).sort((first, second) => (pageOrder.get(first.page) ?? 99) - (pageOrder.get(second.page) ?? 99) || (first.placement === "hero" ? -1 : 1) - (second.placement === "hero" ? -1 : 1));
  const pageCounts = new Map<string, number>();
  const imageTasks: RenderedImageTask[] = normalizedSlots.map((slot) => {
    const pageName = slot.page === "/" ? "home" : slot.page.slice(1);
    const pageIndex = pageCounts.get(slot.page) ?? 0;
    pageCounts.set(slot.page, pageIndex + 1);
    const outputFilename = slot.placement === "hero" && pageIndex === 0
      ? `hero-${pageName}.webp`
      : `image-${pageIndex + 1}-${pageName}.webp`;
    return {
      slot: slot.id,
      page: slot.page,
      aspectRatio: slot.aspectRatio,
      prompt: `${design.imagery.treatment} treatment. ${slot.subject}. Client context: ${content.company.businessType}; ${content.company.description}`,
      altText: `${content.company.name} ${content.company.businessType}`,
      outputFilename,
    };
  });

  const files = new Map<string, string>();

  for (const page of PAGES) {
    const pageImages = imageTasks
      .filter((task) => task.page === page.slug)
      .map((task) => ({ url: `/assets/images/${task.outputFilename}`, alt: task.altText }));
    const heroImage = pageImages[0]?.url ?? null;
    const sections = composePage(page.slug, content, design, pageImages);
    const nav = renderNav({ brand: content.company.name, logoUrl: content.company.logoUrl, items: navItems, currentSlug: page.slug });

    const heading = page.slug === "/" ? content.hero.homeHeading
      : page.slug === "/services" ? content.hero.servicesHeading
      : page.slug === "/about" ? content.hero.aboutHeading
      : content.hero.contactHeading;
    const desc = content.company.description;
    const canonicalUrl = `${siteUrl}${page.slug === "/" ? "" : page.slug}`;

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: content.company.name,
      description: desc,
      url: siteUrl,
      email: content.contact.email ?? undefined,
      telephone: content.contact.phone ?? undefined,
    };

    const head = buildHead({
      title: `${heading} - ${content.company.name}`,
      metaDescription: desc,
      canonicalUrl,
      cssVars: tokens.cssVars,
      googleFonts: tokens.googleFonts,
      ogImage: heroImage,
      jsonLd,
    });

    files.set(page.path, buildPageHtml(page.slug, sections, head, nav, footer));
  }

  const rootVars = `:root {\n${Object.entries(tokens.cssVars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;
  const css = [rootVars, buildPrimitiveCss(), interactionCss.css].join("\n\n");
  files.set("assets/styles.css", css);

  const interactionJs = interactionBlueprintToJs(interactionCss.enabledKinds);
  const contactJs = buildContactJs();
  files.set("assets/app.js", `${interactionJs}\n${contactJs}`);

  const sitemapPages = PAGES.map((p) => ({ slug: p.slug, lastmod: new Date().toISOString().split("T")[0] }));
  files.set("sitemap.xml", generateSitemapXml(sitemapPages, siteUrl));
  files.set("robots.txt", generateRobotsTxt(siteUrl));

  if ([...files.values()].some((file) => file.includes('class="icon"'))) {
    files.set("THIRD_PARTY_NOTICES.txt", LUCIDE_NOTICE);
  }

  return { files, tokens: { cssVars: tokens.cssVars, googleFonts: tokens.googleFonts }, imageTasks };
}
