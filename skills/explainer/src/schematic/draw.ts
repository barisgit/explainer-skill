/**
 * The drawing dialect, after Schemdraw: one element per line, each starting where the last one ended unless `at` moves it, going
 * in a direction for a length or until it reaches an anchor. The author lays out the drawing; the geometry is the netlist.
 *
 *   U1: ic µA723 left REF IN+ right OUTPUT VZ     an IC, pins per side; its anchors are U1.REF, U1.OUTPUT, ...
 *   line up 2 at U1.VCC+                         a wire 2 grid units (20) up from a pin
 *   R1: resistor down at U1.REF value 2.2k       a part 4 units long; R1.start / R1.end are its ends
 *   line right tox Q1.c                          go right until under Q1's collector; toy goes up or down to a y
 *   line to U1.VC                                an L-shaped wire to an anchor, first leg in the direction given
 *   Q1: npn anchor b value 2N3055                a multi-pin part placed by one of its pins (b, c, e)
 *   ground   |   VO: port label V_O              ground and terminals hang off the current point
 *   push / pop                                   save and return to the current point
 *
 * Contacts are explicit: a point where two elements meet must be the start of one of them or the end of a `to`, `tox` or `toy`.
 * Anything else touching is reported, so a part that lands on a neighbouring wire fails instead of silently joining it.
 */
import { add, key, type Orientation, type Point, same, UPRIGHT } from "./geometry.ts";
import { words } from "./netlist.ts";
import { exitOf, type Part, pinAt, pinNamed, type Scene, type Wire } from "./scene.ts";
import {
	FIXED,
	G,
	type IcSides,
	ic,
	TWO_TERMINALS,
	type TwoTerminal,
	twoTerminal,
} from "./symbols.ts";

const DIRECTIONS: Record<string, Point> = {
	right: { x: 1, y: 0 },
	left: { x: -1, y: 0 },
	up: { x: 0, y: -1 },
	down: { x: 0, y: 1 },
};
const ROT: Record<string, Orientation["rot"]> = { right: 0, down: 90, left: 180, up: 270 };
const SIDES = new Set(["left", "right", "top", "bottom"]);

/** One element's line as named options: the first word after the kind may be a direction and then a length. */
interface Element {
	id?: string;
	kind: string;
	dir?: string;
	len?: number;
	at?: string;
	to?: string;
	tox?: string;
	toy?: string;
	anchor?: string;
	label?: string;
	value?: string;
	flip: boolean;
	reverse: boolean;
	sides?: IcSides;
}

const OPTION_WORDS = new Set(["at", "to", "tox", "toy", "anchor", "label", "value"]);

/** Reads one option word (and the value after a named option) into `el`; returns how many words it took. */
function takeOption(el: Element, word: string, next: string | undefined): number {
	if (OPTION_WORDS.has(word)) {
		el[word as "at"] = next ?? "";
		return 2;
	}
	if (DIRECTIONS[word]) {
		el.dir = word;
	} else if (/^[\d.]+$/.test(word)) {
		el.len = Number(word);
	} else if (word === "flip" || word === "reverse") {
		el[word] = true;
	} else if (el.kind === "ic") {
		// An IC's bare word is its type, shown under its name.
		el.value = word;
	}
	return 1;
}

/** An IC's pins by side, from the words that start at its first side keyword. */
function sidesOf(tokens: string[]): IcSides {
	const sides: IcSides = { left: [], right: [], top: [], bottom: [] };
	let side: keyof IcSides = "left";
	for (const word of tokens) {
		if (SIDES.has(word)) {
			side = word as keyof IcSides;
		} else {
			sides[side].push(word);
		}
	}
	return sides;
}

/** Splits `ID: kind ...` into its options; an IC's pin lists follow its options. */
function elementOf(line: string): Element {
	const all = words(line);
	const id = all[0]?.endsWith(":") ? all.shift()?.slice(0, -1) : undefined;
	const kind = all.shift() ?? "";
	const el: Element = { kind, flip: false, reverse: false, ...(id ? { id } : {}) };
	const sideStart = kind === "ic" ? all.findIndex((w) => SIDES.has(w)) : -1;
	const options = sideStart < 0 ? all : all.slice(0, sideStart);
	for (let i = 0; i < options.length; ) {
		i += takeOption(el, options[i] ?? "", options[i + 1]);
	}
	return sideStart < 0 ? el : { ...el, sides: sidesOf(all.slice(sideStart)) };
}

