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

const remotePaints = [
	{
		name: "a node style",
		line: "style a fill:url(https://example.com/p.svg#g)",
		url: "https://example.com/p.svg#g",
	},
	{
		name: "a class",
		line: "classDef hot stroke:url('//example.com/p.svg#g')\n  class a hot",
		url: "//example.com/p.svg#g",
	},
	{
		name: "a link style",
		line: "linkStyle 0 stroke:url(http://example.com/p.svg#g)",
		url: "http://example.com/p.svg#g",
	},
	{
		name: "a CSS-escaped url",
		line: "style a fill:\\75 rl(https://example.com/p.svg#g)",
		url: "https://example.com/p.svg#g",
	},
	{
		name: "a url escaped with a form feed",
		line: "style a fill:\\75\frl(https://example.com/p.svg#g)",
		url: "https://example.com/p.svg#g",
	},
];

test.each(remotePaints)(
	"a remote paint URL in $name fails the pack and names it",
	async ({ line, url }) => {
		const input = dir.write(
			"paint.html",
			page(`<pre class="mermaid">flowchart LR\n  a --> b\n  ${line}</pre>`),
		);

		const result = await runCli(["pack", input, "-o", dir.path("paint.out.html")]);

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(`mermaid block 1: the diagram references ${url}`);
	},
);

test("an unsupported diagram type fails the pack and says what to draw instead", async () => {
	const input = dir.write("pie.html", page(`<pre class="mermaid">pie\n "a" : 1</pre>`));

	const result = await runCli(["pack", input, "-o", dir.path("pie.out.html")]);

	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain('mermaid block 1: "pie" diagrams are not supported');
	expect(result.stderr).toContain("kit:charts.js");
});

