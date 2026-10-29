/**
 * Label placement: each part's label goes to the first spot around it, nearest first and in the part's preferred order of
 * sides, that clears every wire, lead, body, pin name, junction and label already placed. A part with no free spot takes the
 * spot it overlaps least, which check.ts then reports.
 */
import { type Box, grow, overlapArea, type Point, segmentBox } from "./geometry.ts";
import {
	bodyOf,
	exitOf,
	extentOf,
	leadsOf,
	obstacleOf,
	type Part,
	pinAt,
	type Scene,
	wireSegments,
} from "./scene.ts";
import { FONT, LINE, lineWidth, VALUE_FONT } from "./text.ts";

export interface PlacedLabel {
	part: string;
	lines: string[];
	box: Box;
	anchor: "start" | "middle" | "end";
}

type Side = "right" | "left" | "above" | "below" | "inside";

/** How far from its part a label may sit, nearest first. check.ts calls a label beyond the second-last gap far from its part. */
export const GAPS = [3, 8, 16, 26];

/** A label's size: its first line set at FONT, the value under it at VALUE_FONT. */
function sizeOf(lines: string[]): { w: number; h: number } {
	const w = Math.max(...lines.map((line, i) => lineWidth(line, i ? VALUE_FONT : FONT)));
	return { w, h: lines.length * LINE };
}

/** The box a label of size `s` takes on `side` of `around`, `gap` away. */
function boxOn(side: Side, around: Box, s: { w: number; h: number }, gap: number): Box {
	const cx = (around.x0 + around.x1) / 2;
	const cy = (around.y0 + around.y1) / 2;
	switch (side) {
		case "right":
			return { x0: around.x1 + gap, y0: cy - s.h / 2, x1: around.x1 + gap + s.w, y1: cy + s.h / 2 };
		case "left":
			return { x0: around.x0 - gap - s.w, y0: cy - s.h / 2, x1: around.x0 - gap, y1: cy + s.h / 2 };
		case "above":
			return { x0: cx - s.w / 2, y0: around.y0 - gap - s.h, x1: cx + s.w / 2, y1: around.y0 - gap };
		case "below":
			return { x0: cx - s.w / 2, y0: around.y1 + gap, x1: cx + s.w / 2, y1: around.y1 + gap + s.h };
		default:
			return { x0: cx - s.w / 2, y0: cy - s.h / 2, x1: cx + s.w / 2, y1: cy + s.h / 2 };
	}
}

const anchorOf = (side: Side) => (side === "right" ? "start" : side === "left" ? "end" : "middle");

/** The side opposite a unit direction, as a label side. */
const away = (d: Point): Side =>
	d.x > 0 ? "left" : d.x < 0 ? "right" : d.y > 0 ? "above" : "below";

/** The sides to try for a part, best first: across a two-terminal's axis, away from a transistor's base or a terminal's wire. */
function sidesOf(part: Part, wireExit: Point | undefined): Side[] {
	if (part.def.texts) {
		return ["inside", "above", "below", "left", "right"];
	}
	if ("a" in part.def.pins && "b" in part.def.pins) {
		const vertical = part.o.rot === 90 || part.o.rot === 270;
		return vertical ? ["right", "left", "above", "below"] : ["above", "below", "right", "left"];
	}
	// A transistor's label goes away from its base or gate; a terminal's away from the wire that reaches it.
	const control = "b" in part.def.pins ? "b" : "g" in part.def.pins ? "g" : undefined;
	const first = control ? away(exitOf(part, control)) : wireExit ? away(wireExit) : "right";
	const rest: Side[] = ["right", "left", "above", "below"];
	return [first, ...rest.filter((s) => s !== first)];
}

/** The direction from a one-pin part (a terminal) along the wire that reaches it, if one does. */
function wireExitOf(part: Part, scene: Scene): Point | undefined {
	const p = pinAt(part, "a");
	for (const s of wireSegments(scene)) {
		const other =
			p &&
			(s.a.x === p.x && s.a.y === p.y ? s.b : s.b.x === p.x && s.b.y === p.y ? s.a : undefined);
		if (p && other) {
			return { x: Math.sign(other.x - p.x), y: Math.sign(other.y - p.y) };
		}
	}
	return undefined;
}

/** The boxes of an IC's pin names, which its own label must not cover. */
function pinTextBoxes(part: Part): Box[] {
	return (part.def.texts ?? []).map((t) => {
		const w = lineWidth(t.text, FONT);
		const x0 = t.anchor === "start" ? t.at.x : t.anchor === "end" ? t.at.x - w : t.at.x - w / 2;
		return {
			x0: x0 + part.at.x,
			y0: t.at.y - FONT + part.at.y,
			x1: x0 + w + part.at.x,
			y1: t.at.y + 3 + part.at.y,
		};
	});
}

