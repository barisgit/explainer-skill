/**
 * Automatic placement for a netlist with no positions: ELK's layered layout, the engine pack already draws Mermaid with, places
 * each part as a node whose ports sit at its pins and routes the nets orthogonally between them. Two-terminal parts with a
 * grounded end stand upright with ground below; everything else lies flat, signal running left to right.
 */

// Spike: elkjs from node_modules. Shipping would export the vendored bundle's synchronous layout (beautiful-mermaid's
// elk-instance.ts) instead, adding nothing to the skill's size.
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api";
import { type Box, type Orientation, union } from "./geometry.ts";
import { GROUND_NETS, groundsFor, type NetPart, netsOf } from "./netlist.ts";
import { exitOf, extentOf, pinAt, type Wire } from "./scene.ts";
import { hasTwoPins } from "./symbols.ts";

interface SyncWorker {
	onmessage: (answer: { data: { error?: unknown; data?: ElkNode } }) => void;
	dispatcher: {
		saveDispatch: (message: { data: { id: number; cmd: string; graph: ElkNode } }) => void;
	};
}

let worker: SyncWorker | undefined;

/** ELK's layout run synchronously, as beautiful-mermaid does: its fake worker answers within the dispatch call. */
function layoutSync(graph: ElkNode): ElkNode {
	if (!worker) {
		const pending: Array<() => void> = [];
		const later = globalThis.setTimeout;
		// The bundled worker starts itself with setTimeout(0); run that at once so the instance is ready on return.
		globalThis.setTimeout = ((fn: () => void, delay?: number) => {
			if (delay !== 0) {
				return later(fn, delay);
			}
			pending.push(fn);
			return 0;
		}) as typeof setTimeout;
		// With `self` defined (Bun has it) elkjs looks for a real Worker; without it, it takes its in-process one.
		const g = globalThis as { self?: unknown };
		const self = g.self;
		delete g.self;
		const elk = new ELK() as unknown as { worker: { worker: SyncWorker } };
		g.self = self;
		globalThis.setTimeout = later;
		for (const fn of pending) {
			fn();
		}
		worker = elk.worker.worker;
	}
	let result: ElkNode | undefined;
	let error: unknown;
	const own = worker.onmessage;
	worker.onmessage = (answer) => {
		error = answer.data.error;
		result = answer.data.data;
	};
	worker.dispatcher.saveDispatch({ data: { id: 0, cmd: "layout", graph } });
	worker.onmessage = own;
	if (error || !result) {
		throw error instanceof Error ? error : new Error(`ELK layout failed: ${JSON.stringify(error)}`);
	}
	return result;
}

const UP: Orientation = { rot: 270, flip: false };
const DOWN: Orientation = { rot: 90, flip: false };

/** Stands a grounded two-terminal part up with its grounded end at the bottom. */
function orientFor(part: NetPart): Orientation {
	if (!hasTwoPins(part.def) || part.placed) {
		return part.o;
	}
	const { a, b } = part.nets;
	if (GROUND_NETS.has(b ?? "")) {
		return DOWN;
	}
	return GROUND_NETS.has(a ?? "") ? UP : part.o;
}

const SIDE = (x: number, y: number) =>
	x > 0 ? "EAST" : x < 0 ? "WEST" : y > 0 ? "SOUTH" : "NORTH";

/** A part's box with the part at the origin: ELK puts ports on its border, so the pins must be on it. */
function footprint(part: NetPart): Box {
	return extentOf({ ...part, at: { x: 0, y: 0 } });
}

/** The room a part's grounds take outside its box, as ELK margins, so no other part lands on them. */
function groundMargins(part: NetPart, box: Box): string {
	const { grounds } = groundsFor([{ ...part, at: { x: 0, y: 0 } }]);
	const all = union([box, ...grounds.map(extentOf)]);
	return `[top=${box.y0 - all.y0},left=${box.x0 - all.x0},bottom=${all.y1 - box.y1},right=${all.x1 - box.x1}]`;
}

/** A terminal that starts its net feeds it from the left; any other is fed from the right. */
const portSide = (part: NetPart, firsts: Set<string>) => (firsts.has(part.id) ? "EAST" : "WEST");

function nodeOf(part: NetPart, firsts: Set<string>): ElkNode {
	part.o = orientFor(part);
	const box = footprint(part);
	const ports: ElkPort[] = Object.keys(part.def.pins).flatMap((pin) => {
		const p = pinAt({ ...part, at: { x: 0, y: 0 } }, pin);
		const e = exitOf(part, pin);
		if (!p || GROUND_NETS.has(part.nets[pin] ?? "")) {
			return [];
		}
		const side = part.kind === "port" ? portSide(part, firsts) : SIDE(e.x, e.y);
		return [
			{
				id: `${part.id}.${pin}`,
				x: p.x - box.x0,
				y: p.y - box.y0,
				width: 0,
				height: 0,
				layoutOptions: { "elk.port.side": side },
			},
		];
	});
	return {
		id: part.id,
		width: box.x1 - box.x0,
		height: box.y1 - box.y0,
		ports,
		layoutOptions: { "elk.portConstraints": "FIXED_POS", "elk.margins": groundMargins(part, box) },
	};
}

/** Every net as edges from its first pin to each other pin. */
function edgesOf(parts: NetPart[]): ElkExtendedEdge[] {
	return [...netsOf(parts)].flatMap(([net, pins]) => {
		const [first, ...rest] = pins;
		return first
			? rest.map((p, i) => ({
					id: `${net}#${i}`,
					sources: [`${first.part.id}.${first.pin}`],
					targets: [`${p.part.id}.${p.pin}`],
				}))
			: [];
	});
}

/** Where ELK put a part: ELK moves a port onto its node's border, so the part goes by its first port, and pin and wire meet. */
function placedAt(part: NetPart, node: ElkNode): { x: number; y: number } {
	const x = node.x ?? 0;
	const y = node.y ?? 0;
	const port = node.ports?.[0];
	const local = port && pinAt({ ...part, at: { x: 0, y: 0 } }, port.id.slice(part.id.length + 1));
	if (port && local) {
		return {
			x: Math.round(x + (port.x ?? 0) - local.x),
			y: Math.round(y + (port.y ?? 0) - local.y),
		};
	}
	const box = footprint(part);
	return { x: Math.round(x - box.x0), y: Math.round(y - box.y0) };
}

/** Places every part and routes every net with ELK; grounds are added after, at their pins. */
export function elkLayout(parts: NetPart[]): Wire[] {
	const firsts = new Set([...netsOf(parts).values()].map((pins) => pins[0]?.part.id ?? ""));
	const nodes = parts.map((part) => nodeOf(part, firsts));
	const graph = layoutSync({
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.edgeRouting": "ORTHOGONAL",
			"elk.spacing.nodeNode": "30",
			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
			"elk.spacing.edgeNode": "15",
			"elk.spacing.edgeEdge": "10",
			"elk.layered.spacing.edgeEdgeBetweenLayers": "10",
			"elk.layered.spacing.edgeNodeBetweenLayers": "15",
			"elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
			"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
			"elk.layered.mergeEdges": "true",
		},
		children: nodes,
		edges: edgesOf(parts),
	});
	for (const node of graph.children ?? []) {
		const part = parts.find((p) => p.id === node.id);
		if (part) {
			part.at = placedAt(part, node);
		}
	}
	return (graph.edges ?? []).flatMap((edge) =>
		(edge.sections ?? []).map((s) => ({
			net: edge.id.split("#")[0] ?? edge.id,
			points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({
				x: Math.round(p.x),
				y: Math.round(p.y),
			})),
		})),
	);
}