test.each([
	'data-steps="a:1 b:2"',
	"DATA-STEPS='a:1'",
	'data-steps = "a:1"',
	"data-steps",
	"data-step=1",
])("%s on a Mermaid block fails the pack and points to linked highlighting", async (attribute) => {
	const input = dir.write(
		"stepped.html",
		page(
			`<figure class="fig" data-stepper><pre class=mermaid ${attribute}>flowchart LR\n  a --> b</pre></figure>`,
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
	const diagram = renderMermaid(source);
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
	const diagram = renderMermaid(input);
	expect(diagram instanceof Error ? diagram.message : "rendered").toBe(message);
});

/** The message a source fails with, or "rendered". */
function failureOf(source: string): string {
	const diagram = renderMermaid(source);
	return diagram instanceof Error ? diagram.message : "rendered";
}

const unreadable = [
	{ name: "a cross end", input: "flowchart LR\n  a --x b", unread: "--x b", hint: '"-->"' },
	{ name: "a circle end", input: "flowchart LR\n  a --o b", unread: "--o b", hint: '"-->"' },
	{
		name: "a new-style node shape",
		input: "flowchart LR\n  a@{ shape: rect } --> b",
		unread: "@{ shape: rect } --> b",
		hint: "leave it out",
	},
	{
		name: "a state note",
		input: "stateDiagram-v2\n  A --> B\n  note right of A: hi",
		unread: "note right of A: hi",
		hint: "leave it out",
	},
	{
		name: "a sequence title",
		input: "sequenceDiagram\n  title Login\n  A->>B: hi",
		unread: "title Login",
		hint: "leave it out",
	},
	{
		name: "a class note",
		input: 'classDiagram\n  A <|-- B\n  note for A "base"',
		unread: 'note for A "base"',
		hint: "leave it out",
	},
	{
		name: "an entity attribute without a name",
		input: "erDiagram\n  A {\n    string\n  }",
		unread: "string",
		hint: "leave it out",
	},
	{
		name: "an unknown xychart series",
		input: "xychart-beta\n  x-axis [a, b]\n  bar [1, 2]\n  area [1, 2]",
		unread: "area [1, 2]",
		hint: "leave it out",
	},
];

test.each(unreadable)("$name fails, naming what pack cannot read", ({ input, unread, hint }) => {
	const message = failureOf(input);
	expect(message).toContain(`pack cannot read "${unread}"`);
	expect(message).toContain(hint);
});

test("brackets inside a quoted label stay in the label, and its edge is kept", () => {
	const svg = svgOf('flowchart LR\n  a["Array [i]"] --> b');
	expect(svg).toContain('data-label="Array [i]"');
	expect(svg).toContain('data-from="a" data-to="b"');
});

test("longer links draw like the short ones", () => {
	const svg = svgOf("flowchart TD\n  a ---> b\n  b -..-> c\n  c ===> d\n  d ---- e");
	expect(svg.match(/<polyline class="edge"/g)).toHaveLength(4);
});

test("activate and deactivate lines draw the bar that + and - on the messages draw", () => {
	const signs = svgOf("sequenceDiagram\n  A->>+B: ask\n  B-->>-A: answer");
	const lines = svgOf(
		"sequenceDiagram\n  A->>B: ask\n  activate B\n  B-->>A: answer\n  deactivate B",
	);
	expect(signs).toContain('class="activation"');
	expect(lines).toBe(signs);
});

const activations = [
	{
		name: "an activation never ended",
		input: "sequenceDiagram\n  A->>+B: ask\n  B-->>A: answer",
		message:
			'B is activated but never deactivated; end it with "-" on a later message from B, e.g. "B-->>-A: done"',
	},
	{
		name: "a deactivation of an inactive participant",
		input: "sequenceDiagram\n  A->>B: ask\n  B-->>-A: answer",
		message:
			'B is deactivated but not active; start it with "+" on an earlier message to B, e.g. "A->>+B: ask"',
	},
	{
		name: "an activate line that follows no message to its participant",
		input: "sequenceDiagram\n  A->>B: ask\n  activate A",
		message:
			'pack cannot read "activate A"; activate and deactivate lines work right after a message to (or from) that participant, or mark the message: "A->>+B" starts B\'s bar, "B-->>-A" ends it',
	},
];

test.each(activations)("$name fails with what to write instead", ({ input, message }) => {
	expect(failureOf(input)).toBe(message);
});

/** Text as the renderer escapes it in content and attribute values. */
const escaped = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

test.each([
	"Use e1@--> syntax",
	"url(#cache) svg {",
	"--xychart-color-0: red;",
	"url(https://example.com/a.png)",
])("the label %p renders as written", (label) => {
	const { svg, refs } = (() => {
		const diagram = renderMermaid(`flowchart LR\n  a["${label}"] --> b`);
		if (diagram instanceof Error) {
			throw diagram;
		}
		return diagram;
	})();
	expect(svg).toContain(`data-label="${escaped(label)}"`);
	expect(svg).toContain(`>${escaped(label).replace(/&quot;/g, '"')}</text>`);
	expect(refs.sort()).toEqual(["L_a_b_0", "a", "b"]);
});

test("each of two edges between the same nodes keeps its own id on its line and its label", () => {
	const svg = svgOf("flowchart LR\n  a e1@--> b\n  a e2@-->|second| b");
	expect(svg.match(/<polyline class="edge"[^>]* data-ref="(e\d)"/g)?.length).toBe(2);
	expect(svg).toMatch(/<polyline class="edge"[^>]* data-ref="e2"[^>]* data-label="second"/);
	expect(svg).toMatch(/<g class="edge-label"[^>]* data-ref="e2"[^>]* data-label="second"/);
});

test("every rule of an xychart's stylesheet applies inside that chart only", () => {
	const svg = svgOf("xychart-beta\n  x-axis [a, b]\n  bar [1, 2]\n  line [2, 1]");
	const sheets = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "");
	const selectors = sheets.flatMap((css) =>
		[...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => (m[1] ?? "").split(",").map((s) => s.trim())),
	);

	expect(selectors.length).toBeGreaterThan(3);
	expect(selectors.filter((s) => !/^#mm0\b/.test(s))).toEqual([]);
});

test.each([
	{
		type: "block-beta",
		instead: "a flowchart with a subgraph per block group, or a CSS grid of boxes",
	},
	{
		type: "radar-beta",
		instead: "a flowchart for parts and links, or a chart with kit:charts.js for numbers",
	},
])("an unsupported $type says what to draw instead", ({ type, instead }) => {
	expect(failureOf(`${type}\n  a`)).toEndWith(`; draw it as ${instead}`);
});

test.each([
	["a literal", "<br>"],
	["a self-closing", "<br/>"],
	["an escaped", "&lt;br&gt;"],
])("%s <br> in a label breaks the line, as in Mermaid", async (_, br) => {
	const input = dir.write(
		"br.html",
		page(`<pre class="mermaid">flowchart LR\n  a["one${br}two"] --> b</pre>`),
	);
	const output = dir.path("br.out.html");

	const result = await runCli(["pack", input, "-o", output]);

	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	expect(html).toMatch(/>one<\/tspan><tspan[^>]*>two</);
	expect(html).not.toContain("onetwo");
	expect(html).not.toMatch(/<br\s*\/?>/);
});

test("a Mermaid block left open at the end of the page fails, with its data-step", async () => {
	const input = dir.write(
		"open.html",
		"<!doctype html><html><body><p>Before</p><pre class=mermaid data-step=1>flowchart LR\n  a --> b\n",
	);

	const result = await runCli(["pack", input, "-o", dir.path("open.out.html")]);

	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("mermaid block 1: diagrams do not step");
	expect(result.stderr).toContain(
		"mermaid block 1 has no end tag, so the rest of the page is its source: close it with </pre>",
	);
});
