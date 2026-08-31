export function checkSocials(
  html: string,
  socials: {
    facebook: string | null;
    instagram: string | null;
    twitter: string | null;
    linkedin: string | null;
    other: string | null;
  }
): "pass" | "fail" {
  const expectedSocials = [
    socials.facebook,
    socials.instagram,
    socials.twitter,
    socials.linkedin,
    socials.other,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  if (expectedSocials.length === 0) {
    return "pass";
  }

  for (const socialUrl of expectedSocials) {
    if (!html.includes(socialUrl)) {
      return "fail";
    }
  }

  return "pass";
}
