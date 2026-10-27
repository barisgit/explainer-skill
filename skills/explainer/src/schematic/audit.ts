/**
 * What a drawing means and what is wrong with it, read from its geometry alone: which pins the wires join (so a resistor drawn
 * onto a neighbouring wire is caught as a connection the author never made), junction dots, wires through parts, overlapping
 * parts and labels that could not be placed clear of everything.
 */
import {
	type Box,
	crossesBox,
	crossing,
	grow,
	insideSegment,
	key,
	onSegment,
	overlapArea,
	type Point,
	type Segment,
	same,
} from "./geometry.ts";
import type { PlacedLabel } from "./labels.ts";
import { obstaclesOf } from "./labels.ts";
import { bodyOf, type Part, pinAt, type Scene, wireSegments } from "./scene.ts";

/** A union-find over point keys. */
class Joins {
	private readonly up = new Map<string, string>();
	find(k: string): string {
		const parent = this.up.get(k) ?? k;
		if (parent === k) {
			return k;
		}
		const root = this.find(parent);
		this.up.set(k, root);
		return root;
	}
	join(a: string, b: string) {
		this.up.set(this.find(a), this.find(b));
	}
}

/** Every pin on the sheet: `R1.a` at its point. */
export const pinsOf = (scene: Scene) =>
	scene.parts.flatMap((part) =>
		Object.keys(part.def.pins).map((pin) => ({ part, pin, at: pinAt(part, pin) ?? part.at })),
	);

/** The points that join: wire ends, and pins, each with what touches them. */
function contacts(
	scene: Scene,
): Map<string, { at: Point; ends: number; through: number; pins: number }> {
	const out = new Map<string, { at: Point; ends: number; through: number; pins: number }>();
	const at = (p: Point) => {
		const k = key(p);
		const entry = out.get(k) ?? { at: p, ends: 0, through: 0, pins: 0 };
		out.set(k, entry);
		return entry;
	};
	const segments = wireSegments(scene);
	for (const s of segments) {
		at(s.a).ends++;
		at(s.b).ends++;
	}
	for (const { at: p } of pinsOf(scene)) {
		at(p).pins++;
	}
	for (const entry of out.values()) {
		entry.through = segments.filter((s) => insideSegment(entry.at, s)).length;
	}
	return out;
}

/** The pins each drawn net joins, as sets of `part.pin` names: the netlist the geometry says. */
export function drawnNets(scene: Scene): Array<{ pins: string[]; points: Point[] }> {
	const joins = new Joins();
	const segments = wireSegments(scene);
	const points = [...contacts(scene).values()].map((c) => c.at);
	for (const s of segments) {
		joins.join(key(s.a), key(s.b));
		for (const p of points.filter((q) => onSegment(q, s))) {
			joins.join(key(p), key(s.a));
		}
	}
	const nets = new Map<string, { pins: string[]; points: Point[] }>();
	for (const { part, pin, at } of pinsOf(scene)) {
		const root = joins.find(key(at));
		const net = nets.get(root) ?? { pins: [], points: [] };
		net.pins.push(`${part.id}.${pin}`);
		net.points.push(at);
		nets.set(root, net);
	}
	return [...nets.values()];
}

/** Junction dots: where three or more wire ends, pins and wires passing through meet. */
export function junctions(scene: Scene): Point[] {
	return [...contacts(scene).values()]
		.filter((c) => c.ends + 2 * c.through + c.pins >= 3 && c.ends + c.through > 0)
		.map((c) => c.at);
}

/** Wires passing through a part's body, as problems. */
function wiresThroughParts(scene: Scene): string[] {
	const out: string[] = [];
	for (const s of wireSegments(scene)) {
		for (const part of scene.parts) {
			// A terminal's pin is the centre of its circle: its own wire ends inside it.
			const ownEnd =
				part.kind === "port" && [s.a, s.b].some((p) => same(p, pinAt(part, "a") ?? part.at));
			if (!ownEnd && crossesBox(s, grow(bodyOf(part), -0.5))) {
				out.push(`a wire of net ${s.net} runs through ${part.id} at ${where(s)}`);
			}
		}
	}
	return out;
}

