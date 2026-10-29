/**
 * A laid-out schematic: parts placed on the sheet and wires as orthogonal polylines, each on a net. place.ts and route.ts make
 * one from a netlist; labels.ts, check.ts and render.ts take it from there.
 */
import {
	add,
	type Box,
	boxOf,
	grow,
	type Orientation,
	orient,
	type Point,
	placeBox,
	type Segment,
	segmentsOf,
	union,
} from "./geometry.ts";
import type { SymbolDef } from "./symbols.ts";

export interface Part {
	/** The author's name for the part (R1, Q1, U1), which the SVG carries as its data-ref. */
	id: string;
	kind: string;
	def: SymbolDef;
	at: Point;
	o: Orientation;
	/** Label lines: the name as the reader sees it, then the value; empty for a symbol that needs none (a ground). */
	label: string[];
	/** Pin name to net name, as the netlist line gives them. */
	nets: Record<string, string>;
	/** The line of the block's source the part came from, which problems name. */
	line: number;
}

export interface Wire {
	net: string;
	points: Point[];
}

export interface Scene {
	parts: Part[];
	wires: Wire[];
}

/** A pin name as authors may write it: without subscript marks, quotes or spaces, any case, − as -. */
const plain = (name: string) =>
	name
		.replace(/[_{}\s"]/g, "")
		.replace(/−/g, "-")
		.toLowerCase();

/** The names a two-terminal part's pins answer to besides a and b, as Schemdraw and CircuiTikZ name them. */
const ALIASES: Record<string, string> = {
	start: "a",
	end: "b",
	"1": "a",
	"2": "b",
	anode: "a",
	cathode: "b",
};

/** The pin of `part` an author's name means (`U1.CURRLIM` for "CURR LIM", `R1.end` for b), if any. */
export function pinNamed(part: Part, name: string): string | undefined {
	const pins = Object.keys(part.def.pins);
	const want = plain(name);
	const exact = pins.find((pin) => plain(pin) === want);
	const alias = ALIASES[want];
	return exact ?? (alias && pins.includes(alias) ? alias : undefined);
}

export const pinAt = (part: Part, pin: string): Point | undefined => {
	const local = part.def.pins[pin];
	return local && add(orient(local, part.o), part.at);
};

/** Every pin of a part on the sheet, with its name. */
export const pinsOf = (part: Part) =>
	Object.keys(part.def.pins).flatMap((pin) => {
		const at = pinAt(part, pin);
		return at ? [{ pin, at }] : [];
	});

/** The unit direction a wire leaves `pin` in, on the sheet. */
export const exitOf = (part: Part, pin: string): Point =>
	orient(part.def.exits[pin] ?? { x: 0, y: 0 }, part.o);

export const bodyOf = (part: Part): Box => placeBox(part.def.body, part.o, part.at);

/** Everything a part draws: its body and the leads out to its pins. */
export const extentOf = (part: Part): Box =>
	union([bodyOf(part), boxOf(pinsOf(part).map((p) => p.at))]);

/** A part's leads: from each pin in to its body, which wires of other nets must not touch either. */
export function leadsOf(part: Part): Segment[] {
	const body = grow(bodyOf(part), -0.5);
	return pinsOf(part).flatMap(({ pin, at }) => {
		const exit = exitOf(part, pin);
		if (exit.x === 0 && exit.y === 0) {
			return [];
		}
		const toBody = exit.x
			? { x: exit.x > 0 ? body.x1 : body.x0, y: at.y }
			: { x: at.x, y: exit.y > 0 ? body.y1 : body.y0 };
		return segmentsOf([at, toBody]);
	});
}

export const wireSegments = (scene: Scene) =>
	scene.wires.flatMap((w) => segmentsOf(w.points).map((s) => ({ ...s, net: w.net })));
