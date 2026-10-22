/**
 * Entry for vendor/beautiful-mermaid.js (`bun run vendor`): the SVG renderer and the error it throws for input it does not read,
 * so the parsers' other exports, the ASCII renderer and themes stay out of the bundle.
 * Its types for src/ live in vendor/beautiful-mermaid.d.ts; keep the two in step when the export list changes.
 */
export { renderMermaidSVG, UnreadInputError } from "beautiful-mermaid";
