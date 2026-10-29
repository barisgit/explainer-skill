/** The IC symbol: a box with named pins on its sides, sized by the names it holds. */
import type { Point } from "./geometry.ts";
import { DOWN, G, LEFT, RIGHT, type SymbolDef, type SymbolText, UP } from "./symbols.ts";
import { FONT, lineWidth } from "./text.ts";

/** An IC's pins per side, in order: left and right top to bottom, top and bottom left to right. */
export interface IcSides {
	left: string[];
	right: string[];
	top: string[];
	bottom: string[];
}

const PAD = 5;
const snapUp = (n: number) => Math.ceil(n / G) * G;

/** The width the top or bottom pins need: each name centred on its pin, a gap between neighbours. */
function rowWidth(names: string[]): { width: number; xs: number[] } {
	const xs: number[] = [];
	let x = 0;
	for (const name of names) {
		const w = snapUp(lineWidth(name, FONT) + 2 * PAD);
		xs.push(snapUp(x + w / 2));
		x = (xs.at(-1) ?? 0) + w / 2;
	}
	return { width: snapUp(x), xs };
}

/**
 * A box with pins on its sides, each a 10-unit stub ending on the grid, named inside the box. The box's top-left corner is the
 * origin; pins are 20 apart on the left and right, and spaced by their names on the top and bottom. `title` is the label to
 * keep room for between the left and right pin names.
 */
export function ic(sides: IcSides, title: string[] = []): SymbolDef {
	const widest = (names: string[]) => Math.max(0, ...names.map((n) => lineWidth(n, FONT)));
	const top = rowWidth(sides.top);
	const bottom = rowWidth(sides.bottom);
	const middle = title.length ? widest(title) + 2 * PAD : 2 * G;
	// Symmetric about the centre, so the title, centred on the box, falls in the column between the left and right names.
	const side = snapUp(2 * Math.max(widest(sides.left), widest(sides.right)) + 4 * PAD + middle);
	const width = Math.max(side, top.width + 2 * G, bottom.width + 2 * G);
	const rows = Math.max(sides.left.length, sides.right.length);
	const height = (rows + 1) * 2 * G + (sides.top.length ? G : 0) + (sides.bottom.length ? G : 0);
	const y0 = sides.top.length ? 3 * G : 2 * G;
	const def: SymbolDef = {
		pins: {},
		exits: {},
		stroke: `M0,0 H${width} V${height} H0 Z`,
		body: { x0: 0, y0: 0, x1: width, y1: height },
		texts: [],
	};
	const pin = (name: string, at: Point, exit: Point, text: SymbolText) => {
		def.pins[name] = at;
		def.exits[name] = exit;
		def.stroke += ` M${at.x - exit.x * G},${at.y - exit.y * G} L${at.x},${at.y}`;
		def.texts?.push(text);
	};
	const mid = FONT * 0.35;
	sides.left.forEach((name, i) => {
		const y = y0 + i * 2 * G;
		pin(name, { x: -G, y }, LEFT, { at: { x: PAD, y: y + mid }, text: name, anchor: "start" });
	});
	sides.right.forEach((name, i) => {
		const y = y0 + i * 2 * G;
		const at = { x: width - PAD, y: y + mid };
		pin(name, { x: width + G, y }, RIGHT, { at, text: name, anchor: "end" });
	});
	const offset = (row: { width: number }) => snapUp((width - row.width) / 2);
	sides.top.forEach((name, i) => {
		const x = offset(top) + (top.xs[i] ?? 0);
		pin(name, { x, y: -G }, UP, { at: { x, y: PAD + FONT }, text: name, anchor: "middle" });
	});
	sides.bottom.forEach((name, i) => {
		const x = offset(bottom) + (bottom.xs[i] ?? 0);
		const at = { x, y: height - PAD - 2 };
		pin(name, { x, y: height + G }, DOWN, { at, text: name, anchor: "middle" });
	});
	return def;
}
