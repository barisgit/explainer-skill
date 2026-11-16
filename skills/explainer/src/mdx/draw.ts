/**
 * Draws each Chart and Plot into the page while pack renders it (kit/components/parts/drawn.ts), so the figure is there before
 * any script runs, with scripts off, in print and in check's shots. Each is drawn three times, at the widths a chart has on a
 * desktop, in half a desktop column and on a phone; theme.css shows the copy nearest the element's width until the kit script
 * draws it at its own size.
 *
 * A Chart is drawn by ECharts with its SVG renderer (vendor/echarts-ssr.js), from the option and theme charts.js makes
 * (kit/parts/charts/option.ts). Every colour expression, the kit's tokens included, goes in as a stand-in colour and comes out
 * as the expression again (stand-ins.ts), so the SVG follows light and dark, a page's token overrides and the tone under it, as
 * a Plot does. What pack draws is exact or absent: a figure with a colour or a height pack cannot tell is not drawn here.
 * A Plot is drawn by plot.js's own code (kit/parts/plot/draw.ts). Text is measured in Geist (geist.ts).
 */
import { join } from "node:path";
import type * as EChartsSsr from "../../vendor/echarts-ssr.js";
import { unescapeHtml } from "../escape.ts";
import { geistAdvance, textWidth } from "../geist.ts";
import { runKitPart, themeSize } from "../kit.ts";
import { PackError } from "../pack-error.ts";
import { SKILL_ROOT } from "../paths.ts";
import { lengthAt, type Place, pageBoxTouch, type Viewport } from "./chart-box.ts";
import { chartColours } from "./chart-colours.ts";
import { legendHeights, legendWidths } from "./chart-legend.ts";
import { kitSvg, shorterPaths } from "./drawn-svg.ts";
import { standIns } from "./stand-ins.ts";

/** A Chart or Plot option, as the page wrote it; a Plot's series is the one key the drawer reads. */
type Option = Record<string, unknown> & { series?: unknown[] };

/** What kit/parts/charts/option.ts gives (ChartsOption in kit-types/globals.d.ts). */
interface ChartsOption {
	resolveOption<T>(option: T): T;
	theme(place: { under: string; font: string; animation: boolean }): Option;
	layout(chart: unknown): void;
	measureText(base: typeof measureText): typeof measureText;
	still(option: Option): Option;
	endNames(
		option: Option,
		width: (text: string) => number,
	): { named: Option; legend: Option } | undefined;
	crowded(chart: unknown): boolean;
	defaults(option: Option, sides?: ReadonlyMap<number, ReadonlySet<number>>): Option;
	markSides(chart: unknown): ReadonlyMap<number, ReadonlySet<number>>;
}
type ChartsOptionPart = (env: {
	color: (expression: string) => string;
	lang: () => string;
	size: () => number;
	text: () => number;
}) => ChartsOption;

/** What kit/parts/plot/draw.ts gives (PlotDraw in kit-types/globals.d.ts). */
interface PlotDraw {
	render(
		option: Option,
		W: number,
		H: number,
		width: (s: unknown) => number,
		shown: boolean[],
	): string;
	legendMarkup(option: Option, textWidth: (s: unknown) => number, H: number): string;
	switchedOn(series: unknown[], off: Set<string | undefined>): boolean[];
	markLines(option: Option, W: number, H: number, textWidth: (s: unknown) => number): number;
	crowded(): string[];
}
type PlotDrawPart = (env: { lang: () => string; size: () => number }) => PlotDraw;

/**
 * A copy's size and the data-fit theme.css shows it by (none for the desktop copy), in CSS pixels, with the window a height
 * written in vw or vh is worked out at, and the element widths that show it: theme.css's container queries, bounded by the
 * narrowest and widest an element has (NARROWEST, WIDEST).
 */
interface Copy {
	fit: string;
	width: number;
	shown: readonly [number, number];
	height: number;
	tall: number;
	viewport: Viewport;
}

