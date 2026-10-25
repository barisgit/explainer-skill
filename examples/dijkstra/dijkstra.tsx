/* Dijkstra's algorithm as a list of snapshots, one per step, each with the caption that explains it. */
import type { ComponentChildren } from "preact";
import type { Graph } from "./graphs.ts";

/** A distance as the page writes it: ∞ for no route, a typographic minus. */
export const num = (x: number) => (x === Infinity ? "∞" : String(x).replace("-", "−"));

/** What a relaxed road did to its far end: drawn on the road, and the caption's verdict. */
export type RoadState = "improved" | "kept" | "missed";

/** The state of the queue, the table and the graph at one step. */
export interface Step {
	kind: "init" | "settle" | "relax" | "done";
	/** Pseudocode lines in use, 1-based. */
	lines: number[];
	caption: ComponentChildren;
	dist: Record<string, number>;
	/** The node each one was reached from on its best known route. */
	prev: Record<string, string>;
	settled: Set<string>;
	/** Settled nodes whose wrong distance a caption has already pointed out. */
	exposed: Set<string>;
	/** Queued nodes and their distances, smallest first. */
	queue: [string, number][];
	/** The true shortest distances, from Bellman–Ford. */
	wanted: Record<string, number>;
	current: string | null;
	/** The relaxed roads' states, by edge index. */
	edges: Record<number, RoadState>;
	changed: Set<string>;
}

interface Road {
	v: string;
	w: number;
	i: number;
}

/** The roads out of `u` (both ways unless the graph is directed), by neighbour name. */
const outRoads = (g: Graph, u: string): Road[] =>
	g.edges
		.flatMap(([a, b, w], i) =>
			a === u ? [{ v: b, w, i }] : !g.directed && b === u ? [{ v: a, w, i }] : [],
		)
		.sort((x, y) => (x.v < y.v ? -1 : 1));

const roadName = (g: Graph, u: string, v: string) => `${u}${g.directed ? "→" : "–"}${v}`;

const everyNode = (g: Graph, value: number) =>
	Object.fromEntries(g.nodes.map((n) => [n.id, value]));

/** Shortest distances by Bellman–Ford: slow but valid with negative edges. Used only as the reference answer. */
function truth(g: Graph, start: string): Record<string, number> {
	const dist = everyNode(g, Infinity);
	dist[start] = 0;
	for (const _ of g.nodes) {
		for (const n of g.nodes) {
			for (const { v, w } of outRoads(g, n.id)) {
				dist[v] = Math.min(dist[v] ?? Infinity, (dist[n.id] ?? Infinity) + w);
			}
		}
	}
	return dist;
}

interface Settling {
	u: string;
	d: number;
	rest: [string, number][];
	first: boolean;
	negative: boolean;
	again: boolean;
	reopen: boolean;
}

/** Why the node just taken from the queue is final (or, with a negative edge, why it may not be). */
function settleCaption({ u, d, rest, first, negative, again, reopen }: Settling) {
	const head = (
		<>
			Settle <b>{u}</b> at {num(d)}
			{again ? " (again)" : ""}.{" "}
		</>
	);
	const [next] = rest;
	let why: string;
	if (first) {
		why = `It is the only node in the queue, and the start is 0 away from itself, so its distance is final.`;
	} else if (again) {
		why = `It came back into the queue with a smaller distance, so its roads are tried again with the new value.`;
	} else if (negative) {
		why = reopen
			? `It is the smallest entry in the queue, but with a negative edge that no longer proves it is final, so it may be re-opened later.`
			: `It is the smallest entry in the queue, so Dijkstra now treats ${u} as final. That is only guaranteed when no edge is negative.`;
	} else if (!next) {
		why = `It is the last entry in the queue, and every road out of the settled nodes has been tried, so nothing can improve it.`;
	} else {
		const place =
			next[1] === d
				? `tied with ${next[0]}, and ties go to the alphabetically first`
				: `the next is ${next[0]} at ${num(next[1])}`;
		why = `It is the smallest entry (${place}). Suppose a shorter route to ${u} existed. Its first unsettled node already holds a distance no larger than the route's cost up to there, because the settled node before it relaxed that road. That entry is at least ${num(d)} (${u} is the smallest), and the rest of the route adds nothing negative, so the route costs at least ${num(d)}. ${u}'s distance is final.`;
	}
	return (
		<>
			{head}
			{why}
		</>
	);
}

interface Note {
	verdict: RoadState;
	road: string;
	text: string;
}

function relaxCaption(u: string, notes: Note[], settledSkips: string[]) {
	const skip = settledSkips.length
		? ` Already settled, nothing to do: ${settledSkips.join(", ")}.`
		: "";
	if (!notes.length) {
		return (
			<>
				Relax the roads out of <b>{u}</b>: none lead to an unsettled node.{skip}
			</>
		);
	}
	return (
		<>
			Relax the roads out of <b>{u}</b>: distance of {u} plus the road's weight, compared with what
			the neighbour has now.
			<ul class="relax">
				{notes.map((n) => (
					<li class={n.verdict === "missed" ? "bad" : undefined}>
						<b>{n.road}</b>: {n.text}
					</li>
				))}
			</ul>
			{skip}
		</>
	);
}

