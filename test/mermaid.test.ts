import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderMermaid } from "../skills/explainer/src/mermaid.ts";
import {
	copiesOf,
	failureOf,
	packAndRun,
	packHtml,
	pageContract,
	runCli,
	scratch,
	svgOf,
} from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Packs an .mdx page whose body is one Mermaid fence of `source`; returns the CLI result and the output path. */
async function packFence(name: string, source: string) {
	const input = dir.write(`${name}.mdx`, `# Diagram\n\n\`\`\`mermaid\n${source}\n\`\`\`\n`);
	const output = dir.path(`${name}.out.html`);
	return { result: await runCli(["pack", input, "-o", output]), output };
}

test("a Mermaid fence renders to one SVG whose nodes and edges carry data-ref ids", async () => {
	const { result, output } = await packFence(
		"diagram",
		"flowchart TD\n  api e1@--> cache[(Cache)]\n  cache --> db",
	);

	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	expect(html).not.toContain("flowchart TD");
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
		const { result } = await packFence("paint", `flowchart LR\n  a --> b\n  ${line}`);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain(`mermaid block 1: the diagram references ${url}`);
	},
);

test("an unsupported diagram type fails the pack and says what to draw instead", async () => {
	const { result } = await packFence("pie", 'pie\n "a" : 1');

	expect(result.code).toBe(1);
	expect(result.stderr).toContain('mermaid block 1: "pie" diagrams are not supported');
	expect(result.stderr).toContain("the kit's Chart");
});

