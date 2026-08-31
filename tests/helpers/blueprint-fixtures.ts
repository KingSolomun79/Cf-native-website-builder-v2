import type { DesignBlueprintV2, InteractionBlueprintV2 } from "../../src/lib/blueprint-schema-v2";
import type { NormalizedIntake } from "../../src/types";

export function makeDesign(overrides: Partial<DesignBlueprintV2> = {}): DesignBlueprintV2 {
  const evidence = {
    source: "screenshot" as const,
    artifactKey: "artifacts/screenshot.json",
  };
  return {
    schemaVersion: 1,
    source: {
      referenceUrl: "https://example.com",
      finalUrl: "https://example.com",
      captureManifestR2Key: null,
      interactionManifestR2Key: null,
      screenshotR2Key: "artifacts/screenshot.png",
      registryR2Key: "registries/r1.json",
      registryVersion: 1,
    },
    layout: {
      navStyle: "sticky header",
      footerStyle: "minimal footer",
      gridSystem: "12 column",
      sections: [
        { id: "s1", type: "hero", role: "introduction", order: 0, composition: "centered headline", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        { id: "s2", type: "features", role: "services", order: 1, composition: "three column grid", evidenceIds: ["e1"], evidence, confidence: 0.8 },
        { id: "s3", type: "about", role: "story", order: 2, composition: "single column prose", evidenceIds: ["e1"], evidence, confidence: 0.8 },
      ],
    },
    typography: {
      body: { element: "body", fontFamily: "Inter", fontSize: "1rem", fontWeight: "400", lineHeight: "1.6", evidenceIds: ["e1"], evidence, confidence: 0.9 },
      headings: [{ element: "h1", fontFamily: "Playfair Display", fontSize: "2.5rem", fontWeight: "700", lineHeight: "1.15", evidenceIds: ["e1"], evidence, confidence: 0.9 }],
      scale: "1.25",
    },
    colors: {
      roles: [
        { role: "background", value: "#ffffff", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        { role: "text", value: "#111111", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        { role: "primary", value: "#2563eb", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        { role: "accent", value: "#0ea5e9", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        { role: "surface", value: "#f1f5f9", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        { role: "muted", value: "#64748b", evidenceIds: ["e1"], evidence, confidence: 0.9 },
        { role: "border", value: "#e2e8f0", evidenceIds: ["e1"], evidence, confidence: 0.9 },
      ],
    },
    spacing: { sectionPadding: "5rem", rhythm: "consistent", evidenceIds: ["e1"], evidence, confidence: 0.8 },
    surfaces: { cards: "rounded", buttons: "pill", inputs: "boxed", evidenceIds: ["e1"], evidence, confidence: 0.8 },
    imagery: { treatment: "photographic", slots: [
      { id: "home-hero", page: "/", placement: "hero", aspectRatio: "16:9", subject: `${overrides.source?.referenceUrl ?? "Client"} homepage hero`, evidenceIds: ["e1"], evidence, confidence: 0.9 },
      { id: "home-about", page: "/", placement: "section", aspectRatio: "4:3", subject: "Client team or work", evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { id: "home-context", page: "/", placement: "section", aspectRatio: "16:9", subject: "Client service context", evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { id: "services-hero", page: "/services", placement: "hero", aspectRatio: "16:9", subject: "Services overview", evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { id: "services-detail", page: "/services", placement: "section", aspectRatio: "4:3", subject: "Service detail", evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { id: "services-context", page: "/services", placement: "section", aspectRatio: "16:9", subject: "Services in context", evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { id: "about-hero", page: "/about", placement: "hero", aspectRatio: "16:9", subject: "About the client", evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { id: "contact-hero", page: "/contact", placement: "hero", aspectRatio: "16:9", subject: "Welcoming contact context", evidenceIds: ["e1"], evidence, confidence: 0.8 },
    ] },
    navigation: { structure: "horizontal", items: ["Home", "Services", "About", "Contact"], responsiveBehavior: "hamburger below 768px" },
    responsive: { breakpoints: [768], changes: ["stack columns"] },
    icons: { intents: [] },
    confidence: 0.85,
    ...overrides,
  };
}

export function makeInteraction(overrides: Partial<InteractionBlueprintV2> = {}): InteractionBlueprintV2 {
  const evidence = { source: "interaction" as const, artifactKey: "artifacts/interaction.json" };
  return {
    schemaVersion: 1,
    source: { registryR2Key: "registries/r1.json", registryVersion: 1 },
    interactions: [
      { trigger: "scroll-reveal", target: "sections", selector: "[data-reveal]", property: "opacity", duration: "0.6s", easing: "ease", delay: "0s", hover: "none", focus: "none", active: "none", scrollBehavior: "reveal on enter", reducedMotionBehavior: "show immediately", observed: true, evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { trigger: "hover", target: "buttons", selector: ".btn", property: "transform", duration: "0.2s", easing: "ease", delay: "0s", hover: "lift", focus: "outline", active: "press", scrollBehavior: "none", reducedMotionBehavior: "no transform", observed: true, evidenceIds: ["e1"], evidence, confidence: 0.8 },
      { trigger: "focus", target: "buttons", selector: ".btn", property: "outline", duration: "0s", easing: "linear", delay: "0s", hover: "none", focus: "visible outline", active: "none", scrollBehavior: "none", reducedMotionBehavior: "keep visible focus state", observed: false, evidenceIds: ["e1"], evidence, confidence: 0.8 },
    ],
    reducedMotionStrategy: "Disable all motion when prefers-reduced-motion: reduce.",
    confidence: 0.8,
    ...overrides,
  };
}

export function makeIntake(overrides: Partial<NormalizedIntake> = {}): NormalizedIntake {
  return {
    companyName: "Acme Studio",
    clientEmail: "hello@acme.example",
    businessType: "design services",
    businessDescription: "Acme Studio crafts brand identities for ambitious startups.",
    idealClientProfile: "early-stage startups",
    logoUrl: null,
    preferredColour1: null,
    preferredColour2: null,
    mode: "light",
    addressLine1: "12 Market Street",
    addressLine2: null,
    city: "Nairobi",
    county: "Nairobi",
    zipCode: "00100",
    country: "Kenya",
    facebookUrl: "https://facebook.com/acme",
    instagramUrl: null,
    twitterUrl: null,
    linkedinUrl: "https://linkedin.com/company/acme",
    otherSocialUrl: null,
    extraInformation: null,
    whatsappNumber: "+254700000000",
    referenceSiteUrl: "https://example.com",
    referenceScreenshotR2Key: "artifacts/screenshot.png",
    referenceHomeScreenshotUploadId: null,
    ...overrides,
  };
}