function doneCaption(g: Graph, start: string, step: Step, negative: boolean, reopened: boolean) {
	const ids = g.nodes.map((n) => n.id);
	if (negative) {
		const wrong = ids.filter((n) => step.dist[n] !== step.wanted[n]);
		if (wrong.length) {
			return `Queue empty, but ${wrong.join(" and ")} ${wrong.length > 1 ? "are" : "is"} wrong. The “True” column shows the real shortest distances. ${wrong[0]} was settled before the cheaper route through B had been found, and a settled node is never revisited.`;
		}
		return `Queue empty, and every distance matches the “True” column. ${reopened ? "Re-opening kept the answer correct." : "No settled node was ever improved afterwards, so the settled-is-final rule held and nothing had to be re-opened."}`;
	}
	const unreached = ids.filter((n) => step.dist[n] === Infinity);
	const caption =
		"Queue empty. Every reachable node is settled, and each distance was final the moment it was settled. Follow the Via column back to read off a route.";
	if (!unreached.length) {
		return caption;
	}
	return `${caption} ${unreached.join(", ")} stayed at ∞: no route from ${start} reaches ${unreached.length > 1 ? "them" : "it"}, which is different from a long route.`;
}

/** The algorithm's working state, which each snapshot copies. */
interface Search {
	dist: Record<string, number>;
	prev: Record<string, string>;
	settled: Set<string>;
	queued: Set<string>;
	exposed: Set<string>;
}

const distOf = (s: Search, n: string) => s.dist[n] ?? Infinity;

/** The queue, smallest distance first, ties to the alphabetically first node. */
const queueOf = (s: Search): [string, number][] =>
	[...s.queued]
		.sort((a, b) => distOf(s, a) - distOf(s, b) || (a < b ? -1 : 1))
		.map((n) => [n, distOf(s, n)]);

/** What relaxing the roads out of one node did: one caption note per road tried, settled neighbours skipped. */
interface Relaxed {
	notes: Note[];
	edges: Record<number, RoadState>;
	changed: Set<string>;
	skips: string[];
}

/** Tries the road u→v: improves v, keeps it, or (v settled, no re-opening) misses the better route. */
function relaxRoad(
	s: Search,
	out: Relaxed,
	road: string,
	u: string,
	v: string,
	w: number,
	i: number,
	reopen: boolean,
) {
	const cand = distOf(s, u) + w;
	const old = distOf(s, v);
	const sum = `${num(distOf(s, u))} + ${num(w)} = ${num(cand)}`;
	if (cand >= old) {
		if (s.settled.has(v)) {
			out.skips.push(v);
		} else {
			out.edges[i] = "kept";
			out.notes.push({
				verdict: "kept",
				road,
				text: `${sum} does not beat ${v}'s ${num(old)}. Keep ${num(old)}.`,
			});
		}
	} else if (s.settled.has(v) && !reopen) {
		out.edges[i] = "missed";
		s.exposed.add(v);
		out.notes.push({
			verdict: "missed",
			road,
			text: `${sum} would beat ${v}'s ${num(old)}, but ${v} is settled and Dijkstra never looks at a settled node again. ${v} stays at ${num(old)}, and so does everything reached through ${v}.`,
		});
	} else {
		const beats = s.settled.has(v)
			? `${v}'s settled ${num(old)}, so ${v} goes back in the queue at ${num(cand)}`
			: `${num(old)}, so ${v} = ${num(cand)} via ${u}`;
		out.notes.push({ verdict: "improved", road, text: `${sum} beats ${beats}.` });
		s.dist[v] = cand;
		s.prev[v] = u;
		s.settled.delete(v);
		s.queued.add(v);
		out.edges[i] = "improved";
		out.changed.add(v);
	}
}

/**
 * Runs Dijkstra from `start` and returns one snapshot per step: the start, then a settle and a relax step per node taken
 * from the queue, then the end. With `reopen`, a settled node that a later road improves goes back into the queue.
 */
export function run(g: Graph, start: string, reopen: boolean): Step[] {
	const s: Search = {
		dist: { ...everyNode(g, Infinity), [start]: 0 },
		prev: {},
		settled: new Set(),
		queued: new Set([start]),
		exposed: new Set(),
	};
	const negative = g.edges.some(([, , w]) => w < 0);
	const wanted = truth(g, start);
	const steps: Step[] = [];
	const snap = (extra: Pick<Step, "kind" | "lines" | "caption"> & Partial<Step>) => {
		const step: Step = {
			dist: { ...s.dist },
			prev: { ...s.prev },
			settled: new Set(s.settled),
			exposed: new Set(s.exposed),
			queue: queueOf(s),
			wanted,
			current: null,
			edges: {},
			changed: new Set(),
			...extra,
		};
		steps.push(step);
		return step;
	};

	snap({
		kind: "init",
		lines: [1, 2],
		changed: new Set([start]),
		caption: (
			<>
				Start at <b>{start}</b>: distance 0. Every other node is ∞ (no route known yet), and only{" "}
				{start} is in the queue.
			</>
		),
	});
	const seen = new Set<string>();
	for (let [entry, ...rest] = queueOf(s); entry; [entry, ...rest] = queueOf(s)) {
		const [u, d] = entry;
		const again = seen.has(u);
		const first = seen.size === 0;
		s.queued.delete(u);
		s.settled.add(u);
		seen.add(u);
		const settling = { u, d, rest, first, negative, again, reopen };
		snap({
			kind: "settle",
			lines: [3, 4],
			current: u,
			changed: new Set([u]),
			caption: settleCaption(settling),
		});

		const out: Relaxed = { notes: [], edges: {}, changed: new Set(), skips: [] };
		for (const { v, w, i } of outRoads(g, u)) {
			relaxRoad(s, out, roadName(g, u, v), u, v, w, i, reopen);
		}
		const caption = relaxCaption(u, out.notes, out.skips);
		snap({
			kind: "relax",
			lines: [5, 6, 7, 8],
			current: u,
			edges: out.edges,
			changed: out.changed,
			caption,
		});
	}
	const reopened = seen.size < steps.filter((x) => x.kind === "settle").length;
	const done = snap({ kind: "done", lines: [3], caption: "" });
	done.caption = doneCaption(g, start, done, negative, reopened);
	return steps;
}
