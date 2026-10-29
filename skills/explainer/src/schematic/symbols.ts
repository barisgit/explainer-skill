/**
 * The symbol library: each symbol drawn facing right in its own frame, with named pins on the 10-unit grid, the direction a wire
 * leaves each pin, and the body box wires and labels must stay out of. Paths are stroked in currentColor by render.ts. `KINDS`
 * says which symbols a netlist can name and in what order their nodes come.
 */
import type { Box, Point } from "./geometry.ts";

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
	/** Solid parts of the symbol (arrow heads), filled in the ink colour. */
	fill?: string;
	body: Box;
	/**
	 * What the symbol draws beside its body (a polarity sign over a lead): not conductive, but wires and parts stay out of it
	 * like the body.
	 */
	marks?: Box;
	texts?: SymbolText[];
}

export const LEFT = { x: -1, y: 0 };
export const RIGHT = { x: 1, y: 0 };
export const UP = { x: 0, y: -1 };
export const DOWN = { x: 0, y: 1 };
const NONE = { x: 0, y: 0 };

/** A two-terminal body between its leads: `len` long on the axis, `y0` to `y1` across it; the path starts at x = 0. */
interface Body {
	len: number;
	y0: number;
	y1: number;
	stroke: string;
	fill?: string;
	/** The box of the marks, relative to the path's start like the stroke. */
	marks?: Box;
}

const CIRCLE = (r: number) => `M0,0 a${r},${r} 0 1 1 ${2 * r},0 a${r},${r} 0 1 1 ${-2 * r},0`;

/** The plus sign that marks pin a of a polarised part, over its lead, as a box clear of the strokes. */
const PLUS: Box = { x0: -10, y0: -11.5, x1: -3, y1: -4.5 };

/** The two-terminal bodies, pin a on the left and pin b on the right (the first and second node of a netlist line). */
const BODIES = {
	resistor: {
		len: 30,
		y0: -5,
		y1: 5,
		stroke: "M0,0 L2.5,-5 L7.5,5 L12.5,-5 L17.5,5 L22.5,-5 L27.5,5 L30,0",
	},
	capacitor: { len: 6, y0: -9, y1: 9, stroke: "M0,-9 V9 M6,-9 V9" },
	// The curved plate is the negative one, b; the plus sign marks a.
	electrolytic: {
		len: 8,
		y0: -9,
		y1: 9,
		stroke: "M0,-9 V9 M8,-9 Q4,0 8,9 M-9,-8 h5 M-6.5,-10.5 v5",
		marks: PLUS,
	},
	inductor: {
		len: 30,
		y0: -5,
		y1: 5,
		stroke:
			"M0,0 a3.75,3.75 0 0 1 7.5,0 a3.75,3.75 0 0 1 7.5,0 a3.75,3.75 0 0 1 7.5,0 a3.75,3.75 0 0 1 7.5,0",
	},
	// A diode conducts from its anode a to its cathode b.
	diode: { len: 12, y0: -7, y1: 7, stroke: "M0,-7 V7 L12,0 Z M12,-7 V7" },
	zener: { len: 12, y0: -9, y1: 9, stroke: "M0,-7 V7 L12,0 Z M9,-9 L12,-7 V7 L15,9" },
	led: {
		len: 12,
		y0: -15,
		y1: 7,
		stroke:
			"M0,-7 V7 L12,0 Z M12,-7 V7 M1,-9 L7,-15 M7,-15 H3 M7,-15 V-11 M6,-9 L12,-15 M12,-15 H8 M12,-15 V-11",
	},
	switch: {
		len: 30,
		y0: -11,
		y1: 3,
		stroke: `M5,0 a2,2 0 1 1 -4,0 a2,2 0 1 1 4,0 M29,0 a2,2 0 1 1 -4,0 a2,2 0 1 1 4,0 M4.6,-1.4 L26,-10`,
	},
	// Two cells; the long plate is positive, a.
	battery: {
		len: 15,
		y0: -9,
		y1: 9,
		stroke: "M0,-9 V9 M5,-5 V5 M10,-9 V9 M15,-5 V5 M-9,-8 h5 M-6.5,-10.5 v5",
		marks: PLUS,
	},
	// A voltage source: plus at a, minus at b.
	vsource: { len: 24, y0: -12, y1: 12, stroke: `${CIRCLE(12)} M5,0 h5 M7.5,-2.5 v5 M15,0 h5` },
	// A current source: the arrow shows the current from a through the source to b.
	isource: {
		len: 24,
		y0: -12,
		y1: 12,
		stroke: `${CIRCLE(12)} M5,0 H19 M19,0 L14.5,-3.5 M19,0 L14.5,3.5`,
	},
} satisfies Record<string, Body>;

/** Moves an absolute path (M, L, H, V and Q with absolute coordinates; relative commands stay) `dx` along x. */
function translatePath(d: string, dx: number): string {
	return d.replace(
		/([MLHVQ])(-?[\d.]+)(?:,(-?[\d.]+))?(?: (-?[\d.]+),(-?[\d.]+))?/g,
		(_, cmd: string, a: string, b?: string, c?: string, e?: string) => {
			if (cmd === "V") {
				return `V${a}`;
			}
			const x = Number(a) + dx;
			if (cmd === "Q" && c !== undefined && e !== undefined) {
				return `Q${x},${b} ${Number(c) + dx},${e}`;
			}
			return b === undefined ? `${cmd}${x}` : `${cmd}${x},${b}`;
		},
	);
}

const LEN = 4 * G;