/** The narrowest element: a 320 px window less its gutters. The widest: a `.wide` figure (81rem). */
const NARROWEST = 288;
const WIDEST = 1296;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/**
 * The sizes theme.css gives `.chart` (block-size clamp(18rem, 48vw, 26rem), .tall clamp(22rem, 60vw, 34rem)) in the page's
 * column at check's desktop (1440) and phone (390) widths, and in half the desktop column, as two figures side by side are.
 * A `height` prop replaces the theme's; a page rule that may change the element's box (chart-box.ts) leaves the figure
 * to the kit script, which draws it as the page loads.
 */
const COPIES: Copy[] = [
	{ fit: "", width: 1054, shown: [736, WIDEST], height: 416, tall: 544, viewport: DESKTOP },
	{ fit: "half", width: 527, shown: [440, 736], height: 416, tall: 544, viewport: DESKTOP },
	{ fit: "phone", width: 356, shown: [NARROWEST, 440], height: 288, tall: 352, viewport: PHONE },
];
/** The opening tag of a copy's svg, sized by its viewBox. */
const svgTag = (copy: Copy, height: number) =>
	`<svg viewBox="0 0 ${copy.width} ${height}"${copy.fit ? ` data-fit="${copy.fit}"` : ""}>`;
/** The copies of one figure, in the element theme.css picks one of them in and the kit script removes. */
const drawnCopies = (svgs: string[]) =>
	`<div class="chart-drawn" aria-hidden="true">${svgs.join("")}</div>`;
/** px: the size of every text in a Chart or Plot, the theme's --size-label. */
const LABEL = themeSize("--size-label");
/** px: a Chart title's size, the theme's --size-text. */
const TEXT = themeSize("--size-text");
/** px: a line of a Plot marker's label (plot.js's lineHeight, Plot's --plot-mark-lines step). */
const MARK_LINE = LABEL + 4;
/**
 * theme.css's `.plot-legend`, in pixels: its padding above the buttons, a button's height (line 1.4 and 0.375rem above and
 * below), the gap between buttons, their padding at each side of the list, and a button's swatch and the gap after it.
 */
const LEGEND = {
	top: 8,
	row: LABEL * 1.4 + 12,
	gap: 16,
	side: 16,
	swatch: { line: 16, box: 12 },
	label: 8,
};

/** The theme's font for ECharts, which writes it into each text's style, so the page's font applies. */
const FONT = "var(--font)";

/** The measure ECharts lays text out with: Geist, at the size and weight in a CSS font shorthand ("bold 18px var(--font)"). */
function measureText(text: string, font?: string) {
	const size = Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1] ?? 12);
	const weight = /\bbold(er)?\b/.test(font ?? "")
		? 700
		: Number(/\b([1-9]00)\b/.exec(font ?? "")?.[1] ?? 400);
	return { width: textWidth(text, size, weight) };
}

let echarts: typeof EChartsSsr | undefined;

/** ECharts' SSR build, loaded the first time a page draws a chart (it takes about 90 ms to load). */
function loadEcharts(): typeof EChartsSsr {
	if (!echarts) {
		// require loads the ES module synchronously, as the page's render, which calls this, is synchronous.
		echarts = require(join(SKILL_ROOT, "vendor/echarts-ssr.js")) as typeof EChartsSsr;
	}
	return echarts;
}

/** Explicit series types in ordinary, base and responsive options; missing types are valid in merge patches. */
function seriesIn(option: unknown): string[] {
	if (!option || typeof option !== "object") {
		return [];
	}
	const value = option as {
		series?: unknown;
		media?: unknown;
		options?: unknown;
		baseOption?: unknown;
	};
	const series = Array.isArray(value.series) ? value.series : [value.series];
	const types = series.flatMap((item: unknown) => {
		if (item && typeof item === "object" && "type" in item && typeof item.type === "string") {
			return [item.type];
		}
		return [];
	});
	const media = Array.isArray(value.media) ? value.media : [];
	const options = Array.isArray(value.options) ? value.options : [];
	return types.concat(
		seriesIn(value.baseOption),
		options.flatMap(seriesIn),
		media.flatMap((entry: unknown) =>
			entry && typeof entry === "object" && "option" in entry ? seriesIn(entry.option) : [],
		),
	);
}

