import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderMermaid } from "../skills/explainer/src/mermaid.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const page = (body: string) =>
	`<!doctype html><html><head><link rel="stylesheet" href="kit:theme.css"></head><body>${body}</body></html>`;

test("a Mermaid block renders to one SVG whose nodes and edges carry data-ref ids", async () => {
	const input = dir.write(
		"diagram.html",
		page(`<pre class="mermaid">flowchart TD
  api e1@--> cache[(Cache)]
  cache --> db</pre>`),
	);
	const output = dir.path("diagram.out.html");

	const result = await runCli(["pack", input, "-o", output]);

	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	expect(html).not.toContain('class="mermaid">flowchart');
	expect(html.match(/<svg /g)).toHaveLength(1);
	for (const ref of ["api", "cache", "db", "e1", "L_cache_db_0"]) {
		expect(html).toContain(`data-ref="${ref}"`);
	}
	expect(html).not.toContain("fonts.googleapis.com");
});

test("an unsupported diagram type fails the pack and says what to draw instead", async () => {
	const input = dir.write("pie.html", page(`<pre class="mermaid">pie\n "a" : 1</pre>`));

	const result = await runCli(["pack", input, "-o", dir.path("pie.out.html")]);

	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain('mermaid block 1: "pie" diagrams are not supported');
	expect(result.stderr).toContain("kit:charts.js");
});

test("data-steps on a Mermaid block fails the pack and points to linked highlighting", async () => {
	const input = dir.write(
		"stepped.html",
		page(
			`<figure class="fig" data-stepper><pre class="mermaid" data-steps="a:1 b:2">flowchart LR\n  a --> b</pre></figure>`,
		),
	);

	const result = await runCli(["pack", input, "-o", dir.path("stepped.out.html")]);

	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain(
		'mermaid block 1: diagrams do not step; drop data-steps, show the diagram whole and link its parts to the text with data-ref="<id>" (kit mermaid)',
	);
});

/** The rendered diagram's SVG, failing the test when the source does not render. */
function svgOf(source: string): string {
	const [diagram = new Error("no diagram")] = renderMermaid([source]);
	if (diagram instanceof Error) {
		throw diagram;
	}
	return diagram.svg;
}

/** Each edge's endpoints, keyed "from>to"; a repeated pair keeps its last edge. */
function edgeEnds(svg: string): Map<string, { start: number[]; end: number[] }> {
	const ends = new Map<string, { start: number[]; end: number[] }>();
	for (const [, from, to, points = ""] of svg.matchAll(
		/data-from="([^"]+)" data-to="([^"]+)"[^>]* points="([^"]+)"/g,
	)) {
		const xy = points.split(" ").map((point) => point.split(",").map(Number));
		ends.set(`${from}>${to}`, { start: xy[0] ?? [], end: xy.at(-1) ?? [] });
	}
	return ends;
}

const readingOrder = [
	{
		name: "a loop back to an earlier node",
		axis: 1,
		source: `flowchart TD
	clump["4 customers in one minute"] --> backlog["Backlog"]
	backlog --> spare{"Spare time?"}
	spare -->|"50% busy"| calm["Cleared in 12 minutes"]
	spare -->|"90% busy"| slow["Cleared in 60 minutes"]
	slow --> stack["Next clump stacks on top"]
	stack --> backlog`,
		forward: ["clump>backlog", "backlog>spare", "spare>calm", "spare>slow", "slow>stack"],
	},
	{
		name: "a loop back into a subgraph written first",
		axis: 0,
		source: `flowchart LR
	subgraph client["Browser"]
		type["User types the password"] --> hash(["Hash on the server"])
	end
	hash --> match{"Does the token match?"}
	match -->|"yes"| session[("Session")]
	match -.->|"no, try again"| type
	session ==> done(("Done"))`,
		forward: ["type>hash", "hash>match", "match>session", "session>done"],
	},
	{
		name: "a loop inside a composite state",
		axis: 1,
		source: `stateDiagram-v2
	[*] --> Off
	Off --> On: power
	state On {
		[*] --> Idle
		Idle --> Busy: job
		Busy --> Idle: done
	}
	On --> Off: power`,
		forward: ["_start>Off", "_start2>Idle", "Idle>Busy"],
	},
];

