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
	/**
	 * false leaves the axis's tick labels out, and the room they take; true keeps them; texts are a number axis's own labels,
	 * spread evenly from its min to its max, else the data's ends, unrounded (["06:00", "12:00", "18:00"]). Unset, a bar plot whose every bar prints its value
	 * leaves its value axis's out, unless a marker on it does not write its value.
	 */
	labels?: boolean | readonly string[];
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
	/**
	 * Bars: one state for the series, or one per bar (null or "" for the series' colour). A line: the area between it and zero,
	 * true in a tint of its colour, or a state.
	 */
	fill?: PlotFill | true | readonly (PlotFill | "" | null)[];
	/** true prints the value; a format, one text per point or bar, or a function: stem (x, y, i), bar (v, i). */
	label?: boolean | NumberFormat | readonly string[] | ((...args: number[]) => string);
}

/** A category's name, or its name with a muted second line under it. */
type PlotCategory = string | { name: string; note?: string };

/** What a mark of one shape leaves out: the fields of the others. */
interface PlotMarkNone {
	x?: never;
	y?: never;
	at?: never;
	between?: never;
	fill?: never;
}
/**
 * A marker or a note, anchored to data, in one of five shapes: x alone a dashed line down the plot, y alone one across it, each
 * with its label on top; x [from, to] a span, a bracket on top with its label; x [from, to] with between, the region between two
 * series (by name) or a series and a value, filled when fill is set, its label inside it or beside it; at, a label beside that
 * point.
 */
type PlotMark =
	| (Omit<PlotMarkNone, "x"> & { x: number | readonly [number, number]; label?: string })
	| (Omit<PlotMarkNone, "y"> & { y: number; label?: string })
	| (Omit<PlotMarkNone, "x" | "between" | "fill"> & {
			x: readonly [number, number];
			between: readonly [string | number, string | number];
			fill?: PlotFill | true;
			label?: string;
	  })
	| (Omit<PlotMarkNone, "at"> & { at: PlotPoint; label: string });