/** Rejects unsupported series independently of drawing, including options in non-initial Explore frames. */
function validateChart(option: unknown): void {
	const bundled = loadEcharts().seriesTypes;
	for (const type of seriesIn(option)) {
		if (!bundled.includes(type)) {
			throw new PackError(
				`ECharts series type "${type}" is not bundled; use ${bundled.join(", ")} instead.`,
			);
		}
	}
}

/** A Plot mark's shapes, by the key that names each, with the keys each takes (kit-types/globals.d.ts's PlotMark). */
const MARK_SHAPES = [
	{ by: "at", name: "a note at a point", keys: ["at", "label"] },
	{ by: "between", name: "a region", keys: ["x", "between", "fill", "label"] },
	{ by: "y", name: "a marker across", keys: ["y", "label"] },
	{ by: "x", name: "a marker or a span", keys: ["x", "label"] },
] as const;

/** What is wrong with one Plot mark's shape, which plot.js would draw as another shape or leave out without a word. */
function markShapeProblem(mark: Record<string, unknown>): string | undefined {
	const written = JSON.stringify(mark);
	const shape = MARK_SHAPES.find(({ by }) => by in mark);
	if (!shape) {
		return `Plot mark ${written}: a mark takes x, y, at or between.`;
	}
	const { x } = mark;
	if (shape.by === "between" && !(Array.isArray(x) && x.length === 2)) {
		return `Plot mark ${written}: a region needs x: [from, to], the span it covers.`;
	}
	const extra = Object.keys(mark).filter((key) => !(shape.keys as readonly string[]).includes(key));
	return extra.length
		? `Plot mark ${written}: ${shape.name} takes only ${shape.keys.join(", ")}; write ${extra.join(", ")} in a mark of its own (a fill goes with between and x: [from, to]).`
		: undefined;
}

/**
 * Rejects a Plot mark of no one shape and a region between a series the plot does not have, which plot.js would draw otherwise
 * or leave out without a word.
 */
function validatePlot(option: Option): void {
	const { marks: written } = option as { marks?: unknown };
	const problem = (Array.isArray(written) ? written : [])
		.map((mark) => (mark && typeof mark === "object" ? markShapeProblem(mark) : undefined))
		.find(Boolean);
	if (problem) {
		throw new PackError(problem);
	}
	const lines = (option.series ?? []).flatMap((s) => {
		const { name, type = "line" } = (s ?? {}) as { name?: unknown; type?: unknown };
		return type === "line" && typeof name === "string" ? [name] : [];
	});
	const { marks: given } = option as { marks?: unknown };
	const marks = Array.isArray(given) ? (given as { between?: unknown }[]) : [];
	for (const bound of marks.flatMap((m) => (Array.isArray(m?.between) ? m.between : []))) {
		if (typeof bound === "string" && !lines.includes(bound)) {
			const named = lines.length ? lines.map((n) => `"${n}"`).join(", ") : "none: name one";
			throw new PackError(
				`Plot mark between "${bound}": no line series has that name; the plot's named lines are ${named}.`,
			);
		}
	}
}

/** Runs `draw` with the console silenced: ECharts' warnings about an option are the browser's to show, where check reports them. */
function quietly<T>(draw: () => T): T {
	const { warn, error, log } = console;
	console.warn = console.error = console.log = () => undefined;
	try {
		return draw();
	} finally {
		Object.assign(console, { warn, error, log });
	}
}

/**
 * Which vertical markers of a chart stand past the middle of their axis, read from a first drawing at the desktop copy's size as
 * kit/charts.ts reads them from its first draw: their labels go on the line's left. A marker's place on its axis does not
 * change with the width.
 */