/** The drawing so far: placed parts and wires, the cursor, and the points where the author meant elements to meet. */
class Sheet {
	readonly parts: Part[] = [];
	readonly wires: Wire[] = [];
	readonly meant: Point[] = [];
	readonly errors: string[] = [];
	cursor: Point = { x: 0, y: 0 };
	dir = "right";
	private readonly stack: Point[] = [];
	private lines = 0;

	/** An anchor: `ID.pin`, `ID` (its end), or grid coordinates `x,y`. */
	anchor(name: string): Point | undefined {
		const xy = /^(-?[\d.]+),(-?[\d.]+)$/.exec(name);
		if (xy) {
			return { x: Number(xy[1]) * G, y: Number(xy[2]) * G };
		}
		const [id, pin = "end"] = name.split(/\.(.*)/s);
		const part = this.parts.find((p) => p.id === id);
		const wire = this.wires.find((w) => w.net === id);
		if (wire) {
			return pin === "start" ? wire.points[0] : wire.points.at(-1);
		}
		const named = part && pinNamed(part, pin);
		return part && named ? pinAt(part, named) : undefined;
	}

	need(name: string, line: number): Point {
		const p = this.anchor(name);
		if (!p) {
			this.errors.push(`line ${line}: no anchor ${name}`);
		}
		return p ?? this.cursor;
	}

	push() {
		this.stack.push(this.cursor);
	}
	pop() {
		this.cursor = this.stack.pop() ?? this.cursor;
	}
	wireName(id: string | undefined) {
		this.lines++;
		return id ?? `line ${this.lines}`;
	}
}

/** Where a straight element from `start` going `dir` ends: its length, or until it reaches the x or y of an anchor. */
function endOf(
	sheet: Sheet,
	el: Element,
	start: Point,
	dir: Point,
	n: number,
	standard: number,
): Point {
	if (el.tox) {
		return { x: sheet.need(el.tox, n).x, y: start.y };
	}
	if (el.toy) {
		return { x: start.x, y: sheet.need(el.toy, n).y };
	}
	if (el.to) {
		return sheet.need(el.to, n);
	}
	const len = (el.len ?? standard) * G;
	return add(start, { x: dir.x * len, y: dir.y * len });
}

function drawLine(sheet: Sheet, el: Element, start: Point, n: number) {
	const dir = DIRECTIONS[el.dir ?? sheet.dir] ?? { x: 1, y: 0 };
	const end = endOf(sheet, el, start, dir, n, 2);
	const firstAlongX = el.dir ? dir.x !== 0 : true;
	const corner = firstAlongX ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
	const points = same(corner, start) || same(corner, end) ? [start, end] : [start, corner, end];
	sheet.wires.push({ net: sheet.wireName(el.id), points });
	sheet.cursor = end;
}

function drawTwoTerminal(sheet: Sheet, el: Element, start: Point, n: number) {
	const dirName = el.dir ?? sheet.dir;
	const dir = DIRECTIONS[dirName] ?? { x: 1, y: 0 };
	const end = endOf(sheet, el, start, dir, n, 4);
	const len = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
	if (end.x !== start.x && end.y !== start.y) {
		sheet.errors.push(
			`line ${n}: ${el.id ?? el.kind} must run straight to ${el.to}; draw a line to line it up first`,
		);
	}
	const toward = directionOf({ x: end.x - start.x, y: end.y - start.y }) ?? dirName;
	const o: Orientation = { rot: ROT[el.reverse ? opposite(toward) : toward] ?? 0, flip: false };
	const def = twoTerminal(el.kind as TwoTerminal, len || 4 * G);
	const at = el.reverse ? end : start;
	sheet.parts.push({
		id: el.id ?? `${el.kind}${n}`,
		kind: el.kind,
		def,
		at,
		o,
		label: labelOf(el),
	});
	sheet.cursor = end;
	sheet.dir = toward;
}

/** The direction name of a move along one axis (its sign is what counts); undefined for none. */
function directionOf(move: Point): string | undefined {
	const unit = { x: Math.sign(move.x), y: Math.sign(move.y) };
	return Object.keys(DIRECTIONS).find(
		(d) => DIRECTIONS[d]?.x === unit.x && DIRECTIONS[d]?.y === unit.y,
	);
}

/** A fixed part's label: a port shows its name, a ground none, others their id and value. */
const fixedLabel = (el: Element) =>
	el.kind === "port" ? [el.label ?? el.id ?? ""] : el.kind === "ground" ? [] : labelOf(el);

const opposite = (d: string) => ({ right: "left", left: "right", up: "down", down: "up" })[d] ?? d;

const labelOf = (el: Element) => {
	const name = el.label ?? el.id;
	return [name, el.value].filter((t): t is string => Boolean(t));
};