const where = (s: Segment) => `(${s.a.x},${s.a.y})-(${s.b.x},${s.b.y})`;

/** Parts drawn on top of each other. */
function overlappingParts(parts: Part[]): string[] {
	const out: string[] = [];
	parts.forEach((p, i) => {
		for (const q of parts.slice(i + 1)) {
			if (overlapArea(bodyOf(p), bodyOf(q)) > 0) {
				out.push(`${p.id} and ${q.id} overlap`);
			}
		}
	});
	return out;
}

/** Labels that overlap a wire, a part, a pin name, a dot or another label. */
function labelClashes(scene: Scene, dots: Point[], labels: PlacedLabel[]): string[] {
	const obstacles: Box[] = obstaclesOf(scene, dots);
	const out: string[] = [];
	labels.forEach((label, i) => {
		const own = scene.parts.find((p) => p.id === label.part);
		const inside = own?.def.texts && overlapArea(label.box, bodyOf(own)) > 0;
		const against = obstacles.filter((o) => !(inside && own && sameBox(o, grow(bodyOf(own), 1))));
		const others = labels.filter((_, j) => j !== i).map((l) => l.box);
		if ([...against, ...others].some((o) => overlapArea(label.box, o) > 0)) {
			out.push(`the label of ${label.part} overlaps the drawing`);
		}
	});
	return out;
}

const sameBox = (a: Box, b: Box) =>
	a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;

/** Numbers a reader of the comparison wants: how busy the drawing is. */
export interface Stats {
	parts: number;
	segments: number;
	bends: number;
	crossings: number;
	length: number;
}

/** A corner: two wire ends meeting at right angles with nothing else there. */
function isBend(
	c: { at: Point; ends: number; through: number; pins: number },
	segments: Segment[],
): boolean {
	if (c.ends !== 2 || c.through || c.pins) {
		return false;
	}
	const ending = segments.filter((s) => same(s.a, c.at) || same(s.b, c.at));
	const [s, t] = ending;
	return Boolean(s && t && (s.a.x === s.b.x) !== (t.a.x === t.b.x));
}

export function statsOf(scene: Scene): Stats {
	const segments = wireSegments(scene);
	let crossings = 0;
	segments.forEach((s, i) => {
		for (const t of segments.slice(i + 1)) {
			if (s.net !== t.net && crossing(s, t)) {
				crossings++;
			}
		}
	});
	return {
		parts: scene.parts.filter((p) => p.kind !== "ground" && p.kind !== "port").length,
		segments: segments.length,
		bends: [...contacts(scene).values()].filter((c) => isBend(c, segments)).length,
		crossings,
		length: Math.round(
			segments.reduce((sum, s) => sum + Math.abs(s.a.x - s.b.x) + Math.abs(s.a.y - s.b.y), 0),
		),
	};
}

/**
 * The netlist check for a scene drawn from a netlist: every declared net's pins joined, no two nets joined. A wire laid over a
 * neighbouring wire or pin is a short here.
 */
export function netProblems(scene: Scene): string[] {
	const declared = new Map<string, string>();
	for (const part of scene.parts) {
		for (const [pin, net] of Object.entries(part.nets ?? {})) {
			declared.set(`${part.id}.${pin}`, net);
		}
	}
	const out: string[] = [];
	const seen = new Map<string, number>();
	for (const [i, net] of drawnNets(scene).entries()) {
		const names = [...new Set(net.pins.map((p) => declared.get(p)).filter((n) => n !== undefined))];
		if (names.length > 1) {
			out.push(`nets ${names.join(" and ")} touch (${net.pins.join(", ")})`);
		}
		for (const name of names) {
			if (seen.has(name) && name !== "0") {
				out.push(`net ${name} is drawn in pieces`);
			}
			seen.set(name, i);
		}
	}
	return out;
}

/** Every geometric problem of a finished drawing. */
export function geometryProblems(scene: Scene, dots: Point[], labels: PlacedLabel[]): string[] {
	return [
		...wiresThroughParts(scene),
		...overlappingParts(scene.parts),
		...labelClashes(scene, dots, labels),
	];
}

/** Whether a point is one of the given points. */
export const among = (p: Point, points: Point[]) => points.some((q) => same(p, q));