test("data-step on a Mermaid block fails the pack and points to linked highlighting", async () => {
	const input = dir.write(
		"stepped.html",
		`<!doctype html><html><body><figure class="fig" data-stepper><pre class="mermaid" data-step="1">flowchart LR\n  a --> b</pre></figure></body></html>`,
	);

	const packed = await packHtml(input, dir.path("stepped.out.html"));

	expect(packed.error).toContain(
		'mermaid block 1: diagrams do not step; drop data-steps, show the diagram whole and link its parts to the text with data-ref="<id>" (kit mermaid)',
	);
});

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
	{
		name: "a side input written after the node it feeds",
		axis: 0,
		source: `flowchart LR
	m[Message] --> x(("×"))
	c[Carrier] --> x
	x --> f[Filter]`,
		forward: ["m>x", "c>x", "x>f"],
	},
	{
		name: "inputs written after a subgraph they feed",
		axis: 1,
		source: `flowchart TD
	subgraph g[Group]
		m[Merge] --> o[Out]
		s[Side] --> m
	end
	i[In] --> m`,
		forward: ["m>o", "s>m", "i>m"],
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

test("a loop's return edge leaves its node apart from the edges that enter it there", () => {
	const ends = edgeEnds(svgOf("flowchart LR\n  send --> wait\n  wait --> send\n  timer --> wait"));
	const back = ends.get("wait>send")?.start;
	expect(back).toBeDefined();
	for (const key of ["send>wait", "timer>wait"]) {
		expect({ key, end: ends.get(key)?.end }).not.toEqual({ key, end: back });
	}
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
	const ends = edgeEnds(svg);
	// Without every edge, a pattern that matched none would leave the loop below nothing to check.
	expect([...ends.keys()].sort()).toEqual(["emit>lex", "lex>parse", "opt>emit", "parse>opt"]);
	for (const [key, { start, end }] of ends) {
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

/** The number in attribute `name` of the first `tag` drawn for node `id`. */
function shapeAttr(svg: string, id: string, tag: string, name: string): number {
	const shape = svg.match(new RegExp(`data-id="${id}"[^>]*>\\s*<${tag} [^>]*`))?.[0] ?? "";
	return Number(shape.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1]);
}

test.each(["×", "Σ", "AB"])(
	"a circle around %p is no taller than the box beside it and its padding",
	(label) => {
		const svg = svgOf(`flowchart LR\n  a[Input] --> m(("${label}")) --> o[Output]`);
		const diameter = 2 * shapeAttr(svg, "m", "circle", "r");
		expect(diameter).toBeLessThanOrEqual(shapeAttr(svg, "a", "rect", "height") + 10);
	},
);

test("a circle still holds a long label", () => {
	const svg = svgOf("flowchart LR\n  a[Mixer stage] --> m((Mixer stage))");
	// The box is the label's width plus 20 px of padding a side.
	const labelWidth = shapeAttr(svg, "a", "rect", "width") - 40;
	expect(2 * shapeAttr(svg, "m", "circle", "r")).toBeGreaterThan(labelWidth + 10);
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

test("a generated edge id counts every edge between its two nodes, named ones too", () => {
	const svg = svgOf(
		"flowchart LR\n  A first@-->|primary| B\n  A -->|retry| B\n  A -->|fallback| B",
	);
	const lines = [
		...svg.matchAll(/<polyline class="edge"[^>]* data-ref="([^"]*)"[^>]* data-label="([^"]*)"/g),
	];
	const labels = [
		...svg.matchAll(/<g class="edge-label"[^>]* data-ref="([^"]*)"[^>]* data-label="([^"]*)"/g),
	];

	const expected = [
		["first", "primary"],
		["L_A_B_1", "retry"],
		["L_A_B_2", "fallback"],
	];
	expect(lines.map((m) => [m[1], m[2]])).toEqual(expected);
	expect(labels.map((m) => [m[1], m[2]])).toEqual(expected);
});

test("edges whose generated ids would read alike get different ones, and an author's id stays as written", () => {
	const svg = svgOf("flowchart LR\n  A_B --> C\n  A --> B_C\n  x L_A_B_C_1@--> y");
	const lines = [...svg.matchAll(/<polyline class="edge"[^>]* data-ref="([^"]*)"/g)].map(
		(m) => m[1],
	);

	expect(lines).toEqual(["L_A_B_C_0", "L_A_B_C_2", "L_A_B_C_1"]);
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
		instead: "a flowchart for parts and links, or the kit's Chart for numbers",
	},
])("an unsupported $type says what to draw instead", ({ type, instead }) => {
	expect(failureOf(`${type}\n  a`)).toEndWith(`; draw it as ${instead}`);
});

test("<br> in a fence label breaks the line, as in Mermaid", async () => {
	const { result, output } = await packFence("br", 'flowchart LR\n  a["one<br>two"] --> b');

	expect(result.code).toBe(0);
	const html = readFileSync(output, "utf8");
	expect(html).toMatch(/>one<\/tspan><tspan[^>]*>two</);
	expect(html).not.toContain("onetwo");
	expect(html).not.toMatch(/<br\s*\/?>/);
});

const PIPELINE = `flowchart LR
	src["Raw readings"] --> clean["Drop outliers"]
	clean --> resample["Resample to 1 min"]
	resample --> fill{"Gaps?"}
	fill -->|"short"| interp["Interpolate"]
	fill -->|"long"| flag["Flag as missing"]
	interp --> store[("Store")]
	flag --> store`;

/** A flowchart a phone shows top-down but A4 paper fits as written. */
const SHORT_FLOW = "flowchart LR\n  a[Collect] --> b[Clean] --> c[Model] --> d[Report]";

const SEQUENCE = `sequenceDiagram
	participant B as Browser
	participant S as Server
	participant C as Cache
	participant D as Database
	B->>S: GET /report
	S->>C: lookup report
	C-->>S: miss
	S->>D: query rows
	D-->>S: rows
	S-->>B: 200 OK`;

test("a flowchart too wide for a phone carries a top-down copy with its own ids and the same parts; one that fits does not", () => {
	const [wide = "", phone = ""] = copiesOf(PIPELINE);
	const refs = (svg: string) => [...svg.matchAll(/ data-ref="([^"]*)"/g)].map((m) => m[1]).sort();
	const height = (svg: string) => Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)?.[1]);

	expect(phone).toStartWith('<svg data-phone data-print id="mm0-phone"');
	expect(phone.match(/ id="[^"]+"/g)?.every((id) => id.startsWith(' id="mm0-phone'))).toBe(true);
	expect(refs(phone)).toEqual(refs(wide));
	expect(height(phone)).toBeGreaterThan(2 * height(wide));
	expect(copiesOf("flowchart LR\n  a[Input] --> b[Output]")).toHaveLength(1);
	expect(copiesOf(SEQUENCE)).toHaveLength(1);
	expect(copiesOf(SHORT_FLOW)[1]).toStartWith('<svg data-phone id="mm0-phone"');
});

/** A page of Mermaid blocks with the theme and link.js, whose pageContract runs `checks`. */
const diagramPage = (body: string, checks: Record<string, string>) =>
	`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>${body}</main><script src="kit:link.js"></script><script>${pageContract(checks)}</script></body></html>`;

test("on a phone a wide flowchart shows its top-down copy, and a wide sequence keeps 10 px text and scrolls sideways", async () => {
	const page = diagramPage(
		`<pre class="mermaid" id="flow">${PIPELINE}</pre>\n<pre class="mermaid" id="seq">${SEQUENCE}</pre>`,
		{
			"the phone copy shows on phones only, in the diagram's place": `(() => {
			const phone = innerWidth < 640;
			const [wide, copy] = document.querySelectorAll("#flow > svg");
			const shows = (svg) => getComputedStyle(svg).display !== "none";
			return copy.matches("[data-phone]") && shows(copy) === phone && shows(wide) === !phone;
		})()`,
			"no shown diagram text is under 10 px": `[...document.querySelectorAll(".mermaid > svg")]
			.filter((svg) => getComputedStyle(svg).display !== "none")
			.every((svg) => [...svg.querySelectorAll("text")].every((t) => parseFloat(getComputedStyle(t).fontSize) * svg.getScreenCTM().a > 9.99))`,
			"the sequence scrolls sideways on phones only": `(innerWidth < 640) === (document.querySelector("#seq").scrollWidth > document.querySelector("#seq").clientWidth + 1)`,
			"a diagram and its phone copy do not link each other's parts": `!document.querySelector(".is-linked")`,
		},
	);

	expect(await packAndRun(dir, "phone", page)).toEqual([]);
}, 30_000);

test("on paper every diagram prints whole as one copy, the top-down one where the wide one would be too small to read", async () => {
	const participants = Array.from(
		{ length: 10 },
		(_, i) => `  participant P${i} as Participant ${i}`,
	);
	const messages = Array.from({ length: 9 }, (_, i) => `  P${i}->>P${i + 1}: step ${i}`);
	const page = diagramPage(
		[
			`<pre class="mermaid" id="seq">sequenceDiagram\n${[...participants, ...messages].join("\n")}</pre>`,
			`<pre class="mermaid" id="flow">${PIPELINE}</pre>`,
			`<pre class="mermaid" id="short">${SHORT_FLOW}</pre>`,
		].join("\n"),
		{
			"each diagram prints one copy": `[...document.querySelectorAll(".mermaid")].every((block) =>
				[...block.children].filter((svg) => getComputedStyle(svg).display !== "none").length === 1)`,
			"each printed copy fits its block, which does not scroll": `[...document.querySelectorAll(".mermaid")].every((block) => {
				const box = getComputedStyle(block);
				const column = block.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
				return block.scrollWidth <= block.clientWidth + 1
					&& [...block.children].every((svg) => svg.getBoundingClientRect().width <= column + 1);
			})`,
			"a flowchart too wide to read on paper prints top-down": `getComputedStyle(document.querySelector("#flow > svg[data-phone]")).display !== "none"`,
			"one that reads at the paper's width prints as on a wide screen": `getComputedStyle(document.querySelector("#short > svg:not([data-phone])")).display !== "none"`,
		},
	);

	// A4 with Chrome's default margins: the page box is 717 px wide.
	const paper = { width: 717, height: 1123, mobile: false };
	expect(await packAndRun(dir, "paper", page, { media: "print", widths: [paper] })).toEqual([]);
}, 30_000);
