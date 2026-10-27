/**
 * The netlist dialect: one part per line in SPICE's order (name, nodes, value), so a description reads as connections, not
 * coordinates. `@x,y` (grid units of 10) and an orientation place a part; without them the ELK layout places it.
 *
 *   R1 ref inp 2.2k          a resistor from net ref to net inp (C capacitor, L inductor, D diode, V source by first letter)
 *   Q1 vi drv e 2N3055       transistors take collector, base, emitter; write Q2 pnp ... for a PNP
 *   D2 zener k a             a keyword after the name picks the symbol: zener, opamp (- + out), port (one net)
 *   U1 ic "µA723" left REF=ref IN+=inp right OUTPUT=drv VZ  pins per side, name=net; a pin with no net is drawn unconnected
 *   VO port vo V_O           a terminal; its label is the value
 *   R2 inp 0 @4,12 v         net 0 is ground, drawn at each pin; v stands a two-terminal up (first node on top), h lays it flat
 *   Q1 vi drv e b@U1.OUTPUT 4,0   relative: Q1's base 4 grid units right of U1's OUTPUT pin; @U1.OUTPUT alone places the
 *                                 part's origin (a two-terminal's first pin, a transistor's base, an IC's top-left corner)
 */
import { add, type Orientation, type Point, UPRIGHT } from "./geometry.ts";
import { exitOf, type Part, pinAt, pinNamed, type Wire } from "./scene.ts";
import {
	FIXED,
	G,
	GROUND,
	type IcSides,
	ic,
	type SymbolDef,
	type TwoTerminal,
	twoTerminal,
} from "./symbols.ts";

/** A part as the netlist states it; `at` is in sheet units when the author placed it. */
export interface NetPart extends Part {
	nets: Record<string, string>;
	placed: boolean;
	/** A position relative to another part's pin, resolved once that part is placed. */
	relative?: Relative;
}

interface Relative {
	/** The part's own pin to put there; its origin when absent. */
	pin?: string;
	part: string;
	anchor: string;
	offset: Point;
}

export const GROUND_NETS = new Set(["0", "gnd", "GND"]);

const LETTERS: Record<string, TwoTerminal | "npn" | "ic"> = {
	R: "resistor",
	C: "capacitor",
	L: "inductor",
	D: "diode",
	V: "source",
	Q: "npn",
	U: "ic",
	X: "ic",
};
const KEYWORDS = new Set([
	"resistor",
	"capacitor",
	"inductor",
	"diode",
	"zener",
	"source",
	"npn",
	"pnp",
	"opamp",
	"port",
	"ic",
]);
const PIN_ORDER: Record<string, string[]> = {
	npn: ["c", "b", "e"],
	pnp: ["c", "b", "e"],
	opamp: ["-", "+", "out"],
	port: ["a"],
};
const SIDES = new Set(["left", "right", "top", "bottom"]);
const ORIENT: Record<string, Orientation> = {
	h: UPRIGHT,
	v: { rot: 90, flip: false },
	r90: { rot: 90, flip: false },
	r180: { rot: 180, flip: false },
	r270: { rot: 270, flip: false },
	flip: { rot: 0, flip: true },
};