/** A two-terminal symbol 40 long between its pins a (left) and b (right), its body centred with leads to each pin. */
function twoTerminal(body: Body, extra: Partial<SymbolDef> = {}): SymbolDef {
	const start = (LEN - body.len) / 2;
	const leads = `M0,0 H${start} M${start + body.len},0 H${LEN}`;
	return {
		pins: { a: { x: 0, y: 0 }, b: { x: LEN, y: 0 } },
		exits: { a: LEFT, b: RIGHT },
		stroke: `${leads} ${translatePath(body.stroke, start)}`,
		...(body.fill ? { fill: translatePath(body.fill, start) } : {}),
		body: { x0: start, y0: body.y0, x1: start + body.len, y1: body.y1 },
		...(body.marks
			? { marks: { ...body.marks, x0: body.marks.x0 + start, x1: body.marks.x1 + start } }
			: {}),
		...extra,
	};
}

/** A potentiometer: a resistor with its wiper w on a grid point 20 above the middle, an arrow into the track. */
const POTENTIOMETER = (() => {
	const track = twoTerminal(BODIES.resistor);
	return {
		...track,
		pins: { ...track.pins, w: { x: 20, y: -20 } },
		exits: { ...track.exits, w: UP },
		stroke: `${track.stroke} M20,-20 V-7`,
		fill: "M20,-6 L17.5,-12 H22.5 Z",
	};
})();

/** A transistor with three pins; `top` and `bottom` name the pins on its upper and lower terminals, `base` the one on the left. */
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
	};
}

/**
 * An enhancement MOSFET with its body tied to the source: gate g on the left, drain d and source s on the right, the source on
 * the bottom for an N channel and on top for a P channel; the body arrow points into the channel for N, out for P.
 */
function mosfet(p: boolean): SymbolDef {
	const [top, bottom] = p ? ["s", "d"] : ["d", "s"];
	const arrow = p ? "M18,0 L13,-3 V3 Z" : "M12,0 L17,-3 V3 Z";
	const tie = p ? "M20,0 V-11" : "M20,0 V11";
	return {
		pins: { g: { x: 0, y: 0 }, [top]: { x: 20, y: -20 }, [bottom]: { x: 20, y: 20 } },
		exits: { g: LEFT, [top]: UP, [bottom]: DOWN },
		stroke: `M0,0 H6 M6,-9 V9 M10,-14 V-8 M10,-3 V3 M10,8 V14 M10,-11 H20 V-20 M10,11 H20 V20 M10,0 H20 ${tie}`,
		fill: arrow,
		body: { x0: 6, y0: -14, x1: 20, y1: 14 },
	};
}

/** The earth symbol a net 0 pin ends in; the pin is the top of its stem. */
export const GROUND: SymbolDef = {
	pins: { a: { x: 0, y: 0 } },
	exits: { a: UP },
	stroke: "M0,0 V6 M-8,6 H8 M-5,9.5 H5 M-2,13 H2",
	body: { x0: -8, y0: 2, x1: 8, y1: 13 },
};

/** A terminal: an open circle a wire ends in, named by its label. */
const PORT: SymbolDef = {
	pins: { a: { x: 0, y: 0 } },
	exits: { a: NONE },
	stroke: "M2.5,0 a2.5,2.5 0 1 1 -5,0 a2.5,2.5 0 1 1 5,0",
	body: { x0: -3, y0: -3, x1: 3, y1: 3 },
};

/** A positive supply rail: a bar on a stem that the wire reaches from below. */
const VDD: SymbolDef = {
	pins: { a: { x: 0, y: 0 } },
	exits: { a: DOWN },
	stroke: "M0,0 V-10 M-8,-10 H8",
	body: { x0: -8, y0: -11, x1: 8, y1: 0 },
};

/** A negative supply rail: a bar on a stem that the wire reaches from above. */
const VSS: SymbolDef = {
	pins: { a: { x: 0, y: 0 } },
	exits: { a: UP },
	stroke: "M0,0 V10 M-8,10 H8",
	body: { x0: -8, y0: 0, x1: 8, y1: 11 },
};

const OPAMP: SymbolDef = {
	pins: { "-": { x: 0, y: -10 }, "+": { x: 0, y: 10 }, out: { x: 50, y: 0 } },
	exits: { "-": LEFT, "+": LEFT, out: RIGHT },
	stroke: "M0,-10 H8 M0,10 H8 M8,-22 V22 L44,0 Z M44,0 H50 M12,-10 h6 M12,10 h6 M15,7 v6",
	body: { x0: 8, y0: -22, x1: 44, y1: 22 },
};

/** A symbol a netlist line can name, and its nodes in the order the line lists them. */
export interface Kind {
	def: SymbolDef;
	nodes: string[];
}

/** Every kind but the IC, by the keyword authors write. */
export const KINDS: Record<string, Kind> = {
	...Object.fromEntries(
		Object.entries(BODIES).map(([name, body]) => [
			name,
			{ def: twoTerminal(body), nodes: ["a", "b"] },
		]),
	),
	potentiometer: { def: POTENTIOMETER, nodes: ["a", "b", "w"] },
	npn: { def: bjt(false), nodes: ["c", "b", "e"] },
	pnp: { def: bjt(true), nodes: ["c", "b", "e"] },
	nmos: { def: mosfet(false), nodes: ["d", "g", "s"] },
	pmos: { def: mosfet(true), nodes: ["d", "g", "s"] },
	opamp: { def: OPAMP, nodes: ["-", "+", "out"] },
	port: { def: PORT, nodes: ["a"] },
	vdd: { def: VDD, nodes: ["a"] },
	vss: { def: VSS, nodes: ["a"] },
};

/** The kind a part named with this first letter is, as SPICE reads it (an IC is U or X). */
export const LETTERS: Record<string, string> = {
	R: "resistor",
	C: "capacitor",
	L: "inductor",
	D: "diode",
	V: "vsource",
	I: "isource",
	Q: "npn",
	M: "nmos",
	U: "ic",
	X: "ic",
};