test.each(readingOrder)("$name lays out in reading order", ({ source, axis, forward }) => {
	const ends = edgeEnds(svgOf(source));
	const backwards = forward.filter((key) => {
		const edge = ends.get(key);
		return !edge || (edge.end[axis] ?? 0) <= (edge.start[axis] ?? 0);
	});
	expect(backwards).toEqual([]);
});

test("an edge between levels of a nested subgraph starts and ends at its nodes", () => {
	const svg = svgOf(`flowchart LR
	subgraph outer[Pipeline]
		lex[Lex] --> parse[Parse]
		subgraph inner[Backend]
			opt[Optimise] --> emit[Emit]
		end
		parse --> opt
	end
	emit -.-> lex`);
	const boxes = new Map(
		[
			...svg.matchAll(
				/data-id="([^"]+)"[^>]*>\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g,
			),
		].map(([, id = "", ...box]) => [id, box.map(Number)]),
	);
	const touches = (id: string, [x = 0, y = 0]: number[]) => {
		const [left = 0, top = 0, width = 0, height = 0] = boxes.get(id) ?? [];
		return x >= left - 1 && x <= left + width + 1 && y >= top - 1 && y <= top + height + 1;
	};
	for (const [key, { start, end }] of edgeEnds(svg)) {
		const [from = "", to = ""] = key.split(">");
		expect({ key, start: touches(from, start), end: touches(to, end) }).toEqual({
			key,
			start: true,
			end: true,
		});
	}
});

test("a node's later shaped definition sets its label, as in Mermaid", () => {
	expect(svgOf("flowchart LR\n  a --> b\n  b[Bee]")).toContain('data-label="Bee"');
	expect(svgOf('stateDiagram-v2\n  Idle --> Busy\n  state "Waiting" as Idle')).toContain(
		'data-label="Waiting"',
	);
});

test("a long label wraps at Mermaid's 200 px, so a diagram keeps its size on a phone", () => {
	const svg = svgOf(
		"flowchart LR\n  a[A long label that keeps going well past the width a node would normally take before wrapping] --> b",
	);
	const node = svg.match(/data-id="a"[^>]*>\s*<rect [^>]*\swidth="([^"]+)"[\s\S]*?<\/g>/);
	expect(Number(node?.[1])).toBeLessThan(250);
	expect(node?.[0].match(/<tspan/g)?.length).toBeGreaterThanOrEqual(3);
});

const misrenders = [
	{
		name: "an edge with no target",
		input: "flowchart LR\n  a --> b\n  b -->",
		message: '"b -->" has no target node; write it as "b --> next", naming the node it points to',
	},
	{
		name: "an edge with no source",
		input: "flowchart LR\n  a --> b\n  --> b",
		message: '"--> b" has no source node; write it as "prev --> b", naming the node it starts from',
	},
	{
		name: "a message with one participant",
		input: "sequenceDiagram\n  A->>B: hi\n  A->>: oops",
		message:
			'"A->>: oops" is missing a participant; write it as "A->>B: oops", sender before the arrow and receiver after',
	},
	{
		name: "a markdown string",
		input: 'flowchart LR\n  a["`**bold** text`"] --> b',
		message:
			'markdown strings ("`...`") are not supported; drop the backticks: a["**bold** and *italic*"] still renders',
	},
];

test.each(misrenders)("$name fails with what to write instead", ({ input, message }) => {
	const [diagram] = renderMermaid([input]);
	expect(diagram instanceof Error ? diagram.message : "rendered").toBe(message);
});
