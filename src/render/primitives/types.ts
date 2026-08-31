// Shared content + option shapes consumed by the deterministic primitives.
//
// Content is produced deterministically from intake (see content.ts). Options
// (variant, href, etc.) are produced by the renderer from sanitized blueprint
// values. Every string a primitive emits passes through escapeHtml via text().

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps {
  label: string;
  href?: string | null;
  variant?: ButtonVariant;
  type?: "button" | "submit";
  ariaLabel?: string | null;
}

export interface CardProps {
  title: string;
  body: string;
  // Semantic icon intent (e.g. "location", "contact"). Resolved to an approved
  // inline Lucide SVG at build time; unknown intents omit the icon.
  iconIntent?: string | null;
  // Legacy text-glyph slot. Ignored when iconIntent resolves to a known icon.
  iconLabel?: string | null;
}

export interface AccordionItem {
  summary: string;
  detail: string;
}

export interface MediaProps {
  src: string | null;
  alt: string;
  ratio?: "16/9" | "4/3" | "1/1" | "3/2";
  loading?: "eager" | "lazy";
}

export interface CtaProps {
  heading: string;
  body?: string | null;
  button?: ButtonProps | null;
}

export interface NavItem {
  label: string;
  href: string;
}

export interface NavProps {
  brand: string;
  logoUrl?: string | null;
  items: NavItem[];
  currentSlug: string;
}

export interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea";
  required?: boolean;
  autocomplete?: string;
}

export interface ContactFormProps {
  action: string;
  fields: FormField[];
  whatsappNumber?: string | null;
  submitLabel?: string;
}

export interface SectionProps {
  kind: string;
  ariaLabel?: string | null;
  variant?: "default" | "inverted" | "accent";
  innerHtml: string;
}

export interface RenderContent {
  company: {
    name: string;
    tagline: string;
    description: string;
    idealClient: string | null;
    businessType: string;
    logoUrl: string | null;
  };
  contact: {
    email: string | null;
    whatsapp: string | null;
    phone: string | null;
    address: string | null;
  };
  socials: {
    facebook: string | null;
    instagram: string | null;
    twitter: string | null;
    linkedin: string | null;
    other: string | null;
  };
  hero: {
    homeHeading: string;
    homeSubheading: string;
    servicesHeading: string;
    servicesSubheading: string;
    aboutHeading: string;
    aboutSubheading: string;
    contactHeading: string;
    contactSubheading: string;
  };
  services: { title: string; description: string }[];
  aboutParagraphs: string[];
  stats: { value: string; label: string }[];
  cta: { heading: string; body: string; buttonLabel: string };
}
