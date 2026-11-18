/* The page's one model: a three-node graph with one negative edge, Dijkstra as taught (a node is final once settled) and Bellman-Ford.
   Every number on the page is computed here; the asserts at the bottom fail the build if the headline stops being true. */

export type Edge = readonly [from: string, to: string, weight: number];
export type Dist = Record<string, number>;
/** A node's distance; a node the run has not reached is ∞. */
export const distOf = (dist: Dist, node: string) => dist[node] ?? Infinity;

export const NODES = ["S", "A", "B"] as const;
export const SOURCE = "S";
export const TARGET = "A";
export const EDGES: Edge[] = [
	["S", "A", 2],
	["S", "B", 3],
	["B", "A", -2],
];

const out = (edges: readonly Edge[], u: string) => edges.filter(([from]) => from === u);

/** How an edge was treated: lowered the target's distance, kept it, or was never looked at because the target was settled. */
export type Verdict = "lowered" | "kept" | "ignored";

export interface Frame {
	dist: Dist;
	settled: string[];
	/** The node settled in this step, the edges it relaxed and what each did. */
	now?: { node: string; edges: { edge: Edge; verdict: Verdict }[] };
}

export interface Run {
	dist: Dist;
	/** The predecessor of each node on its path from the source. */
	prev: Record<string, string>;
	/** One frame per state worth showing: the start, each settled node, the end. */
	frames: [Frame, ...Frame[]];
	/** Edge checks made. */
	checks: number;
}

/** Dijkstra, with the rule the proof needs: a settled node is final and its distance is never touched again. */
export function dijkstra(
	edges: readonly Edge[],
	nodes: readonly string[] = NODES,
	source = SOURCE,
): Run {
	const dist: Dist = Object.fromEntries(nodes.map((n) => [n, Infinity]));
	const prev: Record<string, string> = {};
	const settled = new Set<string>();
	dist[source] = 0;
	const frames: [Frame, ...Frame[]] = [{ dist: { ...dist }, settled: [] }];
	let checks = 0;
	for (;;) {
		const queue = nodes.filter((n) => !settled.has(n) && distOf(dist, n) < Infinity);
		if (!queue.length) {
			break;
		}
		const u = queue.reduce((a, b) => (distOf(dist, b) < distOf(dist, a) ? b : a));
		settled.add(u);
		const done = out(edges, u).map((edge) => {
			const [, v, w] = edge;
			checks++;
			let verdict: Verdict = "kept";
			if (settled.has(v)) {
				verdict = "ignored";
			} else if (distOf(dist, u) + w < distOf(dist, v)) {
				dist[v] = distOf(dist, u) + w;
				prev[v] = u;
				verdict = "lowered";
			}
			return { edge, verdict };
		});
		frames.push({ dist: { ...dist }, settled: [...settled], now: { node: u, edges: done } });
	}
	frames.push({ dist: { ...dist }, settled: [...settled] });
	return { dist, prev, frames, checks };
}

/** Bellman-Ford: every edge, V - 1 rounds, no settling, so a later edge may still lower any distance. */
export function bellmanFord(
	edges: readonly Edge[],
	nodes: readonly string[] = NODES,
	source = SOURCE,
): Run {
	const dist: Dist = Object.fromEntries(nodes.map((n) => [n, Infinity]));
	const prev: Record<string, string> = {};
	dist[source] = 0;
	let checks = 0;
	for (let round = 1; round < nodes.length; round++) {
		for (const [u, v, w] of edges) {
			checks++;
			if (distOf(dist, u) + w < distOf(dist, v)) {
				dist[v] = distOf(dist, u) + w;
				prev[v] = u;
			}
		}
	}
	return { dist, prev, frames: [{ dist: { ...dist }, settled: [] }], checks };
}

/** The path the predecessors give, source first. */
export function pathTo(run: Run, target: string, source = SOURCE): string[] {
	const path = [target];
	for (let at = target; at !== source; ) {
		const before = run.prev[at];
		if (before === undefined) {
			throw new Error(`${target} is not reached from ${source}`);
		}
		path.unshift(before);
		at = before;
	}
	return path;
}

/** The weight of the edge from `a` to `b`; a path through a missing edge is a mistake in this file. */
const weight = (a: string, b: string, edges: readonly Edge[]) => {
	const edge = edges.find(([from, to]) => from === a && to === b);
	if (!edge) {
		throw new Error(`no edge ${a} → ${b}`);
	}
	return edge[2];
};

export const pathCost = (path: string[], edges: readonly Edge[] = EDGES) =>
	path.slice(1).reduce((sum, v, i) => sum + weight(path[i] as string, v, edges), 0);

export const DIJKSTRA = dijkstra(EDGES);
export const BELLMAN = bellmanFord(EDGES);
export const DIJKSTRA_PATH = pathTo(DIJKSTRA, TARGET);
export const BELLMAN_PATH = pathTo(BELLMAN, TARGET);

/** The fix a reader tries first: add the same amount to every weight so none is negative. */
export const SHIFT = -Math.min(...EDGES.map(([, , w]) => w));
export const SHIFTED: Edge[] = EDGES.map(([a, b, w]) => [a, b, w + SHIFT]);
export const SHIFTED_PATH = pathTo(dijkstra(SHIFTED), TARGET);
/** What that path costs on the original weights. */
export const SHIFTED_COST = pathCost(SHIFTED_PATH);

/* Checks. Two nodes cannot show the failure: with one edge each way, over every weight from -3 to 3, Dijkstra equals Bellman-Ford. */
const weights = [undefined, -3, -2, -1, 0, 1, 2, 3];
for (const ab of weights) {
	for (const ba of weights) {
		const edges: Edge[] = [];
		if (ab !== undefined) {
			edges.push(["S", "A", ab]);
		}
		if (ba !== undefined) {
			edges.push(["A", "S", ba]);
		}
		const d = dijkstra(edges, ["S", "A"]).dist;
		const b = bellmanFord(edges, ["S", "A"]).dist;
		if (b.S !== 0) {
			continue; // a negative loop through S: no shortest distance exists
		}
		if (d.A !== b.A) {
			throw new Error(`two nodes already differ: ${JSON.stringify(edges)}`);
		}
	}
}
if (DIJKSTRA.dist[TARGET] !== 2 || BELLMAN.dist[TARGET] !== 1) {
	throw new Error("the headline is no longer true");
}
if (pathCost(BELLMAN_PATH) !== BELLMAN.dist[TARGET]) {
	throw new Error("Bellman-Ford's path does not cost its distance");
}
