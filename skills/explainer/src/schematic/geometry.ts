/** Points, boxes and orthogonal segments in drawing units (px at 1:1), with the tests the layout and the audit share. */

export interface Point {
	x: number;
	y: number;
}

/** An axis-aligned box; x0 <= x1 and y0 <= y1. */
export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** A wire segment; schematic wires are horizontal or vertical. */
export interface Segment {
	a: Point;
	b: Point;
}

/** A quarter-turn count and a mirror: how a symbol drawn facing right is turned onto the sheet. */
export interface Orientation {
	rot: 0 | 90 | 180 | 270;
	flip: boolean;
}

export const UPRIGHT: Orientation = { rot: 0, flip: false };

/** Coordinates within this distance are the same point; layouts snap to whole units, so this only absorbs float noise. */
const EPS = 0.01;

export const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS;
export const key = (p: Point) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
export const add = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y });

/** `p` turned by `o` about the origin: mirrored across the y axis first, then rotated clockwise on screen (y grows down). */
export function orient(p: Point, o: Orientation): Point {
	const m = o.flip ? { x: -p.x, y: p.y } : p;
	switch (o.rot) {
		case 90:
			return { x: -m.y, y: m.x };
		case 180:
			return { x: -m.x, y: -m.y };
		case 270:
			return { x: m.y, y: -m.x };
		default:
			return m;
	}
}

export const boxOf = (points: Point[]): Box => ({
	x0: Math.min(...points.map((p) => p.x)),
	y0: Math.min(...points.map((p) => p.y)),
	x1: Math.max(...points.map((p) => p.x)),
	y1: Math.max(...points.map((p) => p.y)),
});

/** A box's corners turned by `o` and moved to `at`. */
export const placeBox = (b: Box, o: Orientation, at: Point): Box =>
	boxOf(
		[
			{ x: b.x0, y: b.y0 },
			{ x: b.x1, y: b.y1 },
		].map((p) => add(orient(p, o), at)),
	);

export const grow = (b: Box, by: number): Box => ({
	x0: b.x0 - by,
	y0: b.y0 - by,
	x1: b.x1 + by,
	y1: b.y1 + by,
});

export const union = (boxes: Box[]): Box => ({
	x0: Math.min(...boxes.map((b) => b.x0)),
	y0: Math.min(...boxes.map((b) => b.y0)),
	x1: Math.max(...boxes.map((b) => b.x1)),
	y1: Math.max(...boxes.map((b) => b.y1)),
});

/** The area two boxes share, 0 when they only touch. */
export function overlapArea(a: Box, b: Box): number {
	const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
	const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
	return w > EPS && h > EPS ? w * h : 0;
}

/** A segment as the thin box it covers, `half` wide on each side. */
export const segmentBox = (s: Segment, half: number): Box => grow(boxOf([s.a, s.b]), half);

const isHorizontal = (s: Segment) => Math.abs(s.a.y - s.b.y) < EPS;

/** Whether `p` lies on `s`, ends included. */
export function onSegment(p: Point, s: Segment): boolean {
	const b = boxOf([s.a, s.b]);
	const inX = p.x > b.x0 - EPS && p.x < b.x1 + EPS;
	const inY = p.y > b.y0 - EPS && p.y < b.y1 + EPS;
	return (
		inX && inY && (isHorizontal(s) ? Math.abs(p.y - s.a.y) < EPS : Math.abs(p.x - s.a.x) < EPS)
	);
}

/** Whether `p` lies on `s` strictly between its ends. */
export const insideSegment = (p: Point, s: Segment) =>
	onSegment(p, s) && !same(p, s.a) && !same(p, s.b);

/** Whether a segment passes through the open interior of a box (touching its edge does not count). */
export function crossesBox(s: Segment, b: Box): boolean {
	const sb = boxOf([s.a, s.b]);
	if (isHorizontal(s)) {
		return s.a.y > b.y0 + EPS && s.a.y < b.y1 - EPS && sb.x1 > b.x0 + EPS && sb.x0 < b.x1 - EPS;
	}
	return s.a.x > b.x0 + EPS && s.a.x < b.x1 - EPS && sb.y1 > b.y0 + EPS && sb.y0 < b.y1 - EPS;
}

/** The point where a horizontal and a vertical segment cross strictly inside both, if they do. */
export function crossing(s: Segment, t: Segment): Point | undefined {
	if (isHorizontal(s) === isHorizontal(t)) {
		return undefined;
	}
	const [h, v] = isHorizontal(s) ? [s, t] : [t, s];
	const p = { x: v.a.x, y: h.a.y };
	return insideSegment(p, h) && insideSegment(p, v) ? p : undefined;
}

/** A polyline as its segments, dropping zero-length ones. */
export function segmentsOf(points: Point[]): Segment[] {
	const out: Segment[] = [];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (a && b && !same(a, b)) {
			out.push({ a, b });
		}
	}
	return out;
}