/** A part with fixed pins, placed so its anchor pin (default: its first) sits on the cursor. */
function drawFixed(sheet: Sheet, el: Element, start: Point, n: number) {
	const def = el.kind === "ic" && el.sides ? ic(el.sides, labelOf(el)) : FIXED[el.kind];
	if (!def) {
		sheet.errors.push(`line ${n}: no element ${el.kind}`);
		return;
	}
	const o: Orientation = el.flip ? { rot: 0, flip: true } : UPRIGHT;
	const probe: Part = { id: "", kind: el.kind, def, at: { x: 0, y: 0 }, o, label: [] };
	const pin = el.anchor ? pinNamed(probe, el.anchor) : Object.keys(def.pins)[0];
	const offset = pin && pinAt(probe, pin);
	if (!(pin && offset)) {
		sheet.errors.push(
			`line ${n}: ${el.kind} has no pin ${el.anchor} (${Object.keys(def.pins).join(", ")})`,
		);
		return;
	}
	const part: Part = {
		id: el.id ?? (el.kind === "ground" ? "gnd" : `${el.kind}${n}`),
		kind: el.kind,
		def,
		at: { x: start.x - offset.x, y: start.y - offset.y },
		o,
		label: fixedLabel(el),
	};
	sheet.parts.push(part);
	// The next element continues the way the anchor pin's wire leaves the part.
	sheet.dir = directionOf(exitOf(part, pin)) ?? sheet.dir;
}

/** Runs one line: moves the cursor if `at` says so, records the start as a meant contact, and draws. */
function step(sheet: Sheet, line: string, n: number) {
	const el = elementOf(line);
	if (el.kind === "push" || el.kind === "pop") {
		sheet[el.kind]();
		return;
	}
	const start = el.at ? sheet.need(el.at, n) : sheet.cursor;
	sheet.meant.push(start);
	if (el.to) {
		sheet.meant.push(sheet.need(el.to, n));
	}
	if (el.kind === "dot") {
		sheet.cursor = start;
	} else if (el.kind === "line") {
		drawLine(sheet, el, start, n);
	} else if ((TWO_TERMINALS as string[]).includes(el.kind)) {
		drawTwoTerminal(sheet, el, start, n);
	} else {
		drawFixed(sheet, el, start, n);
	}
	if (el.tox || el.toy) {
		sheet.meant.push(sheet.cursor);
	}
}

/** Parses and draws a drawing body; `meant` lists the points where the author joined elements on purpose. */
export function drawScene(lines: string[]): { scene: Scene; meant: Point[]; errors: string[] } {
	const sheet = new Sheet();
	lines.forEach((line, i) => {
		const text = line.trim();
		if (text && !text.startsWith("#")) {
			step(sheet, text, i + 2);
		}
	});
	return {
		scene: { parts: sheet.parts, wires: sheet.wires },
		meant: sheet.meant,
		errors: sheet.errors,
	};
}

/** Contacts between elements at points the author did not join on purpose. */
export function strayContacts(scene: Scene, meant: Point[]): string[] {
	const meantKeys = new Set(meant.map(key));
	const owners = new Map<string, Set<string>>();
	const touch = (p: Point, owner: string) => {
		const set = owners.get(key(p)) ?? new Set();
		set.add(owner);
		owners.set(key(p), set);
	};
	for (const part of scene.parts) {
		for (const pin of Object.keys(part.def.pins)) {
			touch(pinAt(part, pin) ?? part.at, `${part.id}.${pin}`);
		}
	}
	for (const w of scene.wires) {
		for (const p of [w.points[0], w.points.at(-1)]) {
			if (p) {
				touch(p, w.net);
			}
		}
	}
	return onWires(scene, owners, meantKeys);
}

/** Points with two owners or more (or lying on another element's wire) that nobody meant. */
function onWires(scene: Scene, owners: Map<string, Set<string>>, meant: Set<string>): string[] {
	const out: string[] = [];
	for (const [k, set] of owners) {
		const [x = 0, y = 0] = k.split(",").map(Number);
		const p = { x, y };
		const through = scene.wires.filter(
			(w) => !set.has(w.net) && w.points.slice(1).some((b, i) => isOn(p, w.points[i] ?? b, b)),
		);
		const all = [...set, ...through.map((w) => w.net)];
		const elements = new Set(all.map((o) => o.split(".")[0]));
		if (elements.size > 1 && !meant.has(k)) {
			out.push(
				`${all.join(" and ")} touch at (${x / G},${y / G}) without at or to; move one, or join them on purpose`,
			);
		}
	}
	return out;
}

const isOn = (p: Point, a: Point, b: Point) =>
	(a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
	(a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