/** What labels must stay clear of, besides each other: wires, leads, bodies, pin names and junction dots. */
export function obstaclesOf(scene: Scene, dots: Point[]): Box[] {
	return [
		...wireSegments(scene).map((s) => segmentBox(s, 1.5)),
		...scene.parts.flatMap((p) => leadsOf(p).map((s) => segmentBox(s, 1.5))),
		...scene.parts.map((p) => grow(obstacleOf(p), 1)),
		...scene.parts.flatMap(pinTextBoxes),
		...dots.map((d) => grow({ x0: d.x, y0: d.y, x1: d.x, y1: d.y }, 3)),
	];
}

/** The distance between two boxes, 0 when they touch or overlap. */
export const gapBetween = (a: Box, b: Box) =>
	Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));

/**
 * The labelled part whose body a label is as near as, or nearer than, its own part's body: the reader cannot tell whose label it
 * is. A label belongs to its part only when it is strictly nearer that part than any other.
 */
export function rivalOf(box: Box, own: Part, scene: Scene): Part | undefined {
	const gap = gapBetween(box, bodyOf(own));
	return scene.parts.find((p) => p !== own && p.label.length && gapBetween(box, bodyOf(p)) <= gap);
}

/** What a label that is not clearly its part's costs: more than any overlap, so every clear spot is tried first. */
const AMBIGUOUS = 10_000;

const clash = (box: Box, obstacles: Box[]) =>
	obstacles.reduce((sum, o) => sum + overlapArea(grow(box, 1), o), 0);

/** Slides along a side, as fractions of the label's size across it: centred first, then off to either end. */
const NUDGES = [0, -0.5, 0.5, -1, 1];

/** The spots on one side at one gap: centred, then slid along the side; inside an IC only centred. */
function spotsOn(part: Part, side: Side, size: { w: number; h: number }, gap: number): Box[] {
	// Outside an IC the label clears its pin names too, so it goes around the whole extent.
	const around = side !== "inside" && part.def.texts ? extentOf(part) : bodyOf(part);
	const box = boxOn(side, around, size, gap);
	const across = side === "left" || side === "right";
	return (side === "inside" ? [0] : NUDGES).map((nudge) => {
		const dx = across ? 0 : nudge * size.w;
		const dy = across ? nudge * size.h : 0;
		return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
	});
}

/** Every spot to try, best first: nearest gap, then the part's preferred side, then centred before slid. */
function* candidates(part: Part, sides: Side[], size: { w: number; h: number }) {
	for (const gap of GAPS) {
		for (const side of sides) {
			for (const box of spotsOn(part, side, size, gap)) {
				yield { side, box };
			}
		}
	}
}

/** One part's label: the first free spot, else the spot that overlaps least. */
function placeOne(part: Part, scene: Scene, obstacles: Box[]): PlacedLabel {
	const own = grow(bodyOf(part), 1);
	let best: { box: Box; side: Side; cost: number } | undefined;
	for (const { side, box } of candidates(
		part,
		sidesOf(part, wireExitOf(part, scene)),
		sizeOf(part.label),
	)) {
		// A label inside its own IC may cover the box, not the pin names.
		const against = side === "inside" ? obstacles.filter((o) => !sameBox(o, own)) : obstacles;
		const cost = clash(box, against) + (rivalOf(box, part, scene) ? AMBIGUOUS : 0);
		if (cost === 0) {
			return { part: part.id, lines: part.label, box, anchor: anchorOf(side) };
		}
		if (!best || cost < best.cost) {
			best = { box, side, cost };
		}
	}
	const fallback = best ?? { box: bodyOf(part), side: "inside" as Side };
	return { part: part.id, lines: part.label, box: fallback.box, anchor: anchorOf(fallback.side) };
}

/** Places every part's label in the scene's order; each placed label becomes an obstacle for the next. */
export function placeLabels(scene: Scene, dots: Point[]): PlacedLabel[] {
	const obstacles = obstaclesOf(scene, dots);
	const placed: PlacedLabel[] = [];
	for (const part of scene.parts.filter((p) => p.label.length)) {
		const label = placeOne(part, scene, obstacles);
		placed.push(label);
		obstacles.push(grow(label.box, 2));
	}
	return placed;
}

const sameBox = (a: Box, b: Box) =>
	a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