function markerSides(option: Option, theme: Option, charts: ChartsOption) {
	if (!JSON.stringify(option).includes('"markLine"')) {
		return new Map<number, ReadonlySet<number>>();
	}
	const chart = loadEcharts().init(null, theme, {
		renderer: "svg",
		ssr: true,
		width: 1054,
		height: 400,
	});
	try {
		quietly(() => chart.setOption(charts.still(charts.resolveOption(charts.defaults(option)))));
		return charts.markSides(chart);
	} finally {
		chart.dispose();
	}
}

/**
 * One chart's SVG at a size, as ECharts draws it without animation, with the option it drew: `fallback` (resolved) in place of
 * `option` where its names at the line ends crowd, as kit/charts.ts draws a live chart.
 */
function chartSvg(
	option: Option,
	theme: Option,
	width: number,
	height: number,
	charts: ChartsOption,
	fallback?: Option,
): { svg: string; legends: number[]; option: Option } | undefined {
	const renderer = loadEcharts();
	renderer.setPlatformAPI({ measureText: charts.measureText(measureText) });
	const chart = renderer.init(null, theme, { renderer: "svg", ssr: true, width, height });
	try {
		charts.layout(chart);
		quietly(() => chart.setOption(charts.still(option)));
		const drawn = fallback && charts.crowded(chart) ? fallback : option;
		if (drawn !== option) {
			quietly(() => chart.setOption(charts.still(drawn), { notMerge: true }));
		}
		const legends = legendHeights(chart);
		if (!legends) {
			return undefined;
		}
		const svg = chart.renderToSVGString();
		// Check drawn text, not author names: ECharts derives dataset names and runs formatters. Its text cache can bypass measureText.
		const known = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].every((match) =>
			[...unescapeHtml(match[1] ?? "")].every((char) => geistAdvance(char, 400) !== undefined),
		);
		return known ? { svg, legends, option: drawn } : undefined;
	} finally {
		// A live instance keeps an animation timer, which would keep pack from exiting.
		chart.dispose();
	}
}

/**
 * What `draw` returns, or nothing when it throws: an option the browser alone can draw (a formatter that reads the page) or one
 * the kit script rejects is left to the script, which reports it where check sees it, as it did before pack drew figures.
 */
function orNothing<T extends unknown[]>(draw: (...args: T) => string): (...args: T) => string {
	return (...args) => {
		try {
			return draw(...args);
		} catch {
			return "";
		}
	};
}

/**
 * The items of a plot's legend as plot.js writes them: each with its swatch's width (0 for a picked category's name heading its
 * key) and its texts, a series' name and, in a key, its value, which the button sets a gap apart.
 */
function legendItems(legend: string): { swatch: number; texts: string[] }[] {
	return [...legend.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map(([, item = ""]) => {
		const kind = /<i class="([^"]*)"/.exec(item)?.[1];
		return {
			swatch:
				kind === undefined
					? 0
					: /\b(?:bar|stem)\b/.test(kind)
						? LEGEND.swatch.box
						: LEGEND.swatch.line,
			// plot.js writes &, <, > and " as numeric references; the reader sees the characters.
			texts: item
				.split(/<[^>]*>/)
				.filter(Boolean)
				.map((text) =>
					text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))),
				),
		};
	});
}

/**
 * How many rows the legend wraps into in an element `width` wide, when its labels are set at `weight`. Never more at a greater
 * width, so equal rows at both ends of a range of widths are the rows between them.
 */
function legendRows(items: ReturnType<typeof legendItems>, width: number, weight: number): number {
	let rows = 1;
	let used = 0;
	for (const { swatch, texts } of items) {
		const words = texts.reduce((sum, text) => sum + textWidth(text, LABEL, weight), 0);
		// The flex gap of a button sits between its swatch and texts; a key's name is set at 600.
		const parts = texts.length + (swatch ? 1 : 0);
		const button =
			swatch +
			(parts - 1) * LEGEND.label +
			(swatch ? words : textWidth(texts.join(""), LABEL, 600));
		const next = used === 0 ? button : used + LEGEND.gap + button;
		if (used > 0 && next > width - 2 * LEGEND.side) {
			rows++;
			used = button;
		} else {
			used = next;
		}
	}
	return rows;
}

