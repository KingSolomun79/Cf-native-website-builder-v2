// Aspect-ratio mapping for the SIMPLE image pipeline (model/provider-aware).
//
// Extracted from the KIE adapter so the BLUEPRINT slot bridge can derive slot
// orientation from the SAME provider-ratio resolution the adapter uses — the
// orientation-conformance gate (issue #47) must judge the image against the
// ratio the provider was actually ASKED for, not the legacy generation ratio
// (live finding, four-page-hero regression 2026-09-09: a slot with
// composition 4:3 / generation 1:1 requested 4:3 from the provider, received a
// correct 4:3 image, and was rejected by a square-class conformance check —
// burning both attempts).
//
// Nano Banana 2 Lite supported ratios per the CURRENT KIE API reference
// (https://docs.kie.ai/cn/market/google/nano-banana-2-lite).

export const NANO_BANANA_SUPPORTED_ASPECT_RATIOS: ReadonlySet<string> = new Set([
  "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9", "auto",
]);

export interface ProviderAspectRatioResolution {
  providerAspectRatio: string;
  mappingReason: string;
}

// Deterministic composition→provider ratio bridge (operator GO §5). The
// Blueprint is never mutated: where its compositionAspectRatio is natively
// supported it is used DIRECTLY (no 21:9 → 16:9 downgrade); an unsupported
// composition ratio (e.g. 5:3) falls to the frozen generationAspectRatio; a
// numeric-nearest supported ratio is the deterministic last resort; no
// composition context at all keeps the legacy orientation bridge value.
export function resolveProviderAspectRatio(
  compositionAspectRatio: string | undefined,
  generationAspectRatio: string | undefined,
  legacyRatio: string,
): ProviderAspectRatioResolution {
  const supported = NANO_BANANA_SUPPORTED_ASPECT_RATIOS;
  if (compositionAspectRatio && supported.has(compositionAspectRatio)) {
    return { providerAspectRatio: compositionAspectRatio, mappingReason: `composition ratio ${compositionAspectRatio} natively supported by nano-banana-2-lite` };
  }
  if (compositionAspectRatio && generationAspectRatio && supported.has(generationAspectRatio)) {
    return { providerAspectRatio: generationAspectRatio, mappingReason: `composition ratio ${compositionAspectRatio} unsupported; frozen generation ratio ${generationAspectRatio} used` };
  }
  if (compositionAspectRatio) {
    const target = parseAspectRatioValue(compositionAspectRatio);
    if (target !== null) {
      let best: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of supported) {
        const value = parseAspectRatioValue(candidate);
        if (value === null) continue;
        const distance = Math.abs(value - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      if (best) {
        return { providerAspectRatio: best, mappingReason: `composition ratio ${compositionAspectRatio} and generation ratio ${generationAspectRatio ?? "none"} unsupported; nearest supported ratio used` };
      }
    }
  }
  return { providerAspectRatio: legacyRatio, mappingReason: "no composition ratio available; legacy orientation bridge used" };
}

export function parseAspectRatioValue(ratio: string): number | null {
  const match = /^([0-9]{1,4}(?:\.[0-9]{1,2})?):([0-9]{1,4}(?:\.[0-9]{1,2})?)$/.exec(ratio);
  if (!match) return null;
  const width = Number.parseFloat(match[1]);
  const height = Number.parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height === 0) return null;
  return width / height;
}

// Orientation class of a ratio — the shape the conformance gate must expect
// when the provider was asked for this ratio.
export function aspectRatioClass(ratio: string): "portrait" | "square" | "landscape" {
  const value = parseAspectRatioValue(ratio);
  if (value === null) return "landscape";
  if (Math.abs(value - 1) < 0.01) return "square";
  return value > 1 ? "landscape" : "portrait";
}
