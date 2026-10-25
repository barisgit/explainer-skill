"use client";
import { Stepper } from "kit";
/* The page's two step-through explorers. Each reruns the algorithm when its controls change and draws the graph, queue,
   table and pseudocode for the step the Stepper reports. */
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import { num, run, type Step } from "./dijkstra.tsx";
import { type Graph, type GraphNode, MAPS, mapGraph, negGraph } from "./graphs.ts";

/** Node radius in SVG units. */
const R = 26;
const ROAD_STATES = ["base", "tent", "tree", "improved", "kept", "missed"];
const NODE_STATES = {
	unseen: "not reached",
	queued: "in queue",
	current: "settled now",
	settled: "settled",
};
type NodeState = keyof typeof NODE_STATES;

function stateOf(s: Step, n: string): NodeState {
	if (s.current === n) {
		return "current";
	}
	if (s.settled.has(n)) {
		return "settled";
	}
	return s.queue.some(([q]) => q === n) ? "queued" : "unseen";
}

/** A road's state at a step: what relaxing did to it, else whether it is on a settled ("tree") or queued ("tent") best route. */
function roadState(g: Graph, s: Step, i: number): string {
	const edge = g.edges[i];
	const relaxed = s.edges[i];
	if (relaxed || !edge) {
		return relaxed ?? "";
	}
	const onRoute = (u: string, v: string) =>
		s.prev[v] === u ? (s.settled.has(v) ? "tree" : "tent") : "";
	const [a, b] = edge;
	return onRoute(a, b) || (g.directed ? "" : onRoute(b, a));
}

/** Where a node's distance label goes: the 45° direction (up first) farthest from every road at the node, so it never sits on a line. */
function labelOffset(n: GraphNode, neighbours: GraphNode[]): [number, number] {
	const roads = neighbours.map((q) => Math.atan2(q.y - n.y, q.x - n.x));
	const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
	let best = -Math.PI / 2;
	let room = -1;
	for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
		const angle = -Math.PI / 2 + (k * Math.PI) / 4;
		const free = Math.min(Math.PI, ...roads.map((r) => gap(angle, r)));
		if (free > room + 1e-6) {
			[best, room] = [angle, free];
		}
	}
	const reach = R + 15;
	return [Math.round(Math.cos(best) * reach), Math.round(Math.sin(best) * reach)];
}

/** Tight viewBox around the nodes, with room for the distance labels beside them. */
function viewBox({ nodes }: Graph) {
	const xs = nodes.map((n) => n.x);
	const ys = nodes.map((n) => n.y);
	const pad = R + 32;
	const x = Math.min(...xs) - pad;
	const y = Math.min(...ys) - pad;
	return `${x} ${y} ${Math.max(...xs) + pad - x} ${Math.max(...ys) + pad - y}`;
}

interface Painted {
	id: string;
	graph: Graph;
	step: Step;
	wrong: (n: string) => boolean;
	label: string;
}