/** Whether a chart has a title, which is set at the text size (ChartsOption's theme) that a page's rule may change. */
function titled(option: Option): boolean {
	const { baseOption } = option;
	return (
		"title" in option ||
		(typeof baseOption === "object" && baseOption !== null && "title" in baseOption)
	);
}

/** What draws a chart's copies: its option and fallback resolved, the theme, and the stand-ins' paints. */
interface ChartHow {
	option: Option;
	theme: Option;
	charts: ChartsOption;
	fallback: Option | undefined;
	paintOf: Parameters<typeof kitSvg>[2];
}

/**
 * One copy of a chart, or undefined where pack cannot draw it exactly: its legend must take the same rows at every width the
 * copy is shown at.
 */
function chartCopy(copy: Copy, height: number, how: ChartHow): string | undefined {
	const { option, theme, charts, fallback, paintOf } = how;
	const drawing = chartSvg(option, theme, copy.width, height, charts, fallback);
	if (!drawing) {
		return undefined;
	}
	const widths = legendWidths(drawing.option, height, copy.shown, copy.fit === "");
	// With no legend or media transitions, there is no width-sensitive legend geometry to certify.
	const stable =
		(drawing.legends.length === 0 && widths.length === 2) ||
		widths.every((width) => {
			const sample =
				width === copy.width ? drawing : chartSvg(option, theme, width, height, charts, fallback);
			return (
				sample !== undefined && JSON.stringify(sample.legends) === JSON.stringify(drawing.legends)
			);
		});
	return stable ? kitSvg(drawing.svg, svgTag(copy, height), paintOf) : undefined;
}

/** What pack says about the notes a plot drawn `width` px wide found no clear place for. */
const crowdedWarnings = (notes: string[], width: number) =>
	notes.map(
		(note) =>
			`Plot note "${note}" finds no clear place at ${width} px wide and is drawn over a line, a label or the plot's edge: shorten it, or anchor it where the plot has room.`,
	);