/** Splits a line into words, keeping "quoted text" (and name="quoted"=net pairs) whole, quotes removed. */
export function words(line: string): string[] {
	return [...line.matchAll(/(?:"[^"]*"|[^\s"])+/g)].map((m) => m[0].replace(/"/g, ""));
}

/** The pins of an IC line: side keywords, each followed by name=net (or a bare name) words. */
function icPins(rest: string[]): { sides: IcSides; nets: Record<string, string>; other: string[] } {
	const sides: IcSides = { left: [], right: [], top: [], bottom: [] };
	const nets: Record<string, string> = {};
	const other: string[] = [];
	let side: keyof IcSides | undefined;
	for (const word of rest) {
		if (SIDES.has(word)) {
			side = word as keyof IcSides;
			continue;
		}
		if (!side) {
			other.push(word);
			continue;
		}
		const eq = word.lastIndexOf("=");
		const name = eq > 0 ? word.slice(0, eq) : word;
		sides[side].push(name);
		if (eq > 0) {
			nets[name] = word.slice(eq + 1);
		}
	}
	return { sides, nets, other };
}

const OFFSET = /^(-?[\d.]+),(-?[\d.]+)$/;

/** A `pin@Part.pin` word as a relative placement, with the `dx,dy` word after it if there is one (`offset`). */
function relativeOf(
	rel: RegExpExecArray,
	next: string | undefined,
): { relative: Relative; offset: boolean } {
	const offset = OFFSET.exec(next ?? "");
	const relative: Relative = {
		part: rel[2] ?? "",
		anchor: rel[3] ?? "",
		offset: { x: Number(offset?.[1] ?? 0) * G, y: Number(offset?.[2] ?? 0) * G },
		...(rel[1] ? { pin: rel[1] } : {}),
	};
	return { relative, offset: Boolean(offset) };
}

interface Placement {
	at?: Point;
	relative?: Relative;
	o: Orientation;
}

/** Reads one word (and the offset after a relative one) into `into`; returns how many words it took, 0 for a non-placement word. */
function takePlacement(word: string, next: string | undefined, into: Placement): number {
	const m = /^@(-?[\d.]+),(-?[\d.]+)$/.exec(word);
	if (m) {
		into.at = { x: Number(m[1]) * G, y: Number(m[2]) * G };
		return 1;
	}
	const rel = /^([^@]*)@([^.]+)\.(.+)$/.exec(word);
	if (rel) {
		const found = relativeOf(rel, next);
		into.relative = found.relative;
		return found.offset ? 2 : 1;
	}
	const turn = ORIENT[word];
	if (turn) {
		into.o = turn.flip ? { ...into.o, flip: true } : { ...turn, flip: into.o.flip };
		return 1;
	}
	return 0;
}

/** Pulls the placement words (@x,y or pin@Part.pin dx,dy, and an orientation) out of a line's words. */
function placement(tokens: string[]): Placement & { rest: string[] } {
	const found: Placement = { o: UPRIGHT };
	const rest: string[] = [];
	for (let i = 0; i < tokens.length; ) {
		const word = tokens[i] ?? "";
		const taken = takePlacement(word, tokens[i + 1], found);
		if (!taken) {
			rest.push(word);
		}
		i += taken || 1;
	}
	return { ...found, rest };
}

/** Where a relatively placed part goes once its anchor's part is placed; undefined while it is not, an error if it is wrong. */
function resolve(part: NetPart, rel: Relative, parts: NetPart[]): Point | string | undefined {
	const other = parts.find((p) => p.id === rel.part);
	if (!other) {
		return `${part.id}: no part ${rel.part} to place it by`;
	}
	if (!other.placed) {
		return undefined;
	}
	const anchorPin = pinNamed(other, rel.anchor);
	const ownPin = rel.pin === undefined ? undefined : pinNamed(part, rel.pin);
	if (!anchorPin || (rel.pin !== undefined && !ownPin)) {
		const [p, name] = anchorPin ? [part, rel.pin] : [other, rel.anchor];
		return `${p.id} has no pin ${name} (${Object.keys(p.def.pins).join(", ")})`;
	}
	const target = add(pinAt(other, anchorPin) ?? other.at, rel.offset);
	const own = ownPin
		? (pinAt({ ...part, at: { x: 0, y: 0 } }, ownPin) ?? { x: 0, y: 0 })
		: { x: 0, y: 0 };
	return { x: target.x - own.x, y: target.y - own.y };
}

/** Places relatively placed parts in dependency order; a part whose anchor never gets placed is an error. */
function placeRelative(parts: NetPart[], errors: string[]) {
	let pending = parts.filter((p) => p.relative);
	while (pending.length) {
		const before = pending.length;
		pending = pending.filter((part) => {
			const at = part.relative && resolve(part, part.relative, parts);
			if (typeof at === "string") {
				errors.push(at);
			}
			if (at && typeof at !== "string") {
				part.at = at;
				part.placed = true;
			}
			return at === undefined;
		});
		if (pending.length === before) {
			errors.push(`${pending.map((p) => p.id).join(", ")}: placed by parts that are never placed`);
			return;
		}
	}
}

/** The symbol and pin order of a kind. */
function symbolOf(
	kind: string,
	sides: IcSides | undefined,
	title: string[],
): { def: SymbolDef; order: string[] } {
	if (kind === "ic" && sides) {
		return { def: ic(sides, title), order: [] };
	}
	const fixed = FIXED[kind];
	if (fixed) {
		return { def: fixed, order: PIN_ORDER[kind] ?? [] };
	}
	return { def: twoTerminal(kind as TwoTerminal, 4 * G), order: ["a", "b"] };
}

/** A part's symbol, nets and value from the words after its placement; an IC names its pins, other parts list nodes in order. */
function wiringOf(
	id: string,
	kind: string,
	rest: string[],
): { def: SymbolDef; nets: Record<string, string>; value: string } | string {
	if (kind === "ic") {
		const pins = icPins(rest);
		const value = pins.other.join(" ");
		return { def: symbolOf(kind, pins.sides, [id, value]).def, nets: pins.nets, value };
	}
	const { def, order } = symbolOf(kind, undefined, []);
	const nodes = rest.slice(0, order.length);
	if (nodes.length < order.length) {
		return `${id}: a ${kind} needs ${order.length} nodes (${order.join(", ")})`;
	}
	const nets = Object.fromEntries(order.map((pin, i) => [pin, nodes[i] ?? ""]));
	return { def, nets, value: rest.slice(order.length).join(" ") };
}

const labelOf = (kind: string, id: string, value: string) =>
	kind === "port" ? [value || id] : value ? [id, value] : [id];

/** One part line as a part, or an error message for the author. */
function partOf(line: string): NetPart | string {
	const [id = "", ...after] = words(line);
	const explicit = after[0] && KEYWORDS.has(after[0]) ? after.shift() : undefined;
	const kind = explicit ?? LETTERS[id[0]?.toUpperCase() ?? ""];
	if (!kind) {
		return `${id}: name a part by its SPICE letter (R, C, L, D, Q, V, U) or write its kind after the name`;
	}
	const { at, relative, o, rest } = placement(after);
	const wiring = wiringOf(id, kind, rest);
	if (typeof wiring === "string") {
		return wiring;
	}
	const { def, nets, value } = wiring;
	const part: NetPart = {
		id,
		kind,
		def,
		at: at ?? { x: 0, y: 0 },
		o,
		label: labelOf(kind, id, value),
		nets,
		placed: at !== undefined,
	};
	return relative ? { ...part, relative } : part;
}

/** Parses a netlist body; every bad line is reported, not just the first. */
export function parseNetlist(lines: string[]): { parts: NetPart[]; errors: string[] } {
	const parts: NetPart[] = [];
	const errors: string[] = [];
	for (const line of lines
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#") && !l.startsWith("*"))) {
		const part = partOf(line);
		if (typeof part === "string") {
			errors.push(part);
		} else {
			parts.push(part);
		}
	}
	placeRelative(parts, errors);
	return { parts, errors };
}

/**
 * A ground symbol at every pin on net 0: right under a pin that leaves downwards, else at the end of a 10-unit stub. Grounds all
 * carry the data-ref gnd, so prose can light every one.
 */
export function groundsFor(parts: NetPart[]): { grounds: Part[]; wires: Wire[] } {
	const grounds: Part[] = [];
	const wires: Wire[] = [];
	for (const part of parts) {
		for (const [pin, net] of Object.entries(part.nets)) {
			const p = pinAt(part, pin);
			if (!p || !GROUND_NETS.has(net)) {
				continue;
			}
			const exit = exitOf(part, pin);
			const at = exit.y > 0 ? p : add(p, { x: exit.x * G, y: exit.y * G });
			if (at !== p) {
				wires.push({ net: "0", points: [p, at] });
			}
			grounds.push({ id: "gnd", kind: "ground", def: GROUND, at, o: UPRIGHT, label: [] });
		}
	}
	return { grounds, wires };
}

/** The nets to wire, each with its pins; ground is drawn at each pin instead (groundsFor). */
export const netsOf = (parts: NetPart[]) => {
	const nets = new Map<string, Array<{ part: NetPart; pin: string }>>();
	for (const part of parts) {
		for (const [pin, net] of Object.entries(part.nets)) {
			if (!GROUND_NETS.has(net)) {
				nets.set(net, [...(nets.get(net) ?? []), { part, pin }]);
			}
		}
	}
	return nets;
};