function GraphSvg({ id, graph: g, step: s, wrong, label }: Painted) {
	const pos = new Map(g.nodes.map((n) => [n.id, n]));
	const neighbours = (node: string) =>
		g.edges
			.flatMap(([a, b]) => (a === node ? [b] : b === node ? [a] : []))
			.flatMap((n) => pos.get(n) ?? []);
	return (
		<svg class="gsvg" viewBox={viewBox(g)} role="img" aria-label={label}>
			{/* One arrowhead per road state: a marker cannot take its colour from the line it sits on. */}
			{g.directed && (
				<defs>
					{ROAD_STATES.map((state) => (
						<marker
							id={`${id}-arrow-${state}`}
							viewBox="0 0 10 10"
							refX="9"
							refY="5"
							markerWidth="14"
							markerHeight="14"
							markerUnits="userSpaceOnUse"
							orient="auto"
						>
							<path class="arrow" data-state={state} d="M0 0 10 5 0 10z" />
						</marker>
					))}
				</defs>
			)}
			{g.edges.map(([a, b, w], i) => {
				const p = pos.get(a);
				const q = pos.get(b);
				if (!p || !q) {
					return null;
				}
				// A one-way road stops short of its node, so the arrowhead shows.
				const trim = g.directed ? (R + 4) / Math.hypot(q.x - p.x, q.y - p.y) : 0;
				const state = roadState(g, s, i);
				return (
					<g class="edge" data-state={state}>
						<line
							x1={p.x}
							y1={p.y}
							x2={q.x - (q.x - p.x) * trim}
							y2={q.y - (q.y - p.y) * trim}
							marker-end={g.directed ? `url(#${id}-arrow-${state || "base"})` : undefined}
						/>
						<text x={(p.x + q.x) / 2} y={(p.y + q.y) / 2}>
							{num(w)}
						</text>
					</g>
				);
			})}
			{g.nodes.map((n) => {
				const [dx, dy] = labelOffset(n, neighbours(n.id));
				return (
					<g
						class={s.changed.has(n.id) ? "node changed" : "node"}
						data-state={stateOf(s, n.id)}
						data-wrong={wrong(n.id) ? "" : undefined}
						transform={`translate(${n.x} ${n.y})`}
					>
						<circle r={R} />
						<text class="name">{n.id}</text>
						<text class="dist" x={dx} y={dy}>
							{num(s.dist[n.id] ?? Infinity)}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

function Queue({ step: s }: { step: Step }) {
	const taken = s.current && s.kind !== "done" ? s.current : null;
	return (
		<ol class="queue" aria-live="polite">
			{taken && (
				<>
					<li class="popped">
						<b>{taken}</b>
						{num(s.dist[taken] ?? Infinity)}
					</li>
					<li class="none sep">taken out</li>
				</>
			)}
			{s.queue.map(([n, d]) => (
				<li class={s.changed.has(n) && s.kind === "relax" ? "changed" : undefined}>
					<b>{n}</b>
					{num(d)}
				</li>
			))}
			{!s.queue.length && <li class="none">empty</li>}
		</ol>
	);
}

function DistTable({ graph, step: s, wrong, showTruth }: Painted & { showTruth: boolean }) {
	return (
		<table class="dist-table">
			<thead>
				<tr>
					<th>Node</th>
					<th>Distance</th>
					<th>Via</th>
					<th>State</th>
					{showTruth && <th>True</th>}
				</tr>
			</thead>
			<tbody>
				{graph.nodes.map(({ id }) => {
					const state = stateOf(s, id);
					const bad = wrong(id) ? "bad" : undefined;
					return (
						<tr class={s.changed.has(id) ? "changed" : undefined}>
							<th scope="row">{id}</th>
							<td class={bad}>{num(s.dist[id] ?? Infinity)}</td>
							<td>{s.prev[id] ?? "–"}</td>
							<td class={state === "unseen" ? "dim" : undefined}>{NODE_STATES[state]}</td>
							{showTruth && <td class={bad ?? "dim"}>{num(s.wanted[id] ?? Infinity)}</td>}
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

/**
 * The pseudocode, the lines in use at this step highlighted; `guard` adds the settled check that makes it Dijkstra rather
 * than re-opening. Unnamed: a pre cannot carry an accessible name, and the captions say in words what the step does.
 */
function Code({ step, guard }: { step: Step; guard: boolean }) {
	const lines: ComponentChildren[] = [
		"dist[all] = ∞;  dist[start] = 0",
		"queue = {start}",
		"while queue is not empty:",
		<>
			{"  u = pop smallest dist        "}
			<i>{"// settle"}</i>
		</>,
		<>
			{"  for each road u→v, weight w: "}
			<i>{"// relax"}</i>
		</>,
		`    if ${guard ? "v unsettled and " : ""}dist[u]+w < dist[v]:`,
		"      dist[v] = dist[u] + w",
		"      via[v] = u;  queue.update(v)",
	];
	return (
		<pre class="code">
			{lines.map((line, i) => (
				<span class={step.lines.includes(i + 1) ? "on" : undefined}>{line}</span>
			))}
		</pre>
	);
}

interface ExplorerProps {
	id: string;
	label: string;
	graph: Graph;
	steps: Step[];
	step: number;
	onStep: (step: number) => void;
	/** Dijkstra's settled check in the pseudocode; off when settled nodes may be re-opened. */
	guard: boolean;
	/** The "True" column, and red for a node settled at a wrong distance once a caption has said why. */
	showTruth: boolean;
	graphLabel: string;
	controls: ComponentChildren;
	caption: ComponentChildren;
}

/** One step-through figure: controls, the Stepper's player and captions, the graph beside the queue and table, the pseudocode. */
function Explorer(p: ExplorerProps) {
	const s = p.steps[Math.min(p.step, p.steps.length) - 1] ?? p.steps[0];
	if (!s) {
		return null;
	}
	const wrong = (n: string) =>
		p.showTruth &&
		s.settled.has(n) &&
		s.dist[n] !== s.wanted[n] &&
		(s.kind === "done" || s.exposed.has(n));
	const painted = { id: p.id, graph: p.graph, step: s, wrong, label: p.graphLabel };
	return (
		<Stepper id={p.id} class="fig wide" start={1} label={p.label} onStep={p.onStep}>
			<div class="controls">{p.controls}</div>
			{/* The captions come before the graph, so steps.js puts Back/Play/Next under the controls. */}
			<ol data-captions="">
				{p.steps.map((x) => (
					<li>{x.caption}</li>
				))}
			</ol>
			<div class="split">
				<div class="stage">
					<GraphSvg {...painted} />
				</div>
				<div class="side">
					<div>
						<p class="label">Priority queue, smallest first</p>
						<Queue step={s} />
					</div>
					<div class="scroll">
						<DistTable {...painted} showTruth={p.showTruth} />
					</div>
				</div>
			</div>
			<Code step={s} guard={p.guard} />
			<figcaption>{p.caption}</figcaption>
		</Stepper>
	);
}

/** A segmented radio switch. */
function Seg<T extends string>(props: {
	name: string;
	label: string;
	options: { value: T; text: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div class="seg" role="radiogroup" aria-label={props.label}>
			{props.options.map((o) => (
				<label>
					<input
						type="radio"
						name={props.name}
						value={o.value}
						checked={o.value === props.value}
						onChange={() => props.onChange(o.value)}
					/>
					<span>{o.text}</span>
				</label>
			))}
		</div>
	);
}

const KEY_STATES: [NodeState, string][] = [
	["unseen", "not reached (∞)"],
	["queued", "in the queue, distance so far"],
	["current", "being settled now"],
	["settled", "settled: distance is final"],
];

const MAIN = "main";

/** The main explorer: Dijkstra on a chosen map from a chosen start. A new map or start goes back to step 1. */
export function RoadMap() {
	const [mapId, setMapId] = useState("towns");
	const [start, setStart] = useState("A");
	const [step, setStep] = useState(1);
	const graph = mapGraph(mapId);
	const steps = useMemo(() => run(graph, start, false), [graph, start]);
	// The Stepper keeps its step when the steps change; this explorer restarts instead. Runs after the Stepper's own refresh.
	useLayoutEffect(() => {
		const figure = document.getElementById(MAIN);
		if (figure && typeof Steps !== "undefined") {
			Steps.refresh(figure, 1);
		}
	}, [steps]);
	const chooseMap = (id: string) => {
		const { nodes } = mapGraph(id);
		setMapId(id);
		setStart((s) => (nodes.some((n) => n.id === s) ? s : (nodes[0]?.id ?? s)));
	};
	const controls = (
		<>
			<div class="field">
				<span>Map</span>
				<Seg
					name="graph"
					label="Map"
					options={MAPS.map((m) => ({ value: m.id, text: m.name }))}
					value={mapId}
					onChange={chooseMap}
				/>
			</div>
			<div class="field">
				<span>Start at</span>
				<Seg
					name="start"
					label="Start node"
					options={graph.nodes.map((n) => ({ value: n.id, text: n.id }))}
					value={start}
					onChange={setStart}
				/>
			</div>
		</>
	);
	const caption = (
		<>
			<span class="key">
				{KEY_STATES.map(([state, text]) => (
					<span>
						<svg viewBox="-30 -30 60 60" aria-hidden="true">
							<g class="node" data-state={state}>
								<circle r="24" />
							</g>
						</svg>
						{text}
					</span>
				))}
			</span>
			<br />
			Roads work in both directions. Bold lines are the routes found to settled nodes; dashed blue
			lines are the best known routes to queued ones. Ties go to the alphabetically first node.
		</>
	);
	return (
		<Explorer
			id={MAIN}
			label="Dijkstra's algorithm on a small road map, step by step"
			graphLabel="The map: towns joined by roads with distances"
			graph={graph}
			steps={steps}
			step={step}
			onStep={setStep}
			guard={false}
			showTruth={false}
			controls={controls}
			caption={caption}
		/>
	);
}

/** The heading of the negative-edge section: what Dijkstra gets wrong with this weight, or why it is still right. */
function negHeading(w: number, steps: Step[]) {
	const last = steps.at(-1);
	const wrong = last ? Object.keys(last.dist).filter((n) => last.dist[n] !== last.wanted[n]) : [];
	const settles = steps.filter((x) => x.kind === "settle").map((x) => x.current);
	const twice = [...new Set(settles.filter((n, i) => settles.indexOf(n) !== i))];
	const list = (of: Record<string, number>) =>
		wrong.map((n) => `${n} = ${num(of[n] ?? Infinity)}`).join(" and ");
	if (last && wrong.length) {
		return `With B→A = ${num(w)}, Dijkstra ends with ${list(last.dist)}; the real shortest distances are ${list(last.wanted)}`;
	}
	if (twice.length) {
		return `With B→A = ${num(w)} and re-opening, the answer is right again, at the price of settling ${twice.join(" and ")} twice`;
	}
	return w < 0
		? `With B→A = ${num(w)} the answer is still right: the negative road never beats a distance that was already settled, so nothing needs to change`
		: `With B→A = ${num(w)}, Dijkstra is still right: no negative edge means no wrong answer`;
}

/** The negative-edge section's heading, lead and explorer: one road's weight and whether settled nodes may be re-opened. */
export function NegativeEdge() {
	const [w, setW] = useState(-2);
	const [reopen, setReopen] = useState<"no" | "yes">("no");
	const [step, setStep] = useState(1);
	const graph = useMemo(() => negGraph(w), [w]);
	const steps = useMemo(() => run(graph, "S", reopen === "yes"), [graph, reopen]);
	const controls = (
		<>
			<label class="field slider-field">
				<span>Weight of road B→A</span>
				<input
					type="range"
					id="neg-w"
					min="-5"
					max="3"
					step="1"
					value={w}
					onInput={(e) => setW(Number(e.currentTarget.value))}
				/>
				<output for="neg-w">{num(w)}</output>
			</label>
			<div class="field">
				<span>A settled node</span>
				<Seg
					name="reopen"
					label="What happens to a settled node that could be improved"
					options={[
						{ value: "no", text: "stays final (Dijkstra)" },
						{ value: "yes", text: "is re-opened" },
					]}
					value={reopen}
					onChange={setReopen}
				/>
			</div>
		</>
	);
	return (
		<>
			<h2>{negHeading(w, steps)}</h2>
			<p>
				Here the roads are one-way, and road B→A has a weight you can change. A negative weight
				means taking that road <em>reduces</em> the total, like a toll rebate. Drag it below −1 and
				watch which step breaks.
			</p>
			<Explorer
				id="neg"
				label="Dijkstra's algorithm on a graph with one negative edge, step by step"
				graphLabel="A directed graph with nodes S, A, B and C and one-way roads"
				graph={graph}
				steps={steps}
				step={step}
				onStep={setStep}
				guard={reopen === "no"}
				showTruth={true}
				controls={controls}
				caption="Arrows show the direction a road can be driven. “True” is the real shortest distance, computed separately with the Bellman–Ford algorithm; a red node was settled with a distance that is too large."
			/>
		</>
	);
}
