/** Types for vendor/pele.js (build/pele-entry.ts): the part of pele's API src/mermaid.ts uses. Hand-maintained. */

/** Width of `text` at `size` px; `style` is a bit set: 1 bold, 2 italic, 4 monospace. */
export interface TextMeasurer {
	width(text: string, size: number, style: number): number;
}

/** What a `$$...$$` in a label is drawn as, at the size given; null leaves the text as written. */
export type MathResolver = (
	tex: string,
	size: number,
) => { svg: string; width: number; height: number } | null | undefined;

export interface RenderOptions {
	measurer?: TextMeasurer;
	fontFamily?: string;
	fontFamilyMono?: string;
	fontSize?: number;
	idPrefix?: string;
	padding?: number;
	links?: boolean;
	images?: boolean;
	math?: MathResolver;
}

export interface RenderResult {
	svg: string;
	width: number;
	height: number;
}

/** A state diagram's statement, as far as pack reads it: transitions and the composite states that nest them. */
export type StateStatement =
	| { stmt: "relation"; state1: { id: string }; state2: { id: string } }
	| { stmt: "state"; id: string; doc?: StateStatement[] }
	| { stmt: string };

/** A flowchart edge, as far as pack reads and renumbers it. */
export interface FlowEdge {
	start: string;
	end: string;
	id?: string;
	isUserDefinedId: boolean;
}

export interface ParsedModel {
	type: string;
	rootDoc?: StateStatement[];
	edges?: FlowEdge[];
}

export declare class PeleError extends Error {
	code: "unsupported-diagram" | "syntax" | "semantic" | "limit";
	line: number;
	column: number;
	snippet: string;
}

export declare function parse(text: string): ParsedModel;
export declare function render(source: string | ParsedModel, options?: RenderOptions): RenderResult;
