/** Types for vendor/beautiful-mermaid.js (built by build/vendor.ts): the subset of beautiful-mermaid's RenderOptions that pack sets. */
export interface RenderOptions {
	/** Font family written into the SVG's style; text is sized with the patch's Geist widths whatever this says. */
	font?: string;
	/** Canvas padding in px. Default 40. */
	padding?: number;
	/** Horizontal spacing between sibling nodes. Default 24. */
	nodeSpacing?: number;
	/** Vertical spacing between layers. Default 40. */
	layerSpacing?: number;
	/** No background on the root svg. Default false. */
	transparent?: boolean;
}

/** Thrown by every parser for input it does not consume: `unread` is the part left over, `line` the statement it is in. */
export class UnreadInputError extends Error {
	readonly unread: string;
	readonly line: string;
}

/** One parsed edge of a flowchart or state diagram. */
export interface MermaidEdge {
	source: string;
	target: string;
	label?: string;
}

/**
 * Parses flowchart and state diagram source (no layout); edges are in source order. The renderer's SVG tags each edge with
 * data-from and data-to, the source and target here. A header that is not a flowchart or state diagram throws.
 */
export function parseMermaid(text: string): { edges: MermaidEdge[] };

/**
 * Renders Mermaid source (flowchart/graph, stateDiagram, sequenceDiagram, classDiagram, erDiagram, xychart-beta) to SVG markup,
 * synchronously. Any other header is read as a flowchart; a parse error throws, an UnreadInputError for input no parser rule reads.
 */
export function renderMermaidSVG(text: string, options?: RenderOptions): string;
