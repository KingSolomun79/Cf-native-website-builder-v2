// Canonical structured Business Facts for test submissions (operator GO
// 2026-09-12: services + businessHours are REQUIRED canonical facts;
// competitiveDifferentiator is optional). Tests spread these into their local
// submission factories so every fixture stays a valid canonical payload.

import type { BusinessHours, ServiceItem } from "../../src/domain/lifecycle-schema";

export function canonicalServices(): ServiceItem[] {
  return [
    { name: "House Blend Roasting", description: "Weekly small-batch roasting of our signature house blend." },
    { name: "Cafe Wholesale Supply", description: "Fresh beans, grinder calibration and barista training for cafes." },
    { name: "Brew Workshops", description: "Hands-on weekend brewing and cupping workshops." },
  ];
}

export function canonicalBusinessHours(): BusinessHours {
  return {
    monday: { status: "OPEN", open: "08:00", close: "17:00" },
    tuesday: { status: "OPEN", open: "08:00", close: "17:00" },
    wednesday: { status: "OPEN", open: "08:00", close: "17:00" },
    thursday: { status: "OPEN", open: "08:00", close: "17:00" },
    friday: { status: "OPEN", open: "08:00", close: "17:00" },
    saturday: { status: "OPEN", open: "09:00", close: "13:00" },
    sunday: { status: "CLOSED" },
  };
}

export function canonicalStructuredFacts(): {
  services: ServiceItem[];
  businessHours: BusinessHours;
  competitiveDifferentiator: string;
} {
  return {
    services: canonicalServices(),
    businessHours: canonicalBusinessHours(),
    competitiveDifferentiator: "Roasted within a day of delivery, never warehoused.",
  };
}
