/**
 * The window globals the kit scripts define for pages, and the ECharts global that kit:echarts.js defines. The scripts are plain
 * browser scripts, so this is the one place their public API is typed; it is not part of the skill.
 */

/** A page part that can carry data-* attributes: HTML or SVG. */
type Part = HTMLElement | SVGElement;

type ECharts = import("echarts").ECharts;

/** Any ECharts option; the kit merges and recolours it without knowing its shape. */
type ChartOption = Record<string, unknown>;

interface ChartHandle {
	/** The live instance, null until the element has a width. */
	readonly chart: ECharts | null;
	set(patch: ChartOption, replace?: string[]): void;
}

type ViewHandler = (view: HTMLElement, param: string) => void;

interface AxisSpec {
	min?: number;
	max?: number;
	step?: number;
	name?: string;
	format?: (value: number) => string;
}

/** A line or stem point, or a bar value. */
type PlotPoint = readonly [number, number];

interface PlotSeries {
	name?: string;
	type?: "line" | "stem" | "bar";
	data: readonly (number | PlotPoint)[];
	color?: string;
	width?: number;
	dash?: boolean;
	/** true prints the value; a function writes the text: stem (x, y), bar (v). */
	label?: boolean | ((...args: number[]) => string);
}

interface PlotOption {
	series?: PlotSeries[];
	categories?: string[];
	horizontal?: boolean;
	stack?: boolean;
	x?: AxisSpec;
	y?: AxisSpec;
	legend?: boolean;
}

/** Where a note sits: in a figure (its aria-label or caption), in a section (its heading), or on the page. */
type NotePlace = { kind: "figure" | "section"; name: string } | { kind: "page" };

interface ReplyNote {
	/** The place as the agent's Markdown names it, always English: figure "name", § heading, or page. */
	where: string;
	/** The place the reader's caption is built from, in the page's language. Notes saved before v0.7.1 have none. */
	place?: NotePlace;
	text: string;
	/** Exactly one of quote (selected text) and part (a data-ref part) is set. */
	quote?: string;
	part?: string;
}

type ReplyControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface ReplyKeepOptions {
	selector: string;
	clean: (text: string) => string;
	ownText: (label: HTMLLabelElement) => string;
	notes: { list(): ReplyNote[]; restore(saved: unknown): void };
	onChange: () => void;
}

interface ReplyKeepApi {
	update(): boolean;
	clear(): void;
	touch(el: ReplyControl): void;
	touched(el: ReplyControl): boolean;
}

/**
 * A kit script's text for one of its kitLabels keys: the page's, else the English default. A part names the keys it uses, so the
 * entry script that passes its accessor in must have a default for each.
 */
type KitText<Key extends string> = (key: Key) => string;

interface ReplyNotesOptions {
	kitText: KitText<
		"note" | "addNote" | "noteOn" | "notePlaceholder" | "part" | "cancel" | "saveNote"
	>;
	h: <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		props?: Record<string, string | EventListener>,
		...kids: (Node | string)[]
	) => HTMLElementTagNameMap[K];
	clean: (text: string) => string;
	quoted: (text: string) => string;
	root: HTMLElement;
	addNote: (note: ReplyNote) => void;
	paused: () => boolean;
}

/**
 * Set by the page in any of its scripts: its texts for the kit's own controls, accessible names and messages, by key; `kit <file>`
 * lists the keys. The kit scripts read it when they draw, never caching it, so it may be set after them.
 */
declare var kitLabels: Readonly<Record<string, string>> | undefined;

declare var echarts: typeof import("echarts");
declare var Charts: {
	make(el: HTMLElement, option: ChartOption, setup?: (chart: ECharts) => void): ChartHandle;
	color(token: string): string;
};
declare var Plot: { make(el: HTMLElement, option: PlotOption): { set(patch: PlotOption): void } };
declare var Steps: { refresh(el: Element, step?: number): void };
declare var Views: { on(name: string, fn: ViewHandler): void };
declare var ReplyKeep: (options: ReplyKeepOptions) => ReplyKeepApi;
declare var ReplyNotes: (options: ReplyNotesOptions) => void;
declare var ViewsNav: (options: {
	views: HTMLElement[];
	decode: (text: string) => string;
	canonical: (hash: string) => string;
	kitText: KitText<"overview" | "contents" | "breadcrumb">;
}) => {
	savedHash(): string | null;
	show(view: HTMLElement | null, hash: string): void;
};
declare var ViewsFolds: (kitText: KitText<"expandAll" | "collapseAll">) => () => void;
