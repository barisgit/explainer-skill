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
import { textWidth } from "../geist.ts";
import { runKitPart } from "../kit.ts";
import { SKILL_ROOT } from "../paths.ts";
import { type PageHeight, type Place, pageHeights, type Viewport } from "./chart-heights.ts";
import { kitSvg, shorterPaths } from "./drawn-svg.ts";
import { type ChartColours, standIns } from "./stand-ins.ts";

/** A Chart or Plot option, as the page wrote it; a Plot's series is the one key the drawer reads. */
type Option = Record<string, unknown> & { series?: unknown[] };

/** What kit/parts/charts/option.ts gives (ChartsOption in kit-types/globals.d.ts). */
interface ChartsOption {
	resolveOption<T>(option: T): T;
	theme(place: { under: string; font: string; animation: boolean }): Option;
}
type ChartsOptionPart = (env: {
	color: (expression: string) => string;
	lang: () => string;
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
	legendMarkup(option: Option): string;
	switchedOn(series: unknown[], off: Set<string | undefined>): boolean[];
}
type PlotDrawPart = (env: { lang: () => string }) => PlotDraw;

/**
 * A copy's size and the data-fit theme.css shows it by (none for the desktop copy), in CSS pixels, with the window a page's
 * own height for a chart is worked out at.
 */
interface Copy {
	fit: string;
	width: number;
	height: number;
	tall: number;
	viewport: Viewport;
}

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/**
 * The sizes theme.css gives `.chart` (block-size clamp(18rem, 48vw, 26rem), .tall clamp(22rem, 60vw, 34rem)) in the page's
 * column at check's desktop (1440) and phone (390) widths, and in half the desktop column, as two figures side by side are.
 * A height the page's own CSS gives the chart replaces the theme's (chart-heights.ts); where pack cannot tell that height, it
 * draws nothing, and the kit script draws the figure as the page loads.
 */
const COPIES: Copy[] = [
	{ fit: "", width: 1054, height: 416, tall: 544, viewport: DESKTOP },
	{ fit: "half", width: 527, height: 416, tall: 544, viewport: DESKTOP },
	{ fit: "phone", width: 356, height: 288, tall: 352, viewport: PHONE },
];
/** The opening tag of a copy's svg, sized by its viewBox. */
const svgTag = (copy: Copy, height: number) =>
	`<svg viewBox="0 0 ${copy.width} ${height}"${copy.fit ? ` data-fit="${copy.fit}"` : ""}>`;
/** The copies of one figure, in the element theme.css picks one of them in and the kit script removes. */
const drawnCopies = (svgs: string[]) =>
	`<div class="chart-drawn" aria-hidden="true">${svgs.join("")}</div>`;
/** Above a plot's area: the legend's padding, and one row of legend buttons when it shows. */
const PLOT_LEGEND = { padding: 8, row: 30 };
/** The size of the text plot.js measures its labels at. */
const PLOT_FONT = 13;

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
		echarts.setPlatformAPI({ measureText });
	}
	return echarts;
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

