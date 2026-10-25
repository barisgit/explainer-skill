/**
 * The window globals the kit scripts define for pages, and the ECharts global that kit:echarts.js defines. The scripts are plain
 * browser scripts, so this is the one place their public API is typed; vendor copies it for authors' typechecking.
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
	/** Removes the chart and stops watching its element. */
	dispose(): void;
}

type ViewHandler = (view: HTMLElement, param: string) => void;

/**
 * A number format as JSON, written for the page's lang: digits fixes the decimals, percent writes 0.25 as 25%, currency ("EUR")
 * and compact (12K) as Intl writes them, and unit follows the number ("min" gives 18 min, "%" gives 90%).
 */
interface NumberFormat {
	digits?: number;
	unit?: string;
	percent?: boolean;
	currency?: string;
	compact?: boolean;
}

interface AxisSpec {
	min?: number;
	max?: number;
	step?: number;
	name?: string;
	format?: ((value: number) => string) | NumberFormat;
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
	/** true prints the value; a format, one text per point or bar, or a function: stem (x, y, i), bar (v, i). */
	label?: boolean | NumberFormat | readonly string[] | ((...args: number[]) => string);
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

/** What keep.js saves beside the answers: reply.js's notes once it attaches, else the notes as they were stored. */
interface KeepNotes {
	list(): unknown[];
	restore(saved: unknown): void;
}

/** keep.js's keeper, which reply.js drives: the controls it keeps, and its save, clear and touch calls. */
interface KeepApi {
	/** CSS selector of the controls that can be kept. */
	selector: string;
	/** A label's text without the controls inside it. */
	ownText(label: HTMLLabelElement): string;
	/** After any change: adopts new controls, saves, returns whether anything is kept. */
	update(): boolean;
	/** Every control back to its default (with input and change events), saved state dropped; notes are the owner's to empty. */
	clear(): void;
	/** The reader acted on a control, even if the value equals the default. */
	touch(el: ReplyControl): void;
	touched(el: ReplyControl): boolean;
	/**
	 * Hands the notes and the change callback to an owner (reply.js): from then on `onChange` runs instead of keep.js's own save
	 * when a page script moved a control, the DOM changed, the page is being left or the restore finished, and must call update().
	 */
	attach(owner: { notes: KeepNotes; onChange: () => void }): void;
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
 * The page's texts for the kit's own controls, accessible names and messages, by key: pack sets it from the frontmatter `labels`,
 * whose keys `kit labels` lists. The kit scripts read it when they draw, never caching it, so it may be set after them.
 */
declare var kitLabels: Readonly<Record<string, string>> | undefined;

declare var echarts: typeof import("echarts");
declare var Charts: {
	make(el: HTMLElement, option: ChartOption, setup?: (chart: ECharts) => void): ChartHandle;
	color(token: string): string;
};
declare var Plot: {
	make(el: HTMLElement, option: PlotOption): { set(patch: PlotOption): void; dispose(): void };
};
declare var Steps: { refresh(el: Element, step?: number): void };
declare var Views: { on(name: string, fn: ViewHandler): void };
declare var Keep: KeepApi;
declare var ReplyNotes: (options: ReplyNotesOptions) => void;
declare var ViewsNav: (options: {
	views: HTMLElement[];
	decode: (text: string) => string;
	canonical: (hash: string) => string;
	kitText: KitText<"overview" | "contents" | "breadcrumb">;
}) => {
	revisited(): boolean;
	savedHash(): string | null;
	show(view: HTMLElement | null, hash: string): void;
};
declare var ViewsFolds: (kitText: KitText<"expandAll" | "collapseAll">) => () => void;
