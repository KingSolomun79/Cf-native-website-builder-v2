declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.json" {
  const value: any;
  export default value;
}

// Vite inlines `?raw` imports at transform time (frozen test fixtures that
// the workerd test pool cannot read from disk).
declare module "*?raw" {
  const content: string;
  export default content;
}
