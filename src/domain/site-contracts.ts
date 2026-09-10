// SIMPLE-neutral shared site contracts (cleanup 2026-09-10).
//
// Page identity and the Accepted-Image slot contract shared by the SIMPLE
// design pipeline, the image pipeline and QA evidence. These types previously
// lived in the legacy site generator; they are domain semantics, not legacy
// machinery, and outlive it.
import { Type, type Static } from "@sinclair/typebox";

export type PageId = "home" | "about" | "services" | "contact";
export const PAGE_IDS: readonly PageId[] = ["home", "about", "services", "contact"];

export const ImageSlotSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    page: Type.Union([Type.Literal("home"), Type.Literal("about"), Type.Literal("services"), Type.Literal("contact")]),
    regionId: Type.Optional(Type.String({ minLength: 1 })),
    semanticRole: Type.String({ minLength: 1, maxLength: 2000 }),
    blueprintRole: Type.String({ minLength: 1, maxLength: 120 }),
    priority: Type.Union([Type.Literal("CRITICAL"), Type.Literal("HIGH"), Type.Literal("NORMAL")]),
    orientation: Type.Union([Type.Literal("landscape"), Type.Literal("portrait"), Type.Literal("square")]),
    negativeSpaceForText: Type.Boolean(),
    // Blueprint provenance ratios (SIMPLE blueprint bridge): the design
    // observation and the frozen provider-generation ratio travel with the
    // slot so the provider adapter can map them deterministically. Optional —
    // non-blueprint image plans never set them.
    compositionAspectRatio: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
    generationAspectRatio: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
  },
  { additionalProperties: false }
);
export type ImageSlot = Static<typeof ImageSlotSchema>;
