/**
 * The symbol library: each symbol drawn facing right in its own frame, with named pins on the 10-unit grid, the direction a wire
 * leaves each pin, and the body box wires and labels must stay out of. Paths are stroked or filled in currentColor by render.ts.
 */
import type { Box, Point } from "./geometry.ts";
import { FONT, lineWidth } from "./text.ts";

/** The grid every pin sits on. */
export const G = 10;

/** Text a symbol carries inside itself (an IC's pin names); only upright symbols carry any. */
export interface SymbolText {
	at: Point;
	text: string;
	anchor: "start" | "middle" | "end";
}

export interface SymbolDef {
	pins: Record<string, Point>;
	/** The unit direction a wire leaves each pin in. */
	exits: Record<string, Point>;
	stroke: string;
	fill?: string;
	body: Box;
	texts?: SymbolText[];
	/** Whether the symbol may be turned (an IC's pin names would turn with it, a ground would point the wrong way). */
	turns: boolean;
}

const LEFT = { x: -1, y: 0 };
const RIGHT = { x: 1, y: 0 };
const UP = { x: 0, y: -1 };
const DOWN = { x: 0, y: 1 };

/** The two-terminal bodies: drawn from x = 0 to `len` on the axis, `half` wide on each side. */
const BODIES = {
	resistor: {
		len: 30,
		half: 5,
		stroke: "M0,0 L2.5,-5 L7.5,5 L12.5,-5 L17.5,5 L22.5,-5 L27.5,5 L30,0",
	},
	capacitor: { len: 6, half: 9, stroke: "M0,-9 V9 M6,-9 V9" },
	inductor: {
		len: 30,
		half: 5,
		stroke:
			"M0,0 a3.75,3.75 0 0 1 7.5,0 a3.75,3.75 0 0 1 7.5,0 a3.75,3.75 0 0 1 7.5,0 a3.75,3.75 0 0 1 7.5,0",
	},
	diode: { len: 12, half: 7, stroke: "M0,-7 V7 L12,0 Z M12,-7 V7" },
	zener: { len: 12, half: 7, stroke: "M0,-7 V7 L12,0 Z M9,-9 L12,-7 V7 L15,9" },
	source: {
		len: 24,
		half: 12,
		stroke: "M0,0 a12,12 0 1 1 24,0 a12,12 0 1 1 -24,0 M5,0 h5 M7.5,-2.5 v5 M15,0 h5",
	},
} as const;

export type TwoTerminal = keyof typeof BODIES;
export const TWO_TERMINALS = Object.keys(BODIES) as TwoTerminal[];

/** A two-terminal symbol `len` long between its pins a (left) and b (right), its body centred with leads to each pin. */
export function twoTerminal(kind: TwoTerminal, len: number): SymbolDef {
	const body = BODIES[kind];
	const start = (len - body.len) / 2;
	const leads = `M0,0 H${start} M${start + body.len},0 H${len}`;
	return {
		pins: { a: { x: 0, y: 0 }, b: { x: len, y: 0 } },
		exits: { a: LEFT, b: RIGHT },
		stroke: `${leads} ${translatePath(body.stroke, start)}`,
		body: { x0: start, y0: -body.half, x1: start + body.len, y1: body.half },
		turns: true,
	};
}

/** Moves an absolute path (M, L, H, V, Z and relative arcs) `dx` along x. */
function translatePath(d: string, dx: number): string {
	return d.replace(/([MLHV])([-\d.]+)(?:,([-\d.]+))?/g, (_, cmd: string, a: string, b?: string) => {
		if (cmd === "V") {
			return `V${a}`;
		}
		const x = Number(a) + dx;
		return b === undefined ? `${cmd}${x}` : `${cmd}${x},${b}`;
	});
}

/** NPN and PNP: base at the origin, collector and emitter 20 up and down; the PNP's emitter is on top. */
function bjt(pnp: boolean): SymbolDef {
	const [top, bottom] = pnp ? ["e", "c"] : ["c", "e"];
	// The emitter arrow points out of the bar for NPN, into it for PNP.
	const arrow = pnp ? "M10,-6 L15.5,-6.6 L13,-10.5 Z" : "M20,13.5 L14.3,13.2 L16.6,9.3 Z";
	return {
		pins: { b: { x: 0, y: 0 }, [top]: { x: 20, y: -20 }, [bottom]: { x: 20, y: 20 } },
		exits: { b: LEFT, [top]: UP, [bottom]: DOWN },
		stroke:
			"M0,0 H8 M8,-8 V8 M8,-4 L20,-12 V-20 M8,4 L20,12 V20 M24,0 a11.5,11.5 0 1 1 -23,0 a11.5,11.5 0 1 1 23,0",
		fill: arrow,
		body: { x0: 1, y0: -12, x1: 24, y1: 12 },
		turns: true,
	};
}

/** True for a two-terminal symbol (pins a and b), which a part may lay along either axis. */
export function hasTwoPins(def: SymbolDef): boolean {
	return "a" in def.pins && "b" in def.pins;
}

export const GROUND: SymbolDef = {
	pins: { a: { x: 0, y: 0 } },
	exits: { a: UP },
	stroke: "M0,0 V6 M-8,6 H8 M-5,9.5 H5 M-2,13 H2",
	body: { x0: -8, y0: 2, x1: 8, y1: 13 },
	turns: false,
};

/** A terminal: an open circle a wire ends in, named by its label. */
const PORT: SymbolDef = {
	pins: { a: { x: 0, y: 0 } },
	exits: { a: { x: 0, y: 0 } },
	stroke: "M2.5,0 a2.5,2.5 0 1 1 -5,0 a2.5,2.5 0 1 1 5,0",
	body: { x0: -3, y0: -3, x1: 3, y1: 3 },
	turns: false,
};

const OPAMP: SymbolDef = {
	pins: { "-": { x: 0, y: -10 }, "+": { x: 0, y: 10 }, out: { x: 50, y: 0 } },
	exits: { "-": LEFT, "+": LEFT, out: RIGHT },
	stroke: "M0,-10 H8 M0,10 H8 M8,-22 V22 L44,0 Z M44,0 H50 M12,-10 h6 M12,10 h6 M15,7 v6",
	body: { x0: 8, y0: -22, x1: 44, y1: 22 },
	turns: true,
};

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
		turns: false,
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

/** Symbols that take no shape parameters, by the keyword authors write. */
export const FIXED: Record<string, SymbolDef> = {
	npn: bjt(false),
	pnp: bjt(true),
	ground: GROUND,
	port: PORT,
	opamp: OPAMP,
};