/** The drawer pack renders a page in `lang` with (kit/components/parts/drawn.ts's Drawer). */
export function pageDrawer(lang: string, stylesheets: Iterable<string>) {
	const pageTouchesBox = pageBoxTouch(stylesheets);
	/** The heights of the copies of the figure on `place`, or undefined when pack cannot tell them. */
	function heightsOf(place: Place, titled = false): number[] | undefined {
		if (pageTouchesBox(place, titled)) {
			return undefined;
		}
		const heights = COPIES.map((copy) =>
			place.height === undefined
				? place.classes.includes("tall")
					? copy.tall
					: copy.height
				: lengthAt(place.height, copy.viewport),
		);
		return heights.every((h) => h !== undefined) ? heights : undefined;
	}
	const chartsOption = runKitPart("charts/option.ts", "ChartsOption") as ChartsOptionPart;
	const plots = (runKitPart("plot/draw.ts", "PlotDraw") as PlotDrawPart)({
		lang: () => lang,
		size: () => LABEL,
	});
	const width = (s: unknown) => textWidth(String(s), LABEL, 500);
	/** What pack says about the figures it drew: the notes a plot found no clear place for, by the copy's width. */
	const warnings = new Set<string>();
	/** The lines a plot's markers' labels take on top in each copy, laid out as plot.js lays them out at the copy's width. */
	const markRows = (option: Option, place: Place) => {
		const heights = heightsOf(place);
		return COPIES.map((copy, i) =>
			heights ? plots.markLines(option, copy.width, heights[i] as number, width) : 0,
		);
	};
	const drawChart = orNothing((option: Option, place: Place) => {
		const heights = heightsOf(place, titled(option));
		const colours = chartColours(option, loadEcharts().ownColors);
		if (!(heights && colours)) {
			return "";
		}
		// Each chart has stand-ins of its own, clear of the colours its option writes as they are.
		const { color, paintOf } = standIns(colours);
		const charts = chartsOption({ color, lang: () => lang, size: () => LABEL, text: () => TEXT });
		const theme = charts.theme({ under: color("var(--under)"), font: FONT, animation: false });
		// Names at the line ends are measured as ECharts measures a label, at the label size. They crowd or not by a copy's height
		// alone.
		const kept = charts.defaults(option, markerSides(option, theme, charts));
		const ends = charts.endNames(kept, (text) => measureText(text, `${LABEL}px`).width);
		const resolved = charts.resolveOption(ends ? ends.named : kept);
		const fallback = ends && charts.resolveOption(ends.legend);
		const how = { option: resolved, theme, charts, fallback, paintOf };
		const copies = COPIES.map((copy, i) => chartCopy(copy, heights[i] as number, how));
		return copies.every((copy) => copy !== undefined) ? drawnCopies(copies) : "";
	});
	const drawPlot = orNothing((option: Option, place: Place) => {
		const rows = markRows(option, place);
		const grown = heightsOf(place)?.map((h) => h + (place.grows ? (rows[0] ?? 0) * MARK_LINE : 0));
		// A bar plot that grows by its markers' lines has one height for every copy only when they wrap alike.
		const heights = place.grows && new Set(rows).size > 1 ? undefined : grown;
		if (!heights) {
			return "";
		}
		// Names at the line ends take the legend's place where they fit the area's height with no legend, so the copies can
		// differ; one legend is drawn for all of them, so a plot whose copies differ is left to plot.js.
		const legends = new Set(
			heights.map((height) => plots.legendMarkup(option, width, height - LEGEND.top)),
		);
		const [markup = ""] = legends;
		if (legends.size > 1) {
			return "";
		}
		// Every series starts switched on; plot.js marks its buttons so as it draws.
		const legend = markup.replace(/<button /g, '<button aria-pressed="true" ');
		const items = legendItems(legend);
		const shown = plots.switchedOn(option.series ?? [], new Set());
		const copies = COPIES.map((copy, i) => {
			// The legend wraps by the element's width, which a copy is shown over a range of, for labels set lighter or heavier
			// than measured: the area is the same height only where the rows are the same across all of it.
			const rows = new Set(
				copy.shown.flatMap((w) =>
					[400, 500].map((weight) => (items.length ? legendRows(items, w, weight) : 0)),
				),
			);
			const [one] = rows;
			if (rows.size > 1) {
				return undefined;
			}
			const H = (heights[i] as number) - LEGEND.top - (one as number) * LEGEND.row;
			const drawn = plots.render(option, copy.width, H, width, shown);
			for (const w of crowdedWarnings(plots.crowded(), copy.width)) {
				warnings.add(w);
			}
			return `${svgTag(copy, H)}${shorterPaths(drawn)}</svg>`;
		});
		return copies.every((copy) => copy !== undefined)
			? `<ul class="plot-legend">${legend}</ul><div class="plot-area">${drawnCopies(copies)}</div>`
			: "";
	});
	return {
		validateChart,
		warnings: () => [...warnings],
		plotMarkLines: (option: Option, place: Place) => markRows(option, place)[0] ?? 0,
		chart(option: Option, place: Place) {
			// Validate before the optional drawing: an absent SVG must not hide an unsupported series.
			validateChart(option);
			// renderItem is arbitrary drawing code: its geometry and colours cannot be proven exact by the SVG pass.
			return seriesIn(option).includes("custom") ? "" : drawChart(option, place);
		},
		plot(option: Option, place: Place) {
			validatePlot(option);
			return drawPlot(option, place);
		},
	};
}
