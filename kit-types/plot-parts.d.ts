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
declare var PlotLegend: (env: {
	swatch: ReturnType<typeof PlotMarks>["swatch"];
	esc: (s: unknown) => string;
	colour: (s: PlotSeries, i: number) => string;
	dash: (s: PlotSeries, i: number) => string;
	fill: (s: PlotSeries, i: number) => PlotFill | undefined;
	pick: ReturnType<typeof PlotPick>;
}) => {
	/**
	 * The legend's buttons for the named series, or "" when it is off, has one entry or the series carry their names on their
	 * marks (onMarks); a bar plot with a picked category has its key instead.
	 */
	markup(option: PlotOption, onMarks: boolean): string;
	/** Per series: whether it is switched on, given the names switched off. */
	switchedOn(series: PlotSeries[], off: Set<string | undefined>): boolean[];
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
	/** Whether the bar is cut at the axis's end, its value past it. */
	cut: boolean;
}
/** What a bar's value label keeps clear of: the markers' lines at `crossing` px, every bar's box and the labels placed. */
interface PlotBarRoom {
	crossing: readonly number[];
	bars: readonly PlotBox[];
	/** The labels placed before it, which it joins. */
	placed: PlotBox[];
}
declare var PlotBarLabels: (env: PlotSvg & { size: () => number }) => {
	/** A bar's value label t: inside its segment when stacked, else at its end clear of the markers, the bars and other labels. */
	barLabel(
		t: string,
		bar: PlotBarGeometry,
		stack: boolean,
		textWidth: (s: unknown) => number,
		room: PlotBarRoom,
	): string;
};
/**
 * A line's text at its end: the series' name (which pack names when it finds no clear place), the line in px, its last point,
 * colour and dash ("" for none), which a leader to a moved name takes.
 */