interface PlotOption {
	series?: PlotSeries[];
	categories?: PlotCategory[];
	marks?: PlotMark[];
	horizontal?: boolean;
	stack?: boolean;
	x?: AxisSpec;
	y?: AxisSpec;
	legend?: boolean;
	/** A bar plot's picked category, by index: framed, and the legend is its key, each series' value there. */
	pick?: number;
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

/** A note as a reply envelope carries it (skills/explainer/src/reply/protocol.ts; kit-types/reply-protocol.ts keeps them equal). */
interface ReplyEnvelopeNote {
	where: string;
	quote?: string;
	part?: string;
	text: string;
}

/** An answer as a reply envelope carries it. */
interface ReplyEnvelopeAnswer {
	label: string;
	value: string | null;
	note: string;
	touched: boolean;
	recommended?: boolean;
}

/** What Send posts: the reply, one id per reply (a retry stores once) and the name the reader gave. */
interface ReplyEnvelope {
	v: 1;
	id: string;
	reader?: string;
	reply: { markdown: string; notes: ReplyEnvelopeNote[]; answers: ReplyEnvelopeAnswer[] };
}

interface ReplySendOptions {
	kitText: KitText<
		| "sendReply"
		| "sending"
		| "sent"
		| "sentChanged"
		| "sendFailed"
		| "unconfirmed"
		| "unreachable"
		| "noReceipt"
		| "readerName"
	>;
	h: ReplyNotesOptions["h"];
	reply: () => ReplyEnvelope["reply"];
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
/**
 * What makes a bar plot's categories pickable (Plot.make): `choose(i)` is called for a click on category i, and `strip`, the row
 * of controls under the plot, is lined up with the categories as the plot is drawn. A mouse over a category or its strip label
 * previews it (frame and key) until it leaves, without calling `choose`.
 */
interface PlotPicker {
	choose(i: number): void;
	strip?: HTMLElement | null;
}
declare var Plot: {
	make(
		el: HTMLElement,
		option: PlotOption,
		picker?: PlotPicker,
	): { set(patch: PlotOption): void; dispose(): void };
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
	/** The request body (a ReplyEnvelope as JSON) Send would post now, available once reply.js has initialized; nothing is sent. */
	body?: () => string;
};
/** reply.js's sending part (kit/parts/reply/send.ts): the request body, and the dialog's Send when the page has an endpoint. */
declare var ReplySend: (options: ReplySendOptions) => {
	/** What Send would post now, built as Send builds it. */
	body(): string;
	/** The name field and Send button, with Send's messages going to `status`; null without an endpoint. */
	controls(status: HTMLElement): { reader: HTMLElement; button: HTMLButtonElement } | null;
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
	 * For an option whose named lines carry their names at their ends: the option so (never with a legend in their place); else
	 * undefined. width measures a label at the label size.
	 */
	endNames(option: ChartOption, width: (text: string) => number): ChartOption | undefined;
	/**
	 * Why the option's two or more named lines, with no legend and no end labels of the author's, cannot carry their names at
	 * their ends ("its dataZoom", "a reversed x axis"), or undefined when they carry names.
	 */
	unnamed(option: ChartOption): string | undefined;
	/**
	 * Spread kit-generated end names about their ends inside the grid, a line apart where they fit. The patch changes only
	 * those offsets (every resets prior offsets on resize); unclear lists names that cannot fit or move over half a line.
	 */
	spreadEnds(
		chart: unknown,
		every?: boolean,
	): { patch: ChartOption | undefined; unclear: string[] };
	/**
	 * The option with the kit's defaults by series place: line dashes per palette slot, a line between stacked bars, marker
	 * labels on top, left of the markers `sides` names by series index (as markSides read them from the chart drawn).
	 */
	defaults(
		option: ChartOption,
		sides?: ReadonlyMap<number, ReadonlySet<number>>,
		inherited?: ChartOption,
	): ChartOption;
	/** What defaults generates for the option, as text to compare: a change redraws the chart rather than patching it. */
	styling(option: ChartOption): string;
	/** Which vertical markers of a drawn chart stand past the middle of their axis, by series index; see defaults. */
	markSides(chart: unknown): ReadonlyMap<number, ReadonlySet<number>>;
};
/** See ChartsOption's endNames, unnamed and spreadEnds (kit/parts/charts/ends.ts). */
declare var ChartsEnds: (env: {
	isObject: (value: unknown) => value is Record<string, unknown>;
	size: () => number;
}) => Pick<ReturnType<typeof ChartsOption>, "endNames" | "unnamed" | "spreadEnds">;
/** See ChartsOption's defaults (kit/parts/charts/defaults.ts). */
declare var ChartsDefaults: {
	/** ECharts component matching, shared by responsive defaults and saved-option updates. */
	places(target: unknown[], patch: unknown[]): (number | undefined)[];
	defaults(
		option: ChartOption,
		sides?: ReadonlyMap<number, ReadonlySet<number>>,
		inherited?: ChartOption,
	): ChartOption;
	styling(option: ChartOption): string;
	place(chart: unknown): ReadonlyMap<number, ReadonlySet<number>>;
};
declare var PlotDraw: (env: {
	/** The language numbers are written in. */
	lang: () => string;
	/** px: the size text is set at, the theme's --size-label. */
	size: () => number;
}) => {
	/**
	 * The SVG content for the option at W x H pixels, with series i drawn when shown[i]; textWidth measures a label in px. Value
	 * texts (bar and stem labels, bar titles) are written from `texts`, an option of the same series, where a move draws its steps.
	 */
	render(
		option: PlotOption,
		W: number,
		H: number,
		textWidth: (s: unknown) => number,
		shown: boolean[],
		texts?: PlotOption,
	): string;
	/**
	 * The legend's buttons, or "" when it shows none (lines that carry their names on the plot never have one); button i switches
	 * series i.
	 */
	legendMarkup(option: PlotOption): string;
	/** Each named series' value in category i, as the key writes it: "bought 403 kWh, sold 12 kWh". */
	keyText(option: PlotOption, i: number): string;
	/** Where a bar plot's categories lie along their axis at W x H (px), or undefined without categories or room. */
	bands(
		option: PlotOption,
		W: number,
		H: number,
		textWidth: (s: unknown) => number,
	): { start: number; end: number; count: number; vertical: boolean } | undefined;
	/** Per series: whether it is switched on, given the names switched off. */
	switchedOn(series: PlotSeries[], off: Set<string | undefined>): boolean[];
	/** How many lines the markers' labels take on top of the plot at W x H, which push it down (render lays them out the same). */
	markLines(option: PlotOption, W: number, H: number, textWidth: (s: unknown) => number): number;
	/**
	 * What the last render found no clear place for, each drawn on its least bad one: notes by their label, line names by their
	 * series' name.
	 */
	crowded(): { notes: string[]; names: string[] };
};

/** A mark's value text from its value, its index in the series and, for a stem, its x. */
type PlotLabeller = (value: number, i: number, x: number) => string;
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
