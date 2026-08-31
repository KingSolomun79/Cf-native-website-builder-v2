import type { FluentFormsPayload, NormalizedIntake, ProvenanceManifestV1 } from "../types";
import { validateReferenceUrl } from "./reference-input";
import { validateProvenanceManifest } from "./provenance";

interface ValidationError {
  field: string;
  message: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isValidOutputFilename(filename: string): boolean {
  return /^[a-z0-9-]+\.(webp|png|jpg|jpeg|svg)$/.test(filename);
}

export function validateIntake(payload: FluentFormsPayload): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (!payload.company_name?.trim()) {
    errors.push({ field: "company_name", message: "Company name is required" });
  }

  if (!payload.client_email?.trim()) {
    errors.push({ field: "client_email", message: "Client email is required" });
  } else if (!isValidEmail(payload.client_email.trim())) {
    errors.push({ field: "client_email", message: "Invalid email format" });
  }

  if (payload.logo_url?.trim()) {
    const normalizedLogoUrl = normalizeUrl(payload.logo_url);
    if (!normalizedLogoUrl || !validateReferenceUrl(normalizedLogoUrl)) {
      errors.push({ field: "logo_url", message: "Logo URL must be a public HTTP or HTTPS URL" });
    }
  }

  const referenceUrlRaw = payload.reference_site_url ?? payload.inspiration_url;
  if (referenceUrlRaw?.trim()) {
    const normalizedReferenceUrl = normalizeUrl(referenceUrlRaw);
    if (!normalizedReferenceUrl || !validateReferenceUrl(normalizedReferenceUrl)) {
      errors.push({ field: "reference_site_url", message: "Reference site URL must be a public HTTP or HTTPS URL" });
    }
  }

  return { valid: errors.length === 0, errors };
}

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  let normalized = url.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  normalized = normalized.replace(/\/+$/, "");
  return isValidUrl(normalized) ? normalized : null;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim();
}

export function normalizeIntake(payload: FluentFormsPayload): NormalizedIntake {
  return {
    companyName: payload.company_name?.trim() ?? "",
    clientEmail: payload.client_email?.trim() ?? "",
    businessType: normalizeNullableString(payload.business_type),
    businessDescription: normalizeNullableString(payload.business_description),
    idealClientProfile: normalizeNullableString(payload.ideal_client_profile),
    logoUrl: normalizeUrl(payload.logo_url),
    preferredColour1: normalizeNullableString(payload.preferred_colour_1),
    preferredColour2: normalizeNullableString(payload.preferred_colour_2),
    mode: payload.mode?.trim() === "dark" ? "dark" : "light",
    addressLine1: normalizeNullableString(payload.address_line_1),
    addressLine2: normalizeNullableString(payload.address_line_2),
    city: normalizeNullableString(payload.city),
    county: normalizeNullableString(payload.county),
    zipCode: normalizeNullableString(payload.zip_code),
    country: normalizeNullableString(payload.country),
    facebookUrl: normalizeUrl(payload.facebook_url),
    instagramUrl: normalizeUrl(payload.instagram_url),
    twitterUrl: normalizeUrl(payload.twitter_url),
    linkedinUrl: normalizeUrl(payload.linkedin_url),
    otherSocialUrl: normalizeUrl(payload.other_social_url),
    extraInformation: normalizeNullableString(payload.extra_information),
    whatsappNumber: normalizeNullableString(payload.whatsapp_number),
    referenceSiteUrl: (() => {
      const raw = payload.reference_site_url ?? payload.inspiration_url;
      const normalized = normalizeUrl(raw);
      return normalized ? validateReferenceUrl(normalized) : null;
    })(),
    referenceScreenshotR2Key: null,
    referenceHomeScreenshotUploadId: null,
  };
}

const VALID_INTERNAL_SLUGS = new Set(["/", "/services", "/about", "/contact"]);
const MIN_SECTIONS_BY_SLUG: Record<string, number> = {
  "/": 7,
  "/services": 6,
  "/about": 4,
  "/contact": 2,
};

