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

/**
 * A bar's state, from the page's one accent: "accent" solid, "hollow" its tint inside an accent outline, "hatch" grey lines at
 * 45 degrees, 6 px apart, inside a grey outline.
 */
type PlotFill = "accent" | "hollow" | "hatch";

interface PlotSeries {
	name?: string;
	type?: "line" | "stem" | "bar";
	data: readonly (number | PlotPoint)[];
	color?: string;
	width?: number;
	/** true dashes the line, false keeps it solid; unset, a line in the palette takes its slot's dash. */
	dash?: boolean;
	/** Bars: one state for the series, or one per bar (null or "" for the series' colour). */
	fill?: PlotFill | readonly (PlotFill | "" | null)[];
	/** true prints the value; a format, one text per point or bar, or a function: stem (x, y, i), bar (v, i). */
	label?: boolean | NumberFormat | readonly string[] | ((...args: number[]) => string);
}

/** A category's name, or its name with a muted second line under it. */
type PlotCategory = string | { name: string; note?: string };

/** A reference marker: a dashed line at x (down the plot) or y (across it), with its label on top. */
interface PlotMark {
	x?: number;
	y?: number;
	label?: string;
}

interface PlotOption {
	series?: PlotSeries[];
	categories?: PlotCategory[];
	marks?: PlotMark[];
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

/** keep.js's keeper, which reply.js drives: the controls it keeps, its save, clear and touch calls, and its Clear button. */
interface KeepApi {
	/** CSS selector of the controls that can be kept. */
	selector: string;
	/** A label's text without the controls inside it. */
	ownText(label: HTMLLabelElement): string;
	/**
	 * After any change: adopts new controls, saves, returns whether anything is kept. Unless `inBar` (the caller shows Clear in
	 * its reply bar), keep.js shows its own Clear while a Question's answer is kept.
	 */
	update(inBar: boolean): boolean;
	/**
	 * Every control back to its default (with input and change events), saved state dropped; notes are the owner's to empty. With
	 * `answersOnly`, just the controls of Question answers.
	 */
	clear(answersOnly?: boolean): void;
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
		| "note"
		| "addNote"
		| "noteOn"
		| "notePlaceholder"
		| "part"
		| "cancel"
		| "saveNote"
		| "noteSaved"
		| "toReply"
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
	/** Scrolls to the Reply button and focuses it. */
	toReply: () => void;
	paused: () => boolean;
}

/**
 * The page's texts for the kit's own controls, accessible names and messages, by key: pack sets it from the frontmatter `labels`,
 * whose keys `kit labels` lists. The kit scripts read it when they draw, never caching it, so it may be set after them.
 */
declare var kitLabels: Readonly<Record<string, string>> | undefined;

declare var echarts: typeof import("echarts");
/** Set by the loader of a compressed ECharts (kit/unpack.ts): resolves once `echarts` exists. Undefined when the page carries ECharts plain. */
declare var echartsReady: Promise<void> | undefined;
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
declare var ReplyNotes: {
	(options: ReplyNotesOptions): void;
	/** Current reply Markdown, available once reply.js has initialized; no clipboard or host delivery. */
	markdown?: () => string;
};
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
declare var ChartsOption: (env: {
	/** The colour ECharts gets for a CSS colour expression: var(--token), color-mix(...) or light-dark(...). */
	color: (expression: string) => string;
	/** The language numbers are written in. */
	lang: () => string;
	/** px: the size every text of a chart is set at, the theme's --size-label. */
	size: () => number;
	/** px: the size a chart's title is set at, the theme's --size-text. */
	text: () => number;
}) => {
	resolveOption<T>(option: T): T;
	theme(place: { under: string; font: string; animation: boolean }): ChartOption;
	/** Install the shared legend-box layout before the first setOption, on a live or SSR ECharts instance. */
	layout(chart: unknown): void;
	/** Normalize zrender's line-height probe while delegating actual glyph widths to the renderer. */
	measureText(
		base: (text: string, font?: string) => { width: number },
	): (text: string, font?: string) => { width: number };
	/** The option with animation off where ECharts reads it (its baseOption, else the root): a first draw never animates. */
	still(option: ChartOption): ChartOption;
	/** Where ECharts reads an option's root settings and components: its baseOption when it has one, else the option. */
	settings(option: ChartOption): ChartOption;
	/**
	 * For an option whose named lines carry their names at their ends: the option so, and the option with a legend for a size
	 * where the names crowd; else undefined. width measures a label at the label size.
	 */
	endNames(
		option: ChartOption,
		width: (text: string) => number,
	): { named: ChartOption; legend: ChartOption } | undefined;
	/** Whether two of a drawn chart's end labels sit less than a line apart, on a live or SSR ECharts instance. */
	crowded(chart: unknown): boolean;
	/**
	 * The option with the kit's defaults by series place: line dashes per palette slot, a line between stacked bars, marker
	 * labels on top, left of the markers `sides` names by series index (as markSides read them from the chart drawn).
	 */
	defaults(option: ChartOption, sides?: ReadonlyMap<number, ReadonlySet<number>>): ChartOption;
	/** What defaults generates for the option, as text to compare: a change redraws the chart rather than patching it. */
	styling(option: ChartOption): string;
	/** Which vertical markers of a drawn chart stand past the middle of their axis, by series index; see defaults. */
	markSides(chart: unknown): ReadonlyMap<number, ReadonlySet<number>>;
};
/** See ChartsOption's defaults (kit/parts/charts/defaults.ts). */
declare var ChartsDefaults: {
	defaults(option: ChartOption, sides?: ReadonlyMap<number, ReadonlySet<number>>): ChartOption;
	styling(option: ChartOption): string;
	place(chart: unknown): ReadonlyMap<number, ReadonlySet<number>>;
};
declare var PlotDraw: (env: {
	/** The language numbers are written in. */
	lang: () => string;
	/** px: the size text is set at, the theme's --size-label. */
	size: () => number;
}) => {
	/** The SVG content for the option at W x H pixels, with series i drawn when shown[i]; textWidth measures a label in px. */
	render(
		option: PlotOption,
		W: number,
		H: number,
		textWidth: (s: unknown) => number,
		shown: boolean[],
	): string;
	/**
	 * The legend's buttons, or "" when it shows none (names at the line ends of an H px high area with no legend take its place);
	 * button i switches series i; textWidth measures a label in px.
	 */
	legendMarkup(option: PlotOption, textWidth: (s: unknown) => number, H: number): string;
	/** Per series: whether it is switched on, given the names switched off. */
	switchedOn(series: PlotSeries[], off: Set<string | undefined>): boolean[];
	/** How many lines the markers' labels take on top of the plot at W x H, which push it down (render lays them out the same). */
	markLines(option: PlotOption, W: number, H: number, textWidth: (s: unknown) => number): number;
};

/** A mark's value text from its value, its index in the series and, for a stem, its x. */
type PlotLabeller = (value: number, i: number, x: number) => string;
declare var PlotFormat: (env: { lang: () => string }) => {
	/** An axis's number text by its format: a function, a JSON NumberFormat, or unset (in full). */
	formatter(format: AxisSpec["format"]): (v: number) => string;
	/** A series' values' texts by its label, `format` writing them for label: true; undefined for no labels. */
	labeller(
		label: PlotSeries["label"],
		format: (v: number) => string,
		stem: boolean,
	): PlotLabeller | undefined;
};
/** How plot.js's parts write an SVG line and text (kit/parts/plot/draw.ts). */
interface PlotSvg {
	svgLine: (cls: string, x1: number, x2: number, y1: number, y2: number, style?: string) => string;
	svgText: (
		cls: string,
		x: number,
		y: number,
		anchor: "start" | "middle" | "end",
		s: unknown,
		style?: string,
	) => string;
}
/** A line's name at its end: the line's last point, colour and dash ("" for none), which a leader to a moved name takes. */
interface PlotEndName {
	name: string;
	at: { x: number; y: number };
	colour: string;
	dash: string;
}
declare var PlotEnds: (env: PlotSvg & { size: () => number }) => {
	/** Whether the names go at the line ends, above a plot whose bottom edge is `bottom` px down. */
	fit(option: PlotOption, textWidth: (s: unknown) => number, bottom: number): boolean;
	/** px a name takes right of the plot. */
	room(name: string, textWidth: (s: unknown) => number): number;
	/** The names drawn, spread apart above B. */
	marks(named: readonly PlotEndName[], B: number): string;
};
declare var PlotMarks: (env: PlotSvg) => {
	/** A bar at [x, y, w, h] in a state; open when a value on it reads as one outside it. */
	bar(
		state: PlotFill | undefined,
		colour: string,
		box: readonly [number, number, number, number],
		title: string,
	): { markup: string; open: boolean };
	/** The markers' lines and labels; top is where labels on top start. */
	markers(
		marks: readonly PlotMark[],
		frame: PlotMarkFrame,
		top: number,
	): { lines: string; labels: string };
	/** How many lines the tallest label on top takes. */
	rows(marks: readonly PlotMark[], frame: PlotMarkFrame): number;
	/** A series' legend swatch: its type, colour, dash (an SVG dash array, "" solid) and its bars' state. */
	swatch(type: string, colour: string, dash: string, state: PlotFill | undefined): string;
};
/** What PlotMarks needs of a plot: its axes' mapping (a numeric axis's), its box, the drawing's width and a label's line height. */
interface PlotMarkFrame {
	X?: ((v: number) => number) | undefined;
	Y?: ((v: number) => number) | undefined;
	L: number;
	R: number;
	T: number;
	B: number;
	W: number;
	line: number;
	textWidth: (s: unknown) => number;
}

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
