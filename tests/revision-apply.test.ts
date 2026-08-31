import { describe, it, expect } from "vitest";
import type { SiteSpec, RevisionPlan, SiteSpecSection } from "../src/types";
import { applyRevisionToSpec } from "../src/agents/reviewer-agent";

function makeSpec(): SiteSpec {
  return {
    site: {
      companyName: "Test Co",
      clientEmail: "test@test.com",
      businessType: "Electrical Contractor",
      brandSummary: "A test company.",
      idealClientProfile: "Homeowners",
      styleKey: "minimalist-monochrome",
      mode: "dark",
      logoUrl: "",
      socials: { facebook: null, instagram: null, twitter: null, linkedin: null, other: null },
    },
    pages: [
      {
        slug: "/",
        name: "Home",
        seoTitle: "Home",
        metaDescription: "Home page",
        h1: "Welcome",
        sections: [
          { type: "hero", heading: "Hero", subheading: "Sub", body: null, items: null, ctaLabel: "Get Started", ctaHref: "/contact", inverted: false },
          { type: "services-grid", heading: "Services", subheading: null, body: null, items: [{ title: "Wiring", description: "Wiring desc" }], ctaLabel: null, ctaHref: null, inverted: false },
          { type: "text-block", heading: "A Regional Standard", subheading: null, body: "We deliver precise code-compliant electrical systems for residential commercial and industrial applications across Nakuru County.", items: null, ctaLabel: null, ctaHref: null, inverted: false },
          { type: "text-block", heading: "Our Methodology", subheading: null, body: "Every project follows a structured approach from initial assessment through installation testing and handover.", items: null, ctaLabel: null, ctaHref: null, inverted: false },
          { type: "cta", heading: "Ready?", subheading: null, body: null, items: null, ctaLabel: "Contact Us", ctaHref: "/contact", inverted: false },
        ],
        images: [
          { slot: "hero", aspectRatio: "16:9", prompt: "test", altText: "hero", targetPage: "/", outputFilename: "hero.webp" },
        ],
        internalLinks: ["/services", "/about", "/contact"],
      },
      {
        slug: "/about",
        name: "About",
        seoTitle: "About",
        metaDescription: "About page",
        h1: "About Us",
        sections: [
          { type: "about-preview", heading: "Who We Are", subheading: null, body: "A team of licensed professionals.", items: null, ctaLabel: null, ctaHref: null, inverted: false },
          { type: "text-block", heading: "Our Standards", subheading: null, body: "We maintain the highest standards.", items: null, ctaLabel: null, ctaHref: null, inverted: false },
        ],
        images: [],
        internalLinks: ["/", "/services", "/contact"],
      },
      {
        slug: "/services",
        name: "Services",
        seoTitle: "Services",
        metaDescription: "Services page",
        h1: "Our Services",
        sections: [
          { type: "hero", heading: "Services", subheading: "What we do", body: null, items: null, ctaLabel: null, ctaHref: null, inverted: false },
          { type: "services-grid", heading: "Our Offerings", subheading: null, body: null, items: [{ title: "Wiring", description: "desc" }], ctaLabel: null, ctaHref: null, inverted: false },
          { type: "text-block", heading: "Capabilities", subheading: null, body: "Full range of services.", items: null, ctaLabel: null, ctaHref: null, inverted: false },
        ],
        images: [],
        internalLinks: ["/", "/about", "/contact"],
      },
      {
        slug: "/contact",
        name: "Contact",
        seoTitle: "Contact",
        metaDescription: "Contact page",
        h1: "Get in Touch",
        sections: [
          { type: "hero", heading: "Contact Us", subheading: null, body: null, items: null, ctaLabel: null, ctaHref: null, inverted: false },
        ],
        images: [],
        internalLinks: ["/", "/services", "/about"],
      },
    ],
    seo: {
      localBusiness: { name: "Test Co", addressLocality: "Nakuru", addressCountry: "Kenya", telephone: null, url: "https://test.com" },
      sameAs: [],
    },
  };
}

