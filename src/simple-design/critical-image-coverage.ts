// CRITICAL image coverage — the Website Builder's own image contract
// (operator GO, 2026-09-10).
//
// The materialized Blueprint image plan is authoritative: every image slot
// whose priority is CRITICAL (the four deterministic page heroes plus any
// CRITICAL supporting slot) MUST ship — referenced at least once, on its
// declared page, by its exact Accepted Image slot id. HIGH slots are design
// preferences, NORMAL slots are optional; neither is a deterministic blocker
// merely because it went unused.
//
// ONE shared implementation: the Builder validates its bundle against this
// invariant BEFORE the site-bundle artifact is persisted, and the deterministic
// Assembly Preflight re-checks the assembled candidate as the final defense.
// Both call the same pure helper, so they can never disagree about what
// "covered" means. Deterministic code owns WHICH assets are mandatory, their
// page ownership, and the verification that they were used; the model still
// owns where inside the section the image sits, the image/text split, overlay,
// crop, mass and responsive treatment.

export type ImageSlotPriority = "CRITICAL" | "HIGH" | "NORMAL";

/** Minimal structural view of a materialized image slot — satisfied by the
 *  Builder's Accepted Image descriptors and by the domain ImageSlot plan. */
export interface CriticalCoverageSlot {
  slotId: string;
  page: string;
  section?: string;
  priority: string;
}

export type CriticalCoverageFindingId = "MISSING_CRITICAL_IMAGE" | "WRONG_PAGE_CRITICAL_IMAGE";

export interface CriticalCoverageFinding {
  id: CriticalCoverageFindingId;
  slotId: string;
  page: string;
  detail: string;
}

/** The mandatory set: every materialized slot with priority CRITICAL. */
export function requiredCriticalImageSlots<T extends CriticalCoverageSlot>(slots: readonly T[]): T[] {
  return slots.filter((slot) => slot.priority === "CRITICAL");
}

/**
 * How a page references an image at the two positions the invariant is
 * checked. The forms map 1:1 onto the deterministic assembly, which resolves
 * exactly `src="IMG:{slotId}"` into `src="assets/images/{slotId}.webp"` —
 * so the Builder's pre-persistence check can only pass where the assembled
 * candidate will also pass:
 *   placeholder — the raw site-bundle the Builder produced
 *   bundled     — the assembled candidate the Preflight inspects
 * A bare data-image-id or a placeholder in an unresolved position (srcset,
 * inline style) is deliberately NOT coverage: it does not ship the image.
 */
export type ImageReferenceForm = "placeholder" | "bundled";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pageReferencesImageSlot(html: string, slotId: string, form: ImageReferenceForm): boolean {
  const id = escapeForRegExp(slotId);
  const pattern = form === "placeholder" ? new RegExp(`src="IMG:${id}"`) : new RegExp(`src="assets/images/${id}\\.webp"`);
  return pattern.test(html);
}

/**
 * Validates CRITICAL image coverage of a set of pages against the
 * materialized image plan. Returns one finding per uncovered CRITICAL slot:
 *   MISSING_CRITICAL_IMAGE    — the slot is referenced nowhere
 *   WRONG_PAGE_CRITICAL_IMAGE — the slot is referenced, but not on its
 *                               declared page
 * An empty result means every CRITICAL slot ships on its declared page.
 */
export function validateCriticalImageCoverage(
  pages: Record<string, string | undefined>,
  imagePlanSlots: readonly CriticalCoverageSlot[],
  form: ImageReferenceForm
): CriticalCoverageFinding[] {
  const findings: CriticalCoverageFinding[] = [];
  for (const slot of requiredCriticalImageSlots(imagePlanSlots)) {
    const declaredPage = pages[slot.page];
    if (typeof declaredPage === "string" && pageReferencesImageSlot(declaredPage, slot.slotId, form)) continue;
    const usedElsewhere = Object.entries(pages).some(
      ([page, html]) => page !== slot.page && typeof html === "string" && pageReferencesImageSlot(html, slot.slotId, form)
    );
    const role = slot.section ? ` (${slot.section})` : "";
    findings.push(
      usedElsewhere
        ? {
            id: "WRONG_PAGE_CRITICAL_IMAGE",
            slotId: slot.slotId,
            page: slot.page,
            detail: `CRITICAL slot '${slot.slotId}' is used, but not on its declared page '${slot.page}'${role}`,
          }
        : {
            id: "MISSING_CRITICAL_IMAGE",
            slotId: slot.slotId,
            page: slot.page,
            detail: `CRITICAL slot '${slot.slotId}' has no shipped Accepted Image on page '${slot.page}'${role}`,
          }
    );
  }
  return findings;
}

/** Slot ids referenced anywhere in the pages — evidence reporting only. */
export function referencedImageSlotIds(
  pages: Record<string, string | undefined>,
  imagePlanSlots: readonly CriticalCoverageSlot[],
  form: ImageReferenceForm
): string[] {
  const used: string[] = [];
  for (const slot of imagePlanSlots) {
    if (Object.values(pages).some((html) => typeof html === "string" && pageReferencesImageSlot(html, slot.slotId, form))) {
      used.push(slot.slotId);
    }
  }
  return used;
}
