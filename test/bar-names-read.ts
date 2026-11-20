/* What the bar and stem name tests read from a drawing: names, values, bars and stems as boxes at 7 px a character. */
import { lines, width } from "./plot-draw.ts";

export const SIZES = [
	[1054, 416],
	[527, 416],
	[356, 288],
] as const;

export type Box = { x0: number; x1: number; y0: number; y1: number };
export const LINE = 13;

/** The texts of a drawing that are names (class end), each with its box at 7 px a character and the label line's height. */
export function names(svg: string) {
	return [
		...svg.matchAll(
			/<text class="end( inside)?" x="([^"]+)" y="([^"]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)</g,
		),
	].map(([, inside, x = "0", y = "0", anchor, text = ""]) => {
		const w = width(text);
		const x0 =
			anchor === "end" ? Number(x) - w : anchor === "middle" ? Number(x) - w / 2 : Number(x);
		const box = { x0, x1: x0 + w, y0: Number(y) - LINE / 2, y1: Number(y) + LINE / 2 };
		return { text, box, inside: Boolean(inside) };
	});
}
/** The value labels' boxes. */
export const values = (svg: string) =>
	[
		...svg.matchAll(
			/<text class="value[^"]*" x="([^"]+)" y="([^"]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)</g,
		),
	].map(([, x = "0", y = "0", anchor, text = ""]) => {
		const w = width(text);
		const x0 =
			anchor === "end" ? Number(x) - w : anchor === "middle" ? Number(x) - w / 2 : Number(x);
		return { x0, x1: x0 + w, y0: Number(y) - LINE / 2, y1: Number(y) + LINE / 2 };
	});
/** Each bar's box and the category and series its title names. */
export const bars = (svg: string) =>
	[
		...svg.matchAll(
			/<rect class="bar[^"]*"[^>]* x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"><title>([^<]*?) · ([^:<]+):/g,
		),
	].map(([, x = "0", y = "0", w = "0", h = "0", category = "", series = ""]) => ({
		category,
		series,
		box: { x0: Number(x), x1: Number(x) + Number(w), y0: Number(y), y1: Number(y) + Number(h) },
	}));
/** Each stem's line, as a box, with the series' index in the drawing's order of stems. */
export const stems = (svg: string) => lines(svg, "stem");

export const overlap = (a: Box, b: Box) =>
	a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
export const within = (a: Box, b: Box) =>
	a.x0 >= b.x0 - 0.5 && a.x1 <= b.x1 + 0.5 && a.y0 >= b.y0 - 0.5 && a.y1 <= b.y1 + 0.5;
/** px from a point to a box, 0 inside it. */
export const toBox = ([x, y]: [number, number], b: Box) =>
	Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
export const middle = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
export const hull = (boxes: Box[]): Box => ({
	x0: Math.min(...boxes.map((b) => b.x0)),
	x1: Math.max(...boxes.map((b) => b.x1)),
	y0: Math.min(...boxes.map((b) => b.y0)),
	y1: Math.max(...boxes.map((b) => b.y1)),
});
