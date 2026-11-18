"use client";
/* The run of Dijkstra on the graph, one step per settled node. Order is the point, so it steps; the code lines it lights are marked in the page's code fence. */
import { Stepper } from "kit";
import { useState } from "preact/hooks";
import { type EdgeLook, Graph } from "./graph.tsx";
import { DIJKSTRA, distOf, TARGET } from "./model.ts";

const FRAMES = DIJKSTRA.frames;
/** B's distance when it is settled, which never changes after. */
const B = distOf(DIJKSTRA.dist, "B");
const key = (e: readonly [string, string, number]) => `${e[0]}>${e[1]}`;

/** Code marks each step lights: the start, then settle (and relax), settle, settle (and the skipped edge), the end. */
const REFS = FRAMES.map((f) => {
	if (!f.now) {
		return f === FRAMES[0] ? "init" : "";
	}
	const verdicts = f.now.edges.map((e) => e.verdict);
	return [
		"pick",
		verdicts.includes("lowered") ? "relax" : "",
		verdicts.includes("ignored") ? "skip" : "",
	]
		.filter(Boolean)
		.join(" ");
});

const CAPTIONS = [
	"Every distance starts at ∞ except the source, S: 0.",
	"S is the nearest queued node, so it is settled. Its edges set A to 2 and B to 3.",
	"A is nearest at 2. Settling it declares 2 final.",
	`B is settled at 3. Its edge to A would give ${B} − 2 = ${B - 2}, but A is settled and its edges are never looked at again.`,
	`Nothing is queued. Dijkstra reports ${TARGET} = ${DIJKSTRA.dist[TARGET]}.`,
];

export function Run() {
	const [step, setStep] = useState(1);
	const frame = FRAMES[step - 1] ?? FRAMES[0];
	const edges: Record<string, EdgeLook> = {};
	for (const { edge, verdict } of frame.now?.edges ?? []) {
		edges[key(edge)] = verdict === "ignored" ? "accent" : "ink";
	}
	const accent = frame.settled.includes(TARGET) ? [TARGET] : [];
	return (
		<Stepper
			start={1}
			refs={REFS}
			captions={CAPTIONS}
			captionsFirst={false}
			label="Dijkstra's run, one settled node per step"
			onStep={(s) => setStep(s)}
		>
			<Graph dist={frame.dist} settled={frame.settled} edges={edges} accent={accent} />
		</Stepper>
	);
}
