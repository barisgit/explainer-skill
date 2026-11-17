/* plot.js's drawing code as pack runs it, and what the plot tests read from a drawing. */
import { runKitPart } from "../skills/explainer/src/kit.ts";

/** plot.js's drawing code as pack runs it (kit/parts/plot/draw.ts), measuring every character 7 px wide. */
export type PlotDrawing = {
	render(
		option: object,
		W: number,
		H: number,
		width: (s: unknown) => number,
		shown: boolean[],
		texts?: object,
	): string;
	legendMarkup(option: object, textWidth: (s: unknown) => number, H: number): string;
	markLines(option: object, W: number, H: number, width: (s: unknown) => number): number;
	crowded(): string[];
};
export const plotDrawAt = (size: number) =>
	(
		runKitPart("plot/draw.ts", "PlotDraw") as (env: {
			lang: () => string;
			size: () => number;
		}) => PlotDrawing
	)({
		lang: () => "en",
		size: () => size,
	});
export const plotDraw = plotDrawAt(13);
export const width = (s: unknown) => String(s).length * 7;
export const draw = (option: { series: object[]; [key: string]: unknown }, W = 600, H = 300) =>
	plotDraw.render(
		option,
		W,
		H,
		width,
		option.series.map(() => true),
	);
/** The lines a drawing has, by class, as [x1, x2, y1, y2]. */
export const lines = (svg: string, cls: string) =>
	[
		...svg.matchAll(
			new RegExp(`<line class="${cls}" x1="([^"]+)" x2="([^"]+)" y1="([^"]+)" y2="([^"]+)"`, "g"),
		),
	].map((m) => m.slice(1).map(Number));
/** The texts of a class with their x and y. */
export const texts = (svg: string, cls: string) =>
	[
		...svg.matchAll(new RegExp(`<text class="${cls}" x="([^"]+)" y="([^"]+)"[^>]*>([^<]*)<`, "g")),
	].map(([, x, y, text]) => ({ x: Number(x), y: Number(y), text }));
/** A rect's x, y, width and height by its class. */
export const rects = (svg: string, cls: string) =>
	[
		...svg.matchAll(
			new RegExp(
				`<rect class="${cls}"[^>]* x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
				"g",
			),
		),
	].map((m) => m.slice(1).map(Number));
