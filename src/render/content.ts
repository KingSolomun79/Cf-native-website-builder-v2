// Deterministic content derivation from intake facts.
//
// The render path is LLM-free: every word a page displays comes from the intake
// the client submitted, mapped deterministically here. No model output is used as
// body copy, so there is no path for the model to inject HTML into page text.

import type { NormalizedIntake, SiteSpec, SiteSpecSection } from "../types";
import type { RenderContent } from "./primitives";

function nonEmpty(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

export function buildRenderContent(intake: NormalizedIntake, revisionSpec?: SiteSpec): RenderContent {
  const name = nonEmpty(revisionSpec?.site.companyName) ?? (intake.companyName || "Our Company");
  const tagline = nonEmpty(intake.businessType) ?? name;
  const description = nonEmpty(revisionSpec?.site.brandSummary) ?? nonEmpty(intake.businessDescription) ?? `${name} — ${nonEmpty(intake.businessType) ?? "business"}.`;
  const idealClient = nonEmpty(revisionSpec?.site.idealClientProfile) ?? nonEmpty(intake.idealClientProfile);
  const businessType = nonEmpty(revisionSpec?.site.businessType) ?? nonEmpty(intake.businessType) ?? "business";

  const address = [
    intake.addressLine1,
    intake.addressLine2,
    intake.city,
    intake.county,
    intake.zipCode,
    intake.country,
  ].map((p) => nonEmpty(p)).filter((p): p is string => p !== null).join(", ");

  const phone = nonEmpty(intake.whatsappNumber);

  const homePage = revisionSpec?.pages.find((page) => page.slug === "/");
  const servicesPage = revisionSpec?.pages.find((page) => page.slug === "/services");
  const aboutPage = revisionSpec?.pages.find((page) => page.slug === "/about");
  const contactPage = revisionSpec?.pages.find((page) => page.slug === "/contact");
  const serviceSection = servicesPage?.sections.find((section) => section.type === "services-grid") ?? homePage?.sections.find((section) => section.type === "services-grid");
  const revisedServices = servicesFromSection(serviceSection);
  const aboutSection = aboutPage?.sections.find((section) => section.type === "text-block" || section.type === "image-text");
  const cta = [...(homePage?.sections ?? []), ...(contactPage?.sections ?? [])].find((section) => section.type === "cta");

  return {
    company: {
      name,
      tagline,
      description,
      idealClient,
      businessType,
      logoUrl: intake.logoUrl ? "/assets/images/logo.webp" : null,
    },
    contact: {
      email: nonEmpty(intake.clientEmail),
      whatsapp: nonEmpty(intake.whatsappNumber),
      phone,
      address: nonEmpty(address),
    },
    socials: {
      facebook: nonEmpty(intake.facebookUrl),
      instagram: nonEmpty(intake.instagramUrl),
      twitter: nonEmpty(intake.twitterUrl),
      linkedin: nonEmpty(intake.linkedinUrl),
      other: nonEmpty(intake.otherSocialUrl),
    },
    hero: {
      homeHeading: nonEmpty(homePage?.h1) ?? name,
      homeSubheading: sectionText(homePage?.sections.find((section) => section.type === "hero"), description),
      servicesHeading: nonEmpty(servicesPage?.h1) ?? `Our ${capitalize(businessType)}`,
      servicesSubheading: sectionText(servicesPage?.sections.find((section) => section.type === "hero"), description),
      aboutHeading: nonEmpty(aboutPage?.h1) ?? `About ${name}`,
      aboutSubheading: sectionText(aboutPage?.sections.find((section) => section.type === "hero"), idealClient
        ? `Intended clients: ${idealClient}.`
        : description),
      contactHeading: nonEmpty(contactPage?.h1) ?? `Get in touch with ${name}`,
      contactSubheading: sectionText(contactPage?.sections.find((section) => section.type === "hero"), phone ? `Call, WhatsApp, or use the contact form below.` : `Use the contact form below to send an enquiry.`),
    },
    services: revisedServices.length > 0 ? revisedServices : deriveServices(businessType, description, idealClient, nonEmpty(address)),
    aboutParagraphs: nonEmpty(aboutSection?.body) ? [aboutSection!.body!.trim()] : buildAboutParagraphs(name, description, idealClient, businessType),
    stats: buildHighlights(businessType, idealClient, nonEmpty(address)),
    cta: {
      heading: nonEmpty(cta?.heading) ?? `Contact ${name}`,
      body: nonEmpty(cta?.body) ?? `Use the contact page to share your enquiry.`,
      buttonLabel: nonEmpty(cta?.ctaLabel) ?? "Contact us",
    },
  };
}

function deriveServices(businessType: string, description: string, idealClient: string | null, address: string | null): { title: string; description: string }[] {
  return [
    { title: capitalize(businessType), description },
    idealClient ? { title: "Intended clients", description: idealClient } : null,
    address ? { title: "Location", description: address } : null,
  ].filter((item): item is { title: string; description: string } => item !== null);
}

function sectionText(section: SiteSpecSection | undefined, fallback: string): string {
  return nonEmpty(section?.subheading) ?? nonEmpty(section?.body) ?? fallback;
}

function servicesFromSection(section: SiteSpecSection | undefined): { title: string; description: string }[] {
  if (!section?.items) return [];
  return section.items.map((item) => {
    const title = typeof item.title === "string" ? nonEmpty(item.title) : null;
    const description = typeof item.description === "string"
      ? nonEmpty(item.description)
      : typeof item.body === "string"
        ? nonEmpty(item.body)
        : null;
    return title && description ? { title, description } : null;
  }).filter((item): item is { title: string; description: string } => item !== null);
}

function buildAboutParagraphs(name: string, description: string, idealClient: string | null, businessType: string): string[] {
  return [
    description,
    `Business: ${name}. Focus: ${businessType}.`,
    idealClient ? `Intended clients: ${idealClient}.` : null,
  ].filter((paragraph): paragraph is string => paragraph !== null);
}

function buildHighlights(businessType: string, idealClient: string | null, address: string | null): { value: string; label: string }[] {
  return [
    { value: capitalize(businessType), label: "Business focus" },
    idealClient ? { value: idealClient, label: "Intended clients" } : null,
    address ? { value: address, label: "Location" } : null,
  ].filter((item): item is { value: string; label: string } => item !== null);
}

function capitalize(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length === 0) return s;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
