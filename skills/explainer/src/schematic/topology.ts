/** What a finished drawing connects, read from its geometry alone: the joins wires and pins make, junction dots, and how busy it is. */
import {
	crossing,
	insideSegment,
	key,
	onSegment,
	type Point,
	type Segment,
	same,
} from "./geometry.ts";
import { leadsOf, type Part, pinsOf, type Scene, wireSegments } from "./scene.ts";

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

/** A point where wires end or pass and pins sit, with what meets there. */
interface Contact {
	at: Point;
	ends: number;
	through: number;
	pins: number;
}

/** The points that join: wire ends and pins, each with what touches it. */
function contacts(scene: Scene): Contact[] {
	const out = new Map<string, Contact>();
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
	for (const part of scene.parts) {
		for (const { at: p } of pinsOf(part)) {
			at(p).pins++;
		}
	}
	for (const entry of out.values()) {
		entry.through = segments.filter((s) => insideSegment(entry.at, s)).length;
	}
	return [...out.values()];
}

/** Joins every point on a pin's lead (a wire's end, another part's pin) to that pin: the lead is conductor, a part's own terminals stay apart. */
function joinLeads(joins: Joins, scene: Scene, points: Point[]) {
	for (const part of scene.parts) {
		for (const lead of leadsOf(part)) {
			for (const p of points.filter((q) => onSegment(q, lead))) {
				joins.join(key(p), key(lead.a));
			}
		}
	}
}

/** Every pin on the sheet that a wire or another pin reaches, grouped by what joins them: the netlist the geometry says. */
export function drawnNets(scene: Scene): Array<{ pins: Array<{ part: Part; pin: string }> }> {
	const joins = new Joins();
	const segments = wireSegments(scene);
	const points = contacts(scene).map((c) => c.at);
	for (const s of segments) {
		joins.join(key(s.a), key(s.b));
		for (const p of points.filter((q) => onSegment(q, s))) {
			joins.join(key(p), key(s.a));
		}
	}
	joinLeads(joins, scene, points);
	const nets = new Map<string, Array<{ part: Part; pin: string }>>();
	for (const part of scene.parts) {
		for (const { pin, at } of pinsOf(part)) {
			const root = joins.find(key(at));
			nets.set(root, [...(nets.get(root) ?? []), { part, pin }]);
		}
	}
	return [...nets.values()].map((pins) => ({ pins }));
}

/** Junction dots: where three or more wire ends, pins and wires passing through meet. */
export function junctions(scene: Scene): Point[] {
	return contacts(scene)
		.filter((c) => c.ends + 2 * c.through + c.pins >= 3 && c.ends + c.through > 0)
		.map((c) => c.at);
}

/** How busy a drawing is: what the router is measured by. */
export interface Stats {
	parts: number;
	segments: number;
	bends: number;
	crossings: number;
	length: number;
}

/** A corner: two wire ends meeting at right angles with nothing else there. */
function isBend(c: Contact, segments: Segment[]): boolean {
	if (c.ends !== 2 || c.through || c.pins) {
		return false;
	}
	const [s, t] = segments.filter((seg) => same(seg.a, c.at) || same(seg.b, c.at));
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
		parts: scene.parts.filter((p) => !["ground", "port", "vdd", "vss"].includes(p.kind)).length,
		segments: segments.length,
		bends: contacts(scene).filter((c) => isBend(c, segments)).length,
		crossings,
		length: Math.round(
			segments.reduce((sum, s) => sum + Math.abs(s.a.x - s.b.x) + Math.abs(s.a.y - s.b.y), 0),
		),
	};
}
