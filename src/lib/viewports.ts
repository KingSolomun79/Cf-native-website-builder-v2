export type ViewportName = "desktop" | "tablet" | "mobile";

export interface ReferenceViewport {
  name: ViewportName;
  width: number;
  height: number;
}

export const REFERENCE_VIEWPORTS: readonly ReferenceViewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;

export const CAPTURE_NAV_TIMEOUT_MS = 45_000;
export const CAPTURE_MAX_RETRIES = 1;