/** One chart's SVG at a size, as ECharts draws it without animation. */
function chartSvg(option: Option, theme: Option, width: number, height: number): string {
	const chart = loadEcharts().init(null, theme, { renderer: "svg", ssr: true, width, height });
	try {
		quietly(() => chart.setOption(option));
		return chart.renderToSVGString();
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

/** The keys under which ECharts may replace a colour's alpha rather than multiply it. */
const REPLACES_ALPHA = new Set(["colorAlpha", "markArea"]);

/** The keys under which an option writes a colour or a list of them, as kit/parts/charts/option.ts reads them. */
const COLOR_KEY = /(olor|^fill|^stroke)$/;
/** The colour expressions pack stands in for, as kit/parts/charts/option.ts finds them. */
const COLOR_EXPR = /^(var|color-mix|light-dark)\(/;

/** The colour expressions an array lists, as strings or under its items' colour keys: the ones ECharts may mix. */
const listed = (items: unknown[]) =>
	items.flatMap((item) => {
		const values =
			item !== null && typeof item === "object"
				? Object.entries(item).flatMap(([key, value]) => (COLOR_KEY.test(key) ? [value] : []))
				: [item];
		return values.filter((v): v is string => typeof v === "string" && COLOR_EXPR.test(v));
	});

/**
 * What an option says about its colours (stand-ins.ts): the colours it writes as they are, with ECharts' own; the expressions it
 * lists together; whether it may replace alphas.
 */
function chartColours(option: unknown): ChartColours {
	const literals = [...loadEcharts().ownColors];
	const mixes: string[][] = [];
	let replacesAlpha = false;
	const visit = (value: unknown): void => {
		if (typeof value === "string") {
			if (Bun.color(value, "css") !== null) {
				literals.push(value);
			}
		} else if (Array.isArray(value)) {
			mixes.push(listed(value));
			value.forEach(visit);
		} else if (value !== null && typeof value === "object") {
			for (const [key, item] of Object.entries(value)) {
				replacesAlpha ||= REPLACES_ALPHA.has(key);
				visit(item);
			}
		}
	};
	visit(option);
	return { literals, mixes: mixes.filter((group) => group.length > 1), replacesAlpha };
}

/** The drawer pack renders a page in `lang` with (kit/components/parts/drawn.ts's Drawer). */
export function pageDrawer(lang: string, stylesheets: Iterable<string>) {
	const pageHeight = pageHeights(stylesheets);
	/** The heights of the copies of the figure on `place`, or undefined when pack cannot tell one of them. */
	function heightsOf(place: Place): number[] | undefined {
		const heights = COPIES.map((copy): PageHeight => {
			const height = pageHeight(place, copy.viewport);
			return height === "theme"
				? place.classes.includes("tall")
					? copy.tall
					: copy.height
				: height;
		});
		return heights.every((h) => typeof h === "number") ? heights : undefined;
	}
	const chartsOption = runKitPart("charts/option.ts", "ChartsOption") as ChartsOptionPart;
	const plots = (runKitPart("plot/draw.ts", "PlotDraw") as PlotDrawPart)({ lang: () => lang });
	return {
		chart: orNothing((option: Option, place: Place) => {
			const heights = heightsOf(place);
			if (!heights) {
				return "";
			}
			// Each chart has stand-ins of its own, clear of the colours its option writes as they are.
			const { color, paintOf } = standIns(chartColours(option));
			const charts = chartsOption({ color, lang: () => lang });
			const theme = charts.theme({ under: color("var(--under)"), font: FONT, animation: false });
			const resolved = charts.resolveOption(option);
			const copies = COPIES.map((copy, i) => {
				const height = heights[i] as number;
				return kitSvg(chartSvg(resolved, theme, copy.width, height), svgTag(copy, height), paintOf);
			});
			return copies.every((copy) => copy !== undefined) ? drawnCopies(copies) : "";
		}),
		plot: orNothing((option: Option, place: Place) => {
			const heights = heightsOf(place);
			if (!heights) {
				return "";
			}
			// Every series starts switched on; plot.js marks its buttons so as it draws.
			const legend = plots
				.legendMarkup(option)
				.replace(/<button /g, '<button aria-pressed="true" ');
			const shown = plots.switchedOn(option.series ?? [], new Set());
			const width = (s: unknown) => textWidth(String(s), PLOT_FONT, 500);
			const copies = COPIES.map((copy, i) => {
				const H = (heights[i] as number) - PLOT_LEGEND.padding - (legend ? PLOT_LEGEND.row : 0);
				return `${svgTag(copy, H)}${shorterPaths(plots.render(option, copy.width, H, width, shown))}</svg>`;
			});
			return `<ul class="plot-legend">${legend}</ul><div class="plot-area">${drawnCopies(copies)}</div>`;
		}),
	};
}
