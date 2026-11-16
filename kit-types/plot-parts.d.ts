/* The globals of plot.js's inner parts (kit/parts/plot/) and the types they share, which pages never use: tsconfig.kit.json
 * checks the parts with them, and build/vendor.ts copies only globals.d.ts for authors. */

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
/** What a bar's label needs: where the bar lies on the screen. */
interface PlotBarGeometry {
	horizontal: boolean;
	start: number;
	length: number;
	end: number;
	mid: number;
	each: number;
	dir: number;
	bound: number;
	/** The bar's colour, which a value inside it is written against, unless it is `open`: light, so the value reads as one outside it. */
	colour: string;
	open: boolean;
}
declare var PlotBarLabels: (env: PlotSvg & { size: () => number }) => {
	/** A value label: inside a stacked segment when it fits, else at the end of a side-by-side bar, clear of the markers' lines at `crossing` px. */
	barLabel(
		t: string,
		bar: PlotBarGeometry,
		stack: boolean,
		textWidth: (s: unknown) => number,
		crossing: readonly number[],
	): string;
};
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
/** Where a bar plot's picked category lies: the category axis's pick and band centres, the value axis's mapping, the bars' thickness. */
interface PlotPickedBars {
	cat: { picked: number | undefined; at: (i: number) => number };
	val: { at: (v: number) => number };
	thick: number;
	horizontal: boolean;
}
declare var PlotPick: (env: {
	esc: (s: unknown) => string;
	formatter: ReturnType<typeof PlotFormat>["formatter"];
	labeller: ReturnType<typeof PlotFormat>["labeller"];
}) => {
	/** A bar plot's picked category (option.pick), or undefined when it has none. */
	pickedAt(option: PlotOption): number | undefined;
	/** The frame around the picked category's bars of these series (the ones shown), from the baseline to their far end; "" for none. */
	frame(series: readonly PlotSeries[], stack: boolean, bars: PlotPickedBars): string;
	/** Each named series' value in category i: "bought 403 kWh, sold 12 kWh". */
	keyText(option: PlotOption, i: number): string;
	/** The key's items for category `at`: its name, then each named series' button (index and swatch markup) with its value. */
	key(
		option: PlotOption,
		at: number,
		named: readonly (readonly [PlotSeries, number, string])[],
	): string;
	/** Where a bar plot's categories lie along their axis in a layout whose marker labels take `rows` lines of `line` px on top. */
	bands(
		option: PlotOption,
		layout: { box: { L: number; R: number; T: number; B: number }; rows: number },
		line: number,
	): { start: number; end: number; count: number; vertical: boolean } | undefined;
};
/** What PlotBars draws in: the category axis, the value axis, the plot's box, the series switched on, the text's measure and texts. */
interface PlotBarFrame {
	cat: {
		at: (i: number) => number;
		band: number;
		names: readonly string[];
		picked: number | undefined;
	};
	val: { at: (v: number) => number; lo: number; hi: number; format: (v: number) => string };
	W: number;
	L: number;
	B: number;
	shown: readonly boolean[];
	textWidth: (s: unknown) => number;
	/** The option whose values the texts give: the option drawn, or where a move is going. */
	texts: PlotOption;
}
declare var PlotBars: (
	env: PlotSvg & {
		size: () => number;
		marks: ReturnType<typeof PlotMarks>;
		esc: (s: unknown) => string;
		fill: (s: PlotSeries, i: number) => PlotFill | undefined;
		colour: (s: PlotSeries, i: number) => string;
		labeller: ReturnType<typeof PlotFormat>["labeller"];
		pick: ReturnType<typeof PlotPick>;
	},
) => {
	/** The bars of the series switched on with the picked category's frame (rects), and their value labels. */
	draw(
		series: readonly PlotSeries[],
		option: PlotOption,
		frame: PlotBarFrame,
	): { rects: string; labels: string };
};
/** A step of a plot's tween: the option `k` of the way (0 to 1) from `from` to `to`, numbers moved where the shapes match. */
declare var PlotTween: () => {
	between(from: PlotOption, to: PlotOption, k: number): PlotOption;
	/** Whether two options are the same, value for value (functions by identity). */
	same(a: unknown, b: unknown): boolean;
};
declare var PlotMarks: (env: PlotSvg) => {
	/** An area, a polygon in px, in a tint of colour (true) or a state; open when a label on it reads as one outside it. */
	area(
		state: PlotFill | true,
		colour: string,
		polygon: readonly PlotPx[],
	): { markup: string; open: boolean };
	/** A label's words in lines no wider than width px; a longer word stands on a line of its own. */
	wrap(text: string, width: number, textWidth: (s: unknown) => number): string[];
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
	): { lines: string; labels: string; boxes: PlotBox[] };
	/** How many lines the tallest label on top takes. */
	rows(marks: readonly PlotMark[], frame: PlotMarkFrame): number;
	/** A series' legend swatch: its type, colour, dash (an SVG dash array, "" solid) and its bars' state. */
	swatch(type: string, colour: string, dash: string, state: PlotFill | undefined): string;
};
/** A label's box in a plot's drawing, in px. */
interface PlotBox {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}
/** A point in a plot's drawing, in px. */
type PlotPx = readonly [number, number];
/** A note to place on the plot: its label, beside a point or in a region (its edges and polygon in px). */
interface PlotNote {
	label: string;
	at?: PlotPx | undefined;
	region?:
		| {
				edges: readonly [readonly PlotPx[], readonly PlotPx[]];
				polygon: readonly PlotPx[];
				/** The region's colour when it is solid, which a label inside it is written against. */
				colour?: string | undefined;
		  }
		| undefined;
}
/**
 * A place a label may take: its box, its lines and how they align in it, the region it is inside, and the point a leader ties it
 * to when it sits away from it.
 */
