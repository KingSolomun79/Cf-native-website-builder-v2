// ORIGINAL_DESIGN is a RECOGNIZED V2 Build Mode whose runtime is explicitly
// NOT ENABLED (operator decision, 2026-09-10): the legacy generator chain was
// removed and its SIMPLE implementation is deferred. This deterministic lock
// replaces the retired 3-of-5 legacy benchmark proof gate. There is
// intentionally:
//   - no fallback from ORIGINAL_DESIGN to REFERENCE_BOUND,
//   - no legacy generator behind this lock,
//   - no automatic enablement.
// Re-enablement arrives only with the future SIMPLE ORIGINAL_DESIGN
// implementation (same downstream pipeline; only the Blueprint inputs differ).
export const ORIGINAL_DESIGN_NOT_ENABLED = "ORIGINAL_DESIGN_NOT_ENABLED" as const;

export class OriginalDesignNotEnabledError extends Error {
  readonly code = ORIGINAL_DESIGN_NOT_ENABLED;

  constructor() {
    super(
      "ORIGINAL_DESIGN is a recognized V2 Build Mode but is NOT ENABLED: its SIMPLE implementation is deferred. REFERENCE_BOUND is the only enabled design path."
    );
    this.name = "OriginalDesignNotEnabledError";
  }
}

/** Deterministic deferred-mode lock: always throws until ORIGINAL_DESIGN is
 * deliberately re-enabled by a future SIMPLE implementation. */
export function assertOriginalDesignAvailable(): never {
  throw new OriginalDesignNotEnabledError();
}