export function validateSiteSpec(spec: unknown, options: { requireProvenance?: boolean } = {}): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (!spec || typeof spec !== "object") {
    return { valid: false, errors: [{ field: "root", message: "Spec must be a valid JSON object" }] };
  }

  const s = spec as Record<string, unknown>;

  if (!s.site || typeof s.site !== "object") {
    errors.push({ field: "site", message: "Missing or invalid 'site' object" });
  } else {
    const site = s.site as Record<string, unknown>;
    if (!site.companyName || typeof site.companyName !== "string") {
      errors.push({ field: "site.companyName", message: "Missing or invalid companyName" });
    }
    if (!site.clientEmail || typeof site.clientEmail !== "string") {
      errors.push({ field: "site.clientEmail", message: "Missing or invalid clientEmail" });
    } else if (!isValidEmail(site.clientEmail)) {
      errors.push({ field: "site.clientEmail", message: "Invalid email format" });
    }
    const socials = site.socials as Record<string, unknown> | undefined;
    if (socials && typeof socials === "object") {
      for (const key of ["facebook", "instagram", "twitter", "linkedin", "other"] as const) {
        const val = socials[key];
        if (val !== null && val !== undefined && typeof val === "string" && val.trim()) {
          if (!isValidUrl(val.trim())) {
            errors.push({ field: `site.socials.${key}`, message: `Invalid social URL for ${key}` });
          }
        }
      }
    }
  }

  if (!Array.isArray(s.pages) || s.pages.length !== 4) {
    errors.push({ field: "pages", message: "Must have exactly 4 pages" });
  } else {
    const requiredSlugs = ["/", "/services", "/about", "/contact"];
    const actualSlugs = s.pages.map((p: Record<string, unknown>) => p.slug);
    for (const required of requiredSlugs) {
      if (!actualSlugs.includes(required)) {
        errors.push({ field: "pages", message: `Missing required page with slug '${required}'` });
      }
    }

    const titles: string[] = [];
    const descs: string[] = [];

    for (const page of s.pages) {
      const p = page as Record<string, unknown>;
      const slug = p.slug as string;
      const title = p.seoTitle as string | undefined;
      const desc = p.metaDescription as string | undefined;

      if (!title || title.length < 30 || title.length > 60) {
        errors.push({ field: `pages.${slug}.seoTitle`, message: `seoTitle must be 30-60 chars (got ${title?.length ?? 0})` });
      } else {
        titles.push(title);
      }

      if (!desc || desc.length < 120 || desc.length > 160) {
        errors.push({ field: `pages.${slug}.metaDescription`, message: `metaDescription must be 120-160 chars (got ${desc?.length ?? 0})` });
      } else {
        descs.push(desc);
      }

      if (!p.h1 || typeof p.h1 !== "string" || !p.h1.trim()) {
        errors.push({ field: `pages.${slug}.h1`, message: "h1 is required and must not be empty" });
      }
      if (!Array.isArray(p.sections) || (p.sections as unknown[]).length === 0) {
        errors.push({ field: `pages.${slug}.sections`, message: "Each page must have at least one section" });
      } else {
        const minimumSections = MIN_SECTIONS_BY_SLUG[slug] ?? 1;
        if (p.sections.length < minimumSections) {
          errors.push({
            field: `pages.${slug}.sections`,
            message: `Page '${slug}' must have at least ${minimumSections} sections (got ${p.sections.length})`,
          });
        }
      }

      if (Array.isArray(p.sections)) {
        if (slug === "/") {
          const sectionTypes = p.sections.map((section) => (section as Record<string, unknown>).type);
          for (const requiredType of ["hero", "services-grid", "stats", "cta"]) {
            if (!sectionTypes.includes(requiredType)) {
              errors.push({
                field: `pages.${slug}.sections`,
                message: `Home page must include a '${requiredType}' section`,
              });
            }
          }
        }

          if (slug === "/services") {
            const sectionTypes = p.sections.map((section) => (section as Record<string, unknown>).type);
            if (!sectionTypes.includes("services-grid")) {
              errors.push({
                field: `pages.${slug}.sections`,
                message: "Services page must include a 'services-grid' section",
              });
            }
            if (!sectionTypes.some((type) => type === "text-block" || type === "stats" || type === "image-text")) {
              errors.push({
                field: `pages.${slug}.sections`,
                message: "Services page must include at least one supporting section: text-block, stats, or image-text",
              });
            }
          }

          if (slug === "/about") {
            const sectionTypes = p.sections.map((section) => (section as Record<string, unknown>).type);
            const hasStory = sectionTypes.some((t) => t === "about-story" || t === "text-block");
            if (!hasStory) {
              errors.push({
                field: `pages.${slug}.sections`,
                message: "About page must include an about-story or text-block section",
              });
            }
          }

        for (let i = 0; i < p.sections.length; i++) {
          const section = p.sections[i] as Record<string, unknown>;
          const sectionType = section.type as string | undefined;
          const ctaHref = section.ctaHref as string | undefined | null;

          if (sectionType === "services-grid") {
            const items = Array.isArray(section.items) ? section.items : [];
            for (let j = 0; j < items.length; j++) {
              const item = items[j] as Record<string, unknown>;
              const title = typeof item.title === "string" ? item.title.trim() : "";
              const description = typeof item.description === "string"
                ? item.description.trim()
                : typeof item.body === "string"
                  ? item.body.trim()
                  : "";
              if (!title) {
                errors.push({ field: `pages.${slug}.sections[${i}].items[${j}].title`, message: "Service item title is required" });
              }
              if (!description) {
                errors.push({ field: `pages.${slug}.sections[${i}].items[${j}].description`, message: "Service item description is required" });
              }
            }
          }

          if (sectionType === "stats") {
            const items = Array.isArray(section.items) ? section.items : [];
            for (let j = 0; j < items.length; j++) {
              const item = items[j] as Record<string, unknown>;
              const value = typeof item.value === "string"
                ? item.value.trim()
                : typeof item.stat === "string"
                  ? item.stat.trim()
                  : "";
              const label = typeof item.label === "string"
                ? item.label.trim()
                : typeof item.title === "string"
                  ? item.title.trim()
                  : "";
              if (!value) {
                errors.push({ field: `pages.${slug}.sections[${i}].items[${j}].value`, message: "Stat value is required" });
              }
              if (!label) {
                errors.push({ field: `pages.${slug}.sections[${i}].items[${j}].label`, message: "Stat label is required" });
              }
            }
          }

          if (ctaHref && typeof ctaHref === "string" && ctaHref.trim()) {
            const trimmed = ctaHref.trim();
            if (trimmed.startsWith("/") && !VALID_INTERNAL_SLUGS.has(trimmed)) {
              errors.push({
                field: `pages.${slug}.sections[${i}].ctaHref`,
                message: `Invalid internal link: '${trimmed}' — must be one of ${[...VALID_INTERNAL_SLUGS].join(", ")}`,
              });
            } else if (trimmed.startsWith("http") && !isValidUrl(trimmed)) {
              errors.push({
                field: `pages.${slug}.sections[${i}].ctaHref`,
                message: `Invalid URL in ctaHref: '${trimmed}'`,
              });
            }
          }

          const bodyText = typeof section.body === "string" ? section.body : typeof section.subheadline === "string" ? section.subheadline : "";
          if (bodyText) {
            const wordCount = bodyText.split(/\s+/).filter((w: string) => w.length > 0).length;
            if (sectionType === "text-block" && wordCount < 60) {
              errors.push({
                field: `pages.${slug}.sections[${i}].body`,
                message: `text-block body must be at least 60 words (got ${wordCount})`,
              });
            }
            if ((sectionType === "about-story" || sectionType === "text-block") && wordCount < 60 && (slug === "/about" || slug === "/")) {
              errors.push({
                field: `pages.${slug}.sections[${i}].body`,
                message: `${sectionType} on ${slug} must be at least 60 words (got ${wordCount})`,
              });
            }
          }
        }
      }

      const minImagesBySlug: Record<string, number> = {
        "/": 3,
        "/services": 3,
        "/about": 1,
        "/contact": 1,
      };
      const minImages = minImagesBySlug[slug] ?? 1;

      const imagesArray = Array.isArray(p.images) ? p.images : [];
      if (imagesArray.length < minImages) {
        errors.push({ field: `pages.${slug}.images`, message: `Page '${slug}' must have at least ${minImages} images (got ${imagesArray.length})` });
      }

      if (Array.isArray(p.images)) {
        for (let i = 0; i < p.images.length; i++) {
          const img = p.images[i] as Record<string, unknown>;
          if (!img.prompt || typeof img.prompt !== "string" || !img.prompt.trim()) {
            errors.push({ field: `pages.${slug}.images[${i}].prompt`, message: "Image prompt is required" });
          }
          if (!img.altText || typeof img.altText !== "string" || !img.altText.trim()) {
            errors.push({ field: `pages.${slug}.images[${i}].altText`, message: "Image altText is required" });
          }
          if (!img.slot || typeof img.slot !== "string" || !img.slot.trim()) {
            errors.push({ field: `pages.${slug}.images[${i}].slot`, message: "Image slot is required" });
          }
          if (!img.outputFilename || typeof img.outputFilename !== "string" || !isValidOutputFilename(img.outputFilename)) {
            errors.push({ field: `pages.${slug}.images[${i}].outputFilename`, message: `Invalid outputFilename: must match pattern like 'hero-01.webp'` });
          }
          if (!img.targetPage || typeof img.targetPage !== "string" || !VALID_INTERNAL_SLUGS.has(img.targetPage)) {
            errors.push({ field: `pages.${slug}.images[${i}].targetPage`, message: `Invalid targetPage: must be one of ${[...VALID_INTERNAL_SLUGS].join(", ")}` });
          }
        }
      }
    }

    const uniqueTitles = new Set(titles);
    const uniqueDescs = new Set(descs);
    if (uniqueTitles.size !== titles.length) {
      errors.push({ field: "pages.seoTitle", message: "Each page must have a unique SEO title" });
    }
    if (uniqueDescs.size !== descs.length) {
      errors.push({ field: "pages.metaDescription", message: "Each page must have a unique meta description" });
    }
  }

  if (s.seo && typeof s.seo === "object") {
    const seo = s.seo as Record<string, unknown>;
    if (seo.localBusiness && typeof seo.localBusiness === "object") {
      const lb = seo.localBusiness as Record<string, unknown>;
      if (lb.addressLocality !== null && lb.addressLocality !== undefined && typeof lb.addressLocality !== "string") {
        errors.push({ field: "seo.localBusiness.addressLocality", message: "addressLocality must be a string or null" });
      }
      if (lb.addressCountry !== null && lb.addressCountry !== undefined && typeof lb.addressCountry !== "string") {
        errors.push({ field: "seo.localBusiness.addressCountry", message: "addressCountry must be a string or null" });
      }
    }
  }

  if (options.requireProvenance || s.provenance !== undefined) {
    const provenance = validateProvenanceManifest(s.provenance as ProvenanceManifestV1 | undefined);
    for (const issue of provenance.issues) {
      errors.push({ field: issue.path, message: `${issue.code}: ${issue.message}` });
    }
  }

  return { valid: errors.length === 0, errors };
}
