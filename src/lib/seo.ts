export function generateSitemapXml(pages: Array<{ slug: string; lastmod: string }>, baseUrl: string): string {
  const urls = pages
    .map(
      (p) => `  <url>
    <loc>${baseUrl}${p.slug === "/" ? "" : p.slug}</loc>
    <lastmod>${p.lastmod}</lastmod>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function generateRobotsTxt(baseUrl: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;
}

export function generateLocalBusinessJsonLd(params: {
  name: string;
  url: string;
  addressLocality?: string | null;
  addressCountry?: string | null;
  telephone?: string | null;
}): object {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: params.name,
    url: params.url,
  };

  if (params.addressLocality || params.addressCountry) {
    ld.address = {
      "@type": "PostalAddress",
      ...(params.addressLocality ? { addressLocality: params.addressLocality } : {}),
      ...(params.addressCountry ? { addressCountry: params.addressCountry } : {}),
    };
  }

  if (params.telephone) {
    ld.telephone = params.telephone;
  }

  return ld;
}

export function generateOrganizationJsonLd(params: {
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
}): object {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: params.name,
    url: params.url,
  };

  if (params.logo) {
    ld.logo = params.logo;
  }

  if (params.sameAs?.length) {
    ld.sameAs = params.sameAs;
  }

  return ld;
}

export function generateWebSiteJsonLd(params: {
  name: string;
  url: string;
  sameAs?: string[];
}): object {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: params.name,
    url: params.url,
  };

  if (params.sameAs?.length) {
    ld.sameAs = params.sameAs;
  }

  return ld;
}

export function buildPageJsonLd(params: {
  page: string;
  spec: {
    site: {
      companyName: string;
      logoUrl: string;
      socials: {
        facebook: string | null;
        instagram: string | null;
        twitter: string | null;
        linkedin: string | null;
        other: string | null;
      };
    };
    seo: {
      localBusiness: {
        name: string;
        addressLocality: string | null;
        addressCountry: string | null;
        telephone: string | null;
        url: string;
      };
      sameAs: string[];
    };
  };
  siteUrl: string;
}): object {
  const { page, spec, siteUrl } = params;
  const socials = spec.site.socials;
  const sameAs = [
    socials.facebook,
    socials.instagram,
    socials.twitter,
    socials.linkedin,
    socials.other,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  const orgLd = generateOrganizationJsonLd({
    name: spec.site.companyName,
    url: siteUrl,
    logo: spec.site.logoUrl || undefined,
    sameAs,
  });

  if (page === "/" || page === "/contact") {
    const lbLd = generateLocalBusinessJsonLd(spec.seo.localBusiness);
    return [orgLd, lbLd];
  }

  if (page === "/") {
    const wsLd = generateWebSiteJsonLd({
      name: spec.site.companyName,
      url: siteUrl,
      sameAs,
    });
    return [orgLd, wsLd];
  }

  return orgLd;
}
