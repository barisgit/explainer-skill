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

/** A Clear button's texts, read at each use so kitLabels may be set later: its idle text, and the prompt announced once armed. */
interface KeepClearTexts {
	label(): string;
	prompt(): string;
}

/** A Clear button that asks first, and the live region that announces it; its owner places both. */
interface KeepClearButton {
	button: HTMLButtonElement;
	status: HTMLElement;
	/** Shows or hides the button; hiding cancels a pending confirm. */
	show(visible: boolean): void;
}

/** keep.js's keeper, which reply.js drives: the controls it keeps, and its save, clear and touch calls. */
interface KeepApi {
	/** CSS selector of the controls that can be kept. */
	selector: string;
	/** A label's text without the controls inside it. */
	ownText(label: HTMLLabelElement): string;
	/** After any change: adopts new controls, saves, returns whether anything for the reply is kept (a self-check's answer is not). */
	update(): boolean;
	/** Every control back to its default (with input and change events), saved state dropped; notes are the owner's to empty. */
	clear(): void;
	/** The Clear button keep.js shows alone, for an owner's own place and texts: a press arms it, a second calls `onClear`. */
	clearButton(texts: KeepClearTexts, onClear: () => void): KeepClearButton;
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
declare var Views: {
	on(name: string, fn: ViewHandler): void;
	/** The part of the hash that belongs to `el`: after its view's route and ?, the whole hash on the overview; null while hidden. */
	local(el: Element): string | null;
	/** Writes `text` as `el`'s part of the hash, in place, keeping the view's trail; nothing while its view is hidden. */
	setLocal(el: Element, text: string): void;
};
declare var Keep: KeepApi;
declare var ReplyNotes: (options: ReplyNotesOptions) => void;
declare var ViewsNav: (options: {
	views: HTMLElement[];
	canonical: (hash: string) => string;
	/** A hash's route to compare: the part before its first ?, decoded. */
	key: (hash: string) => string;
	kitText: KitText<"overview" | "contents" | "breadcrumb">;
}) => {
	revisited(): boolean;
	savedHash(): string | null;
	replace(hash: string): void;
	show(view: HTMLElement | null, hash: string): void;
};
declare var ViewsFolds: (kitText: KitText<"expandAll" | "collapseAll">) => () => void;

// An image or font a page's module imports is its data: URL, which pack embeds: import icon from "./icon.svg" (src/data-uri.ts).
declare module "*.png" {
	const url: string;
	export default url;
}
declare module "*.jpg" {
	const url: string;
	export default url;
}
declare module "*.jpeg" {
	const url: string;
	export default url;
}
declare module "*.gif" {
	const url: string;
	export default url;
}
declare module "*.webp" {
	const url: string;
	export default url;
}
declare module "*.svg" {
	const url: string;
	export default url;
}
declare module "*.avif" {
	const url: string;
	export default url;
}
declare module "*.woff2" {
	const url: string;
	export default url;
}
declare module "*.woff" {
	const url: string;
	export default url;
}
declare module "*.ttf" {
	const url: string;
	export default url;
}
declare module "*.otf" {
	const url: string;
	export default url;
}
