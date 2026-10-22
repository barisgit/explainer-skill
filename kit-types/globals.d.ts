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

interface ReplyNote {
	where: string;
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

interface ReplyNotesOptions {
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
declare var ViewsFolds: () => () => void;
