/**
 * What is wrong with a finished drawing, as sentences that say what to write instead: wires through parts, parts on top of each
 * other, labels with no clear place or far from their part, nets that touch or fall in pieces, and pins left open by accident.
 * Each names the netlist line it concerns.
 */
import {
	type Box,
	crossesBox,
	grow,
	overlapArea,
	type Point,
	type Segment,
	same,
} from "./geometry.ts";
import { GAPS, gapBetween, obstaclesOf, type PlacedLabel, rivalOf } from "./labels.ts";
import { GROUND_NETS, GROUND_REF, netsOf, OPEN_NET } from "./nets.ts";
import { bodyOf, extentOf, type Part, pinAt, type Scene, wireSegments } from "./scene.ts";
import { drawnNets } from "./topology.ts";

const at = (part: Part) => `line ${part.line} (${part.id})`;

/** The net a pin's name stands for: every ground is the one net, whatever it was called. */
const netOf = (part: Part, pin: string) => {
	const net = part.nets[pin] ?? "";
	return GROUND_NETS.has(net) ? GROUND_REF : net;
};

const where = (s: Segment) => `(${s.a.x / 10},${s.a.y / 10})-(${s.b.x / 10},${s.b.y / 10})`;

/** Wires passing through a part's body. */
function wiresThroughParts(scene: Scene): string[] {
	const out: string[] = [];
	for (const s of wireSegments(scene)) {
		for (const part of scene.parts) {
			// A terminal's pin is the centre of its circle: its own wire ends inside it.
			const ownEnd =
				part.kind === "port" && [s.a, s.b].some((p) => same(p, pinAt(part, "a") ?? part.at));
			if (!ownEnd && crossesBox(s, grow(bodyOf(part), -0.5))) {
				out.push(
					`${at(part)}: the wire of net ${s.net} runs through ${part.id} at ${where(s)}; move ${part.id} (change its offset, or turn it with h or v) so no wire crosses it`,
				);
			}
		}
	}
	return out;
}

/** Parts drawn on top of each other. */
export function overlappingParts(parts: Part[]): string[] {
	const out: string[] = [];
	parts.forEach((p, i) => {
		for (const q of parts.slice(i + 1)) {
			if (overlapArea(bodyOf(p), bodyOf(q)) > 0) {
				out.push(
					`${at(q)}: overlaps ${p.id} (line ${p.line}); place ${q.id} further from it (a larger dx,dy)`,
				);
			}
		}
	});
	return out;
}

/** The gap at which a label counts as far from its part. */
const FAR = GAPS[GAPS.length - 2] ?? 16;

const sameBox = (a: Box, b: Box) =>
	a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;

/** Labels that overlap the drawing or each other, sit far from their part, or sit nearer another part. */
function labelProblems(scene: Scene, dots: Point[], labels: PlacedLabel[]): string[] {
	const obstacles = obstaclesOf(scene, dots);
	const out: string[] = [];
	labels.forEach((label, i) => {
		const own = scene.parts.find((p) => p.id === label.part);
		if (!own) {
			return;
		}
		const inside = own.def.texts && overlapArea(label.box, bodyOf(own)) > 0;
		const against = obstacles.filter((o) => !(inside && sameBox(o, grow(bodyOf(own), 1))));
		const others = labels.filter((_, j) => j !== i).map((l) => l.box);
		if ([...against, ...others].some((o) => overlapArea(label.box, o) > 0)) {
			out.push(
				`${at(own)}: its label has no free place; leave room beside ${own.id} (a larger offset to its neighbours) or shorten its value`,
			);
			return;
		}
		const gap = gapBetween(label.box, extentOf(own));
		const rival = rivalOf(label.box, own, scene);
		if (!inside && gap > FAR) {
			out.push(
				`${at(own)}: its label sits ${Math.round(gap)} units from it; leave room right beside ${own.id} for it`,
			);
		} else if (!inside && rival) {
			out.push(
				`${at(own)}: its label is as near ${rival.id} as ${own.id}, so it could belong to either; leave room right beside ${own.id} for it (a larger offset from ${rival.id})`,
			);
		}
	});
	return out;
}

/** The nets the geometry joins against the nets the netlist declares: no two joined, none in pieces, none ending nowhere. */
function netProblems(scene: Scene): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const net of drawnNets(scene)) {
		const names = [
			...new Set(net.pins.map((p) => netOf(p.part, p.pin)).filter((n) => n && n !== OPEN_NET)),
		];
		const touching = net.pins.filter(
			(p) => names.length > 1 && names.includes(netOf(p.part, p.pin)),
		);
		if (names.length > 1) {
			const lines = [...new Set(touching.map((p) => p.part.line))].join(", ");
			out.push(
				`lines ${lines}: nets ${names.join(" and ")} touch (${touching.map((p) => `${p.part.id}.${p.pin}`).join(", ")}); move one of the parts so their pins do not meet, or give them the same net`,
			);
		}
		for (const name of names) {
			if (seen.has(name) && name !== GROUND_REF) {
				const first = net.pins.find((p) => netOf(p.part, p.pin) === name);
				out.push(
					`${first ? at(first.part) : "net"}: net ${name} is drawn in pieces; a wire could not reach all of its pins (see the no free route problems)`,
				);
			}
			seen.add(name);
		}
	}
	return out;
}

/** Nets with a single pin, which look like a typo; `nc` marks a pin left open on purpose. */
function openNets(scene: Scene): string[] {
	return [...netsOf(scene.parts)]
		.filter(([, pins]) => pins.length === 1)
		.map(([net, pins]) => {
			const [only] = pins;
			return `${only ? at(only.part) : "?"}: net ${net} joins only ${only?.part.id}.${only?.pin}; name the pin it connects to ${net} too, or write nc to leave it open`;
		});
}

/** Every problem of a finished drawing. */
export function problemsOf(scene: Scene, dots: Point[], labels: PlacedLabel[]): string[] {
	return [
		...openNets(scene),
		...wiresThroughParts(scene),
		...overlappingParts(scene.parts),
		...labelProblems(scene, dots, labels),
		...netProblems(scene),
	];
}
