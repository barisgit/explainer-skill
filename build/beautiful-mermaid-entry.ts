/**
 * Entry for vendor/beautiful-mermaid.js (`bun run vendor`): the SVG renderer and the flowchart parser (pack matches edge ids by it),
 * so the ASCII renderer and themes stay out of the bundle.
 * Its types for src/ live in vendor/beautiful-mermaid.d.ts; keep the two in step when the export list changes.
 */
export { parseMermaid, renderMermaidSVG } from "beautiful-mermaid";