describe("applyRevisionToSpec", () => {
  it("OLD BUG: free-form instruction produces NO changes (baseline)", () => {
    const spec = makeSpec();
    const plan: RevisionPlan = {
      summary: "Convert sections",
      changes: [
        {
          type: "section",
          page: "/",
          target: "sections[2]",
          instruction: "Convert 'A Regional Standard' text-block to image-text layout (Image Left, Text Right)",
          reason: "Client request",
        },
      ],
      affectedPages: ["/"],
      requiresImageRegeneration: true,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[0].sections[2].type).toBe("text-block");
    expect(result.pages[0].sections[2].heading).toBe("A Regional Standard");
  });

  it("Replace section at: converts text-block to image-text", () => {
    const spec = makeSpec();
    const newSection = {
      type: "image-text",
      heading: "A Regional Standard",
      subheading: null,
      body: "We deliver precise code-compliant electrical systems for residential commercial and industrial applications across Nakuru County.",
      items: null,
      ctaLabel: null,
      ctaHref: null,
      inverted: false,
    };

    const plan: RevisionPlan = {
      summary: "Convert sections to image-text",
      changes: [
        {
          type: "section",
          page: "/",
          target: "sections",
          instruction: `Replace section at: 2 : ${JSON.stringify(newSection)}`,
          reason: "Client requested image-text layout",
        },
      ],
      affectedPages: ["/"],
      requiresImageRegeneration: true,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[0].sections[2].type).toBe("image-text");
    expect(result.pages[0].sections[2].heading).toBe("A Regional Standard");
    expect(result.pages[0].sections[2].body).toContain("precise");
    expect(result.pages[0].sections.length).toBe(5);
  });

  it("Replace section at: with inverted flag sets inverted", () => {
    const spec = makeSpec();
    const newSection = {
      type: "image-text",
      heading: "Our Methodology",
      subheading: null,
      body: "Every project follows a structured approach.",
      items: null,
      ctaLabel: null,
      ctaHref: null,
      inverted: true,
    };

    const plan: RevisionPlan = {
      summary: "Convert methodology to image-text inverted",
      changes: [
        {
          type: "section",
          page: "/",
          target: "sections",
          instruction: `Replace section at: 3 : ${JSON.stringify(newSection)}`,
          reason: "Opposite layout",
        },
      ],
      affectedPages: ["/"],
      requiresImageRegeneration: true,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[0].sections[3].type).toBe("image-text");
    expect(result.pages[0].sections[3].inverted).toBe(true);
  });

  it("Add section: with append target adds to correct page", () => {
    const spec = makeSpec();
    const newSection = {
      type: "text-block",
      heading: "Leadership & Standards",
      subheading: null,
      body: "Our leadership team brings decades of combined experience in electrical engineering and project management.",
      items: null,
      ctaLabel: null,
      ctaHref: null,
      inverted: false,
    };

    const plan: RevisionPlan = {
      summary: "Add leadership section to about",
      changes: [
        {
          type: "section",
          page: "/about",
          target: "append",
          instruction: `Add section: ${JSON.stringify(newSection)}`,
          reason: "Client requested extra about section",
        },
      ],
      affectedPages: ["/about"],
      requiresImageRegeneration: false,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[1].sections.length).toBe(3);
    expect(result.pages[1].sections[2].heading).toBe("Leadership & Standards");
    expect(result.pages[1].sections[2].type).toBe("text-block");
  });

  it("Remove section at: removes from correct page", () => {
    const spec = makeSpec();
    const plan: RevisionPlan = {
      summary: "Remove capabilities section",
      changes: [
        {
          type: "section",
          page: "/services",
          target: "sections",
          instruction: "Remove section at: 2",
          reason: "Redundant",
        },
      ],
      affectedPages: ["/services"],
      requiresImageRegeneration: false,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[2].sections.length).toBe(2);
    expect(result.pages[2].sections[1].heading).toBe("Our Offerings");
  });

  it("Replace with: updates a simple string field", () => {
    const spec = makeSpec();
    const plan: RevisionPlan = {
      summary: "Update heading",
      changes: [
        {
          type: "content",
          page: "/",
          target: "sections[2].heading",
          instruction: "Replace with: 'A Trusted Regional Standard'",
          reason: "Better heading",
        },
      ],
      affectedPages: ["/"],
      requiresImageRegeneration: false,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[0].sections[2].heading).toBe("A Trusted Regional Standard");
  });

  it("Replace with: parses JSON value for section field", () => {
    const spec = makeSpec();
    const plan: RevisionPlan = {
      summary: "Update services items",
      changes: [
        {
          type: "content",
          page: "/",
          target: "sections[1].items",
          instruction: `Replace with: ${JSON.stringify([{ title: "Solar", description: "Solar install" }])}`,
          reason: "Update services",
        },
      ],
      affectedPages: ["/"],
      requiresImageRegeneration: false,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[0].sections[1].items).toEqual([{ title: "Solar", description: "Solar install" }]);
  });

  it("full HITL revision flow: multiple changes across pages", () => {
    const spec = makeSpec();

    const imageTextSection1: SiteSpecSection = {
      type: "image-text",
      heading: "A Regional Standard",
      subheading: null,
      body: "We deliver precise code-compliant electrical systems for residential commercial and industrial applications across Nakuru County.",
      items: null,
      ctaLabel: null,
      ctaHref: null,
      inverted: false,
    };

    const imageTextSection2: SiteSpecSection = {
      type: "image-text",
      heading: "Our Methodology",
      subheading: null,
      body: "Every project follows a structured approach from initial assessment through installation testing and handover.",
      items: null,
      ctaLabel: null,
      ctaHref: null,
      inverted: true,
    };

    const aboutSection: SiteSpecSection = {
      type: "text-block",
      heading: "Leadership & Certifications",
      subheading: null,
      body: "Our leadership team holds NCA registration and EPRA licensing ensuring every project meets regulatory standards.",
      items: null,
      ctaLabel: null,
      ctaHref: null,
      inverted: false,
    };

    const servicesImageSection: SiteSpecSection = {
      type: "image-text",
      heading: "Our Capabilities",
      subheading: null,
      body: "From residential wiring to industrial maintenance we cover the full spectrum of electrical services.",
      items: null,
      ctaLabel: null,
      ctaHref: null,
      inverted: false,
    };

    const plan: RevisionPlan = {
      summary: "HITL revision: add images to home, about, services",
      changes: [
        {
          type: "section",
          page: "/",
          target: "sections",
          instruction: `Replace section at: 2 : ${JSON.stringify(imageTextSection1)}`,
          reason: "Convert to image-text layout",
        },
        {
          type: "section",
          page: "/",
          target: "sections",
          instruction: `Replace section at: 3 : ${JSON.stringify(imageTextSection2)}`,
          reason: "Convert to image-text inverted layout",
        },
        {
          type: "section",
          page: "/about",
          target: "append",
          instruction: `Add section: ${JSON.stringify(aboutSection)}`,
          reason: "Add leadership section",
        },
        {
          type: "section",
          page: "/services",
          target: "sections",
          instruction: `Replace section at: 2 : ${JSON.stringify(servicesImageSection)}`,
          reason: "Add imagery to services",
        },
      ],
      affectedPages: ["/", "/about", "/services"],
      requiresImageRegeneration: true,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);

    // Home: sections[2] and [3] converted to image-text
    expect(result.pages[0].sections[2].type).toBe("image-text");
    expect(result.pages[0].sections[2].inverted).toBe(false);
    expect(result.pages[0].sections[3].type).toBe("image-text");
    expect(result.pages[0].sections[3].inverted).toBe(true);
    expect(result.pages[0].sections.length).toBe(5);

    // About: new section appended
    expect(result.pages[1].sections.length).toBe(3);
    expect(result.pages[1].sections[2].heading).toBe("Leadership & Certifications");
    expect(result.pages[1].sections[2].type).toBe("text-block");

    // Services: capabilities replaced with image-text
    expect(result.pages[2].sections[2].type).toBe("image-text");
    expect(result.pages[2].sections[2].heading).toBe("Our Capabilities");

    // Contact: unchanged
    expect(result.pages[3].sections.length).toBe(1);
    expect(result.pages[3].sections[0].type).toBe("hero");
  });

  it("unchanged pages remain identical", () => {
    const spec = makeSpec();
    const plan: RevisionPlan = {
      summary: "Only touch home page",
      changes: [
        {
          type: "content",
          page: "/",
          target: "sections[0].heading",
          instruction: "Replace with: 'Welcome to Test Co'",
          reason: "Update hero",
        },
      ],
      affectedPages: ["/"],
      requiresImageRegeneration: false,
      requiresFullQa: true,
      specDiff: [],
    };

    const result = applyRevisionToSpec(spec, plan);
    expect(result.pages[1]).toEqual(spec.pages[1]);
    expect(result.pages[2]).toEqual(spec.pages[2]);
    expect(result.pages[3]).toEqual(spec.pages[3]);
    expect(result.pages[0].sections[0].heading).toBe("Welcome to Test Co");
  });
});