interface PlotSpot {
	box: PlotBox;
	lines: string[];
	anchor: "start" | "middle" | "end";
	inside?: PlotNote["region"];
	leader?: PlotPx | undefined;
}
/** Where notes were placed: each note's spot by its index, none for one not drawn. */
interface PlotNotesPlaced {
	notes: readonly PlotNote[];
	spots: readonly (PlotSpot | undefined)[];
}
/** What notes are placed in: the plot's box, the lines and filled regions they keep clear of, and the text's measure. */
interface PlotNoteFrame {
	L: number;
	R: number;
	T: number;
	B: number;
	line: number;
	lines: readonly (readonly PlotPx[])[];
	fills: readonly (readonly PlotPx[])[];
	textWidth: (s: unknown) => number;
}
/** What the areas and notes are drawn in: the plot's mapping and box, the series switched on and their colours. */
interface PlotAreaFrame {
	X: (v: number) => number;
	Y: (v: number) => number;
	L: number;
	R: number;
	T: number;
	B: number;
	line: number;
	textWidth: (s: unknown) => number;
	shown: boolean[];
	colour: (s: PlotSeries, i: number) => string;
}
declare var PlotAreas: (env: {
	svgText: PlotSvg["svgText"];
	svgLine: PlotSvg["svgLine"];
	wrap: (text: string, width: number, textWidth: (s: unknown) => number) => string[];
	area: (
		state: PlotFill | true,
		colour: string,
		polygon: readonly PlotPx[],
	) => { markup: string; open: boolean };
}) => {
	/**
	 * The filled lines' areas and the regions (fills, under the lines), and the notes' labels placed together (notes), naming
	 * those no place was clear for (crowded), and where they went (placed). With a move's `goal`, the notes are where the goal
	 * placed them, carried along with their points and regions.
	 */
	draw(
		option: PlotOption,
		frame: PlotAreaFrame,
		taken: readonly PlotBox[],
		goal?: PlotNotesPlaced,
	): { fills: string; notes: string; crowded: string[]; placed: PlotNotesPlaced };
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