interface PlotEndName {
	name: string;
	series: string;
	/** The path a name is tried beside along it: a line's points, or a stem series' dots. */
	line: readonly PlotPx[];
	/** The series' marks a name must be nearer than any other series': a line, or each stem. */
	shapes: readonly (readonly PlotPx[])[];
	at: { x: number; y: number };
	colour: string;
	dash: string;
}
/** How a plot maps data to px, which series are switched on and how text is measured. */
interface PlotEndMap {
	X: (v: number) => number;
	Y: (v: number) => number;
	shown: boolean[];
	textWidth: (s: unknown) => number;
	/** The option whose values the texts give, where a move is going; unset, the option drawn. */
	texts?: PlotOption | undefined;
}
declare var PlotEnds: (
	env: PlotSvg & {
		size: () => number;
		place: PlotPlacer;
		format: ReturnType<typeof PlotFormat>;
		colour: (s: PlotSeries, i: number) => string;
		dash: (s: PlotSeries, i: number) => string;
		wrap: (text: string, width: number, textWidth: (s: unknown) => number) => string[];
	},
) => {
	/** Whether the series carry their names on their marks: never a legend in their place. */
	onMarks(option: PlotOption): boolean;
	/** The lines and stems with text at their ends, with their index: name and value, or the value alone. */
	named(
		option: PlotOption,
		textWidth: (s: unknown) => number,
	): { s: PlotSeries; i: number; name: string }[];
	/** px a name takes right of the plot. */
	room(name: string, textWidth: (s: unknown) => number): number;
	/**
	 * The texts drawn, spread apart in the frame, clear of the boxes `placed`, which they join, and the series whose name found
	 * no clear place (crowded).
	 */
	marks(
		option: PlotOption,
		map: PlotEndMap,
		frame: PlotNoteFrame,
		placed: PlotBox[],
	): { markup: string; crowded: string[] };
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
	/** Where a bar plot's categories lie along their axis in the plot's box as drawn. */
	bands(
		option: PlotOption,
		box: { L: number; R: number; T: number; B: number },
	): { start: number; end: number; count: number; vertical: boolean } | undefined;
};
interface PlotStemFrame {
	X: (v: number) => number;
	Y: (v: number) => number;
	ya: PlotNumericAxis;
	W: number;
	textWidth: (s: unknown) => number;
	shown: readonly boolean[];
	texts: PlotOption;
}
declare var PlotStems: (
	env: PlotSvg & {
		size: () => number;
		colour: (s: PlotSeries, i: number) => string;
		labeller: ReturnType<typeof PlotFormat>["labeller"];
		finite: (p: number | PlotPoint) => p is PlotPoint;
		px: (v: number) => number;
	},
) => {
	draw(s: PlotSeries, i: number, frame: PlotStemFrame): string;
	values(series: readonly PlotSeries[], frame: PlotStemFrame): PlotBox[];
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
	/**
	 * The bars of the series switched on with the picked category's frame (rects), each cut where it leaves the axis, their value
	 * labels, a cut bar's always, and the boxes bars and labels take.
	 */
	draw(
		series: readonly PlotSeries[],
		option: PlotOption,
		frame: PlotBarFrame,
	): { rects: string; labels: string; boxes: PlotBox[]; drawn: PlotBarDrawn[] };
};
/** A bar drawn: its series' and category's index, where it lies, its box (the one among the boxes bars take) and its value label's. */
interface PlotBarDrawn {
	series: number;
	category: number;
	bar: PlotBarGeometry;
	box: PlotBox;
	value?: PlotBox | undefined;
}
declare var PlotBarNames: (
	env: PlotSvg & { place: PlotPlacer; wrap: ReturnType<typeof PlotMarks>["wrap"] },
) => {
	/**
	 * Each named series' name on its bars, clear of the boxes `placed` (bars, values, markers' labels), which the names join, and
	 * the series whose name found no readable place (crowded); a group's names stay below `ceiling`.
	 */
	names(
		option: PlotOption,
		drawn: readonly PlotBarDrawn[],
		frame: PlotNoteFrame & { texts: PlotOption; ceiling?: number | undefined },
		placed: PlotBox[],
	): { markup: string; crowded: string[] };
	/**
	 * px the drawing must keep free for the names of bars side by side, above the plot past `top` (where the room left by the
	 * labels on top ends) and right of the frame's R; none for other bar plots.
	 */
	room(
		option: PlotOption,
		drawn: readonly PlotBarDrawn[],
		frame: PlotNoteFrame & { texts: PlotOption },
		top: number,
	): { top: number; right: number };
	sideRoom(limit: number, crowdedAt: (right: number) => string[] | undefined): number;
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
	/** A break across a bar at `at` px on the value axis, [from, to] px across it. */
	cut(at: number, across: readonly [number, number], horizontal: boolean): string;
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
/** A label's box in px. */
interface PlotBox {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
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
/** How end names and notes are placed (kit/parts/plot/place.ts). */
interface PlotPlacer {
	/** What a spot may cost and still be clear. */
	CLEAR: number;
	/** Whether two boxes keep apart. */
	apart(a: PlotBox, b: PlotBox): boolean;
	/** What a spot costs: boxes placed under it or its leader most, then lines it crosses, a leader, filled regions under it. */
	cost(spot: PlotSpot, frame: PlotNoteFrame, placed: readonly PlotBox[]): number;
	/** The spot that costs least, the first on a tie. */
	cheapest<S extends PlotSpot>(
		spots: readonly S[],
		frame: PlotNoteFrame,
		placed: readonly PlotBox[],
	): S | undefined;
	/** A label's spot wrapped to room px, from x (by anchor) and y0 down, kept inside the frame and across inside [lo, hi]. */
	spot(
		label: string,
		room: number,
		x: number,
		y0: number,
		anchor: PlotSpot["anchor"],
		frame: PlotNoteFrame,
		across?: readonly [number, number],
	): PlotSpot;
	/** px of a label's longest word. */
	longest(label: string, frame: PlotNoteFrame): number;
	/** px a label may run across: half the plot, or its longest word. */
	widest(label: string, frame: PlotNoteFrame): number;
	/** The spots beside a point, wrapped narrower, then away from it with a leader, in the order they are preferred. */
	pointSpots(label: string, at: PlotPx, frame: PlotNoteFrame): PlotSpot[];
	/** The spots away from a point, each tied to it by a leader. */
	leaderSpots(label: string, at: PlotPx, frame: PlotNoteFrame): PlotSpot[];
	/** The point of a box nearest p, where a leader from p ends. */
	nearest(box: PlotBox, at: PlotPx): PlotPx;
	/** Whether a point lies inside a polygon. */
	within(polygon: readonly PlotPx[], at: PlotPx): boolean;
	/** The lines labels keep clear of: the line series switched on, the markers' lines and the arrows, in px. */
	obstacles(option: PlotOption, frame: PlotAreaFrame): PlotPx[][];
}
declare var PlotPlace: (env: {
	wrap: (text: string, width: number, textWidth: (s: unknown) => number) => string[];
}) => PlotPlacer;
declare var PlotAreas: (env: {
	place: PlotPlacer;
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
	/** Picks where a label across the plot goes, of the spots it may take; unset, the first. */
	choose?: ((spots: PlotSpot[], placed: readonly PlotBox[]) => PlotSpot | undefined) | undefined;
}
/** What every axis has; a numeric axis also has its range, a category axis its names. at() and band are set by place(). */
interface PlotAxisBase {
	ticks: number[];
	labels: string[];
	name: string | undefined;
	vertical: boolean;
	at: (v: number) => number;
	band: number;
}
interface PlotNumericAxis extends PlotAxisBase {
	lo: number;
	hi: number;
	format: (v: number) => string;
	names?: undefined;
	notes?: undefined;
}
interface PlotCategoryAxis extends PlotAxisBase {
	names: string[];
	/** The categories' second lines, when one has one. */
	notes: string[] | undefined;
	/** The framed category's index (option.pick): the picked one, or the one a pointer previews. */
	picked: number | undefined;
}
type PlotAxis = PlotNumericAxis | PlotCategoryAxis;
interface PlotAxisFrame {
	xa: PlotAxis;
	ya: PlotAxis;
	L: number;
	R: number;
	T: number;
	B: number;
	H: number;
	picked: number | undefined;
	textWidth: (s: unknown) => number;
}
declare var PlotAxes: (env: { formatter: ReturnType<typeof PlotFormat>["formatter"] }) => {
	numericAxis(
		spec: AxisSpec,
		data: readonly [number, number],
		length: number,
		vertical: boolean,
	): PlotNumericAxis;
	categoryAxis(
		spec: AxisSpec,
		categories: PlotCategory[],
		vertical: boolean,
		picked: number | undefined,
	): PlotCategoryAxis;
	/** Gives the axis its pixel interval [a, b] and at(value), which maps a number, or a category index to its band centre. */
	place(axis: PlotAxis, a: number, b: number): void;
};
declare var PlotAxisLabels: (env: PlotSvg & { size(): number; pad: number; gap: number }) => {
	labelSpan(axis: PlotAxis, textWidth: PlotAxisFrame["textWidth"]): number;
	draw(frame: PlotAxisFrame): string;
};
