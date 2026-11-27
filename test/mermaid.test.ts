import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderMermaid } from "../skills/explainer/src/mermaid.ts";
import {
	copiesOf,
	failureOf,
	inPage,
	packAndRun,
	packedMdx,
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
		expect(result.stderr).toContain(`mermaid block 1: pack cannot read "(`);
		expect(result.stderr).toContain(`${url}`);
		expect(result.stderr).toContain(
			"a paint from a URL cannot be drawn offline; use a plain colour",
		);
	},
);

test("an unsupported diagram type fails the pack and says what to draw instead", async () => {
	const { result } = await packFence("pie", 'pie\n "a" : 1');

	expect(result.code).toBe(1);
	expect(result.stderr).toContain('mermaid block 1: "pie" diagrams are not supported');
	expect(result.stderr).toContain("the kit's Chart");
});

test("data-step on a Mermaid block fails the pack and points to stepping through its refs", async () => {
	const input = dir.write(
		"stepped.html",
		`<!doctype html><html><body><figure class="fig" data-stepper><pre class="mermaid" data-step="1">flowchart LR\n  a --> b</pre></figure></body></html>`,
	);

	const packed = await packHtml(input, dir.path("stepped.out.html"));

	expect(packed.error).toContain(
		"mermaid block 1: a diagram steps through its parts' refs, not data-steps: drop the attribute, put the diagram in a Stepper and name the refs each step shows in its refs (kit Stepper)",
	);
});

type Point = [number, number];

/**
 * Each edge's ends by its ref: where its line starts, and the tip of the arrowhead at its end, else where its line ends. pele
 * ends a line short of its arrowhead, whose path starts at the tip.
 */
function edgeEnds(svg: string): Map<string, { start: Point; end: Point }> {
	const ends = new Map<string, { start: Point; end: Point }>();
	for (const [, ref = "", body = ""] of svg.matchAll(
		/<g class="pele-edge[^"]*" data-id="[^"]*" data-ref="([^"]+)">([\s\S]*?)<\/g>/g,
	)) {
		const xy = (/<path d="([^"]+)"/.exec(body)?.[1]?.match(/-?[\d.]+/g) ?? []).map(Number);
		const start: Point = [xy[0] ?? Number.NaN, xy[1] ?? Number.NaN];
		const last: Point = [xy.at(-2) ?? Number.NaN, xy.at(-1) ?? Number.NaN];
		const tips = [...body.matchAll(/class="pele-marker" d="M([\d.-]+),([\d.-]+)/g)].map(
			([, x, y]): Point => [Number(x), Number(y)],
		);
		const near = (p: Point) => Math.hypot(p[0] - last[0], p[1] - last[1]);
		const tip = tips.sort((a, b) => near(a) - near(b))[0];
		ends.set(ref, { start, end: tip && near(tip) < 12 ? tip : last });
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
		forward: [
			"L_clump_backlog_0",
			"L_backlog_spare_0",
			"L_spare_calm_0",
			"L_spare_slow_0",
			"L_slow_stack_0",
		],
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
		forward: ["L_type_hash_0", "L_hash_match_0", "L_match_session_0", "L_session_done_0"],
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
		forward: ["L__start_Off_0", "L_On_start_Idle_0", "L_Idle_Busy_0"],
	},
	{
		name: "a side input written after the node it feeds",
		axis: 0,
		source: `flowchart LR
	m[Message] --> x(("×"))
	c[Carrier] --> x
	x --> f[Filter]`,
		forward: ["L_m_x_0", "L_c_x_0", "L_x_f_0"],
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
		forward: ["L_m_o_0", "L_s_m_0", "L_i_m_0"],
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
	const back = ends.get("L_wait_send_0")?.start;
	expect(back).toBeDefined();
	for (const key of ["L_send_wait_0", "L_timer_wait_0"]) {
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
	// A node is drawn about its centre: translate(cx,cy) then a rect from (x, y) of that.
	const boxes = new Map(
		[
			...svg.matchAll(
				/class="pele-node[^"]*" data-id="([^"]+)"[^>]*transform="translate\(([\d.-]+),([\d.-]+)\)">\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g,
			),
		].map(([, id = "", cx, cy, x, y, width, height]) => [
			id,
			[Number(cx) + Number(x), Number(cy) + Number(y), Number(width), Number(height)],
		]),
	);
	const touches = (id: string, [x, y]: Point) => {
		const [left = 0, top = 0, width = 0, height = 0] = boxes.get(id) ?? [];
		return x >= left - 1 && x <= left + width + 1 && y >= top - 1 && y <= top + height + 1;
	};
	const ends = edgeEnds(svg);
	// Without every edge, a pattern that matched none would leave the loop below nothing to check.
	expect([...ends.keys()].sort()).toEqual([
		"L_emit_lex_0",
		"L_lex_parse_0",
		"L_opt_emit_0",
		"L_parse_opt_0",
	]);
	for (const [key, { start, end }] of ends) {
		const [, from = "", to = ""] = /^L_([^_]+)_([^_]+)_0$/.exec(key) ?? [];
		expect({ key, start: touches(from, start), end: touches(to, end) }).toEqual({
			key,
			start: true,
			end: true,
		});
	}
});

test("a node's later shaped definition sets its label, as in Mermaid", () => {
	const label = (svg: string, id: string) =>
		new RegExp(`data-id="${id}"[^>]*>[\\s\\S]*?<text class="pele-label"[^>]*>([^<]*)<`).exec(
			svg,
		)?.[1];
	expect(label(svgOf("flowchart LR\n  a --> b\n  b[Bee]"), "b")).toBe("Bee");
	expect(label(svgOf('stateDiagram-v2\n  Idle --> Busy\n  state "Waiting" as Idle'), "Idle")).toBe(
		"Waiting",
	);
});

test("a long label wraps at Mermaid's 200 px, so a diagram keeps its size on a phone", () => {
	const svg = svgOf(
		"flowchart LR\n  a[A long label that keeps going well past the width a node would normally take before wrapping] --> b",
	);
	const node = svg.match(/data-id="a"[^>]*>\s*<rect [^>]*\swidth="([^"]+)"[\s\S]*?<\/g>/);
	// Mermaid wraps at 200 px of 16 px text; at the kit's 15 px node text a line holds a little more.
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
	expect(svg).toContain(
		`<text class="pele-label" x="0" y="5.25" text-anchor="middle">${escaped(label).replace(/&quot;/g, '"')}</text>`,
	);
	expect(refs.sort()).toEqual(["L_a_b_0", "a", "b"]);
});

test("an edge label is plain text on the diagram's tone, masking the line under it without a border", () => {
	for (const copy of copiesOf(`flowchart LR\n  a -->|"418 KB"| b --> c --> d --> e --> f --> g`)) {
		const label = /<g class="pele-edge-label"[\s\S]*?<\/g>/.exec(copy)?.[0] ?? "";
		expect(label).toMatch(/<rect [^>]*fill="var\(--_bg\)"/);
		expect(label).not.toContain("stroke");
	}
});

test("each of two edges between the same nodes keeps its own id on its line and its label", () => {
	const svg = svgOf("flowchart LR\n  a e1@--> b\n  a e2@-->|second| b");
	expect(svg.match(/<g class="pele-edge" data-id="e\d" data-ref="e\d"/g)?.length).toBe(2);
	expect(svg).toMatch(
		/<g class="pele-edge-label" data-id="e2" data-ref="e2">[\s\S]*?>second<\/text>/,
	);
});

test("a generated edge id counts every edge between its two nodes, named ones too", () => {
	const svg = svgOf(
		"flowchart LR\n  A first@-->|primary| B\n  A -->|retry| B\n  A -->|fallback| B",
	);
	const lines = [...svg.matchAll(/<g class="pele-edge" data-id="([^"]*)" data-ref="([^"]*)"/g)];
	const labels = [
		...svg.matchAll(
			/<g class="pele-edge-label" data-id="[^"]*" data-ref="([^"]*)">[\s\S]*?>([^<]*)<\/text>/g,
		),
	];

	// Mermaid numbers a pair's second edge 2; pack counts every edge before it, so the ids run on from the named one.
	expect(lines.map((m) => [m[1], m[2]])).toEqual([
		["first", "first"],
		["L_A_B_1", "L_A_B_1"],
		["L_A_B_2", "L_A_B_2"],
	]);
	expect(labels.map((m) => [m[1], m[2]])).toEqual([
		["first", "primary"],
		["L_A_B_1", "retry"],
		["L_A_B_2", "fallback"],
	]);
});

test("edges whose generated ids would read alike get different ones, and an author's id stays as written", () => {
	const svg = svgOf("flowchart LR\n  A_B --> C\n  A --> B_C\n  x L_A_B_C_1@--> y");
	const lines = [...svg.matchAll(/<g class="pele-edge" [^>]*data-ref="([^"]*)"/g)].map((m) => m[1]);

	expect(lines).toEqual(["L_A_B_C_0", "L_A_B_C_2", "L_A_B_C_1"]);
});

test("every id inside a diagram starts with its block's, so two diagrams on a page never share one", () => {
	for (const source of Object.values(ONE_OF_EACH)) {
		const ids = copiesOf(source).flatMap((copy) =>
			[...copy.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]),
		);
		expect(ids.filter((id) => !/^mm0(?:-|$)/.test(id ?? ""))).toEqual([]);
	}
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
const SMALL_FLOW = "flowchart LR\n  a[Input] --> b[Output]";

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

/** A sequence wider than a phone's column even at 10 px text. */
const WIDE_SEQUENCE = `sequenceDiagram\n${Array.from({ length: 8 }, (_, i) => `  participant P${i} as Participant ${i}`).join("\n")}\n  P0->>P7: report`;

/** A page of Mermaid blocks with the theme and link.js, whose pageContract runs `checks`. */
const diagramPage = (body: string, checks: Record<string, string>) =>
	`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>${body}</main><script src="kit:link.js"></script><script>${pageContract(checks)}</script></body></html>`;

test("on a phone a wide flowchart shows its top-down copy, and a wide sequence keeps 10 px text and scrolls sideways", async () => {
	const page = diagramPage(
		`<pre class="mermaid" id="flow">${PIPELINE}</pre>\n<pre class="mermaid" id="seq">${WIDE_SEQUENCE}</pre>
		<pre class="mermaid" id="small">${SMALL_FLOW}</pre>`,
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
			"a small drawing grows to the desktop cap, stays centred, and never outgrows the column": `(() => {
				const block = document.querySelector("#small");
				const svg = block.querySelector("svg");
				const [b, s] = [block, svg].map((el) => el.getBoundingClientRect());
				const textSize = 15 * svg.getScreenCTM().a;
				if (Math.abs(b.x + b.width / 2 - s.x - s.width / 2) > 1) return false;
				if (innerWidth < 640) return textSize > 14.9 && textSize <= 15;
				if (textSize < 20.9 || textSize > 21.01) return false;
				block.style.width = svg.viewBox.baseVal.width * 1.2 + "px";
				if (Math.abs(svg.getBoundingClientRect().width - block.clientWidth) > 1) return false;
				const cap = svg.viewBox.baseVal.width * 1.1;
				block.style.setProperty("--schematic-max", svg.viewBox.baseVal.width + "px");
				svg.style.setProperty("--mermaid-max", cap + "px");
				return Math.abs(svg.getBoundingClientRect().width - cap) <= 1;
			})()`,
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
			`<pre class="mermaid" id="small">${SMALL_FLOW}</pre>`,
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
			"a small drawing still prints at its original size": `(() => {
				const scale = document.querySelector("#small > svg").getScreenCTM().a;
				return scale > 0.99 && scale <= 1;
			})()`,
		},
	);

	// A4 with Chrome's default margins: the page box is 717 px wide.
	const paper = { width: 717, height: 1123, mobile: false };
	expect(await packAndRun(dir, "paper", page, { media: "print", widths: [paper] })).toEqual([]);
}, 30_000);

const ONE_OF_EACH = {
	flowchart:
		'flowchart LR\n  subgraph g ["Group"]\n    a["Alpha"] -->|"label"| b{"Beta"}\n  end\n  b <--> c',
	state:
		"stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: start\n  state Busy {\n    [*] --> Work\n  }",
	sequence:
		"sequenceDiagram\n  participant A\n  A->>B: hello\n  Note over A,B: note\n  loop every minute\n    B-->>A: ok\n  end",
	class:
		"classDiagram\n  class Animal {\n    +name string\n    +eat() void\n  }\n  Animal <|-- Dog : extends\n  Animal *-- Leg",
	er: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string name PK\n    string email FK\n  }",
	xychart:
		'xychart-beta\n  title "Sales"\n  x-axis [a, b, c]\n  y-axis "Units" 0 --> 10\n  bar [1, 2, 3]\n  line [2, 3, 4]',
};

test.each(Object.entries(ONE_OF_EACH))(
	"a %s diagram sets its text at 15 px and its smaller text at 13 px, the label size, and its boxes and edges draw 1 px",
	(_, source) => {
		const svg = svgOf(source);
		const sizes = [...svg.matchAll(/font-size="([\d.]+)"|font:([\d.]+)px/g)].map(
			(m) => m[1] ?? m[2],
		);

		expect(sizes[0]).toBe("15");
		expect(sizes.filter((size) => size !== "15" && size !== "13")).toEqual([]);
		// An xychart's data lines are data, not edges.
		const drawing = svg.replace(/<g class="pele-series[\s\S]*?<\/g>/g, "");
		expect(drawing).not.toMatch(/stroke-width="(?!1")/);
	},
);

test("a two-way edge ends in an arrowhead at both ends, each pointing out of the line", () => {
	const [wide = "", phone = ""] = copiesOf(
		'flowchart LR\n  a <-->|"two way, labelled"| b <--> c <--> d <--> e <--> f',
	);
	for (const copy of [wide, phone]) {
		const edges = [...copy.matchAll(/<g class="pele-edge" [^>]*>([\s\S]*?)<\/g>/g)].map(
			(m) => m[1] ?? "",
		);
		expect(edges).toHaveLength(5);
		for (const edge of edges) {
			const line = (/<path d="([^"]+)"/.exec(edge)?.[1]?.match(/-?[\d.]+/g) ?? []).map(Number);
			const middle = [
				((line[0] ?? 0) + (line.at(-2) ?? 0)) / 2,
				((line[1] ?? 0) + (line.at(-1) ?? 0)) / 2,
			];
			const heads = [...edge.matchAll(/class="pele-marker" d="([^"]+)"/g)].map((m) =>
				(m[1]?.match(/-?[\d.]+/g) ?? []).map(Number),
			);
			expect(heads).toHaveLength(2);
			// A head's tip (its first point) lies further out along the line than the middle of its base.
			const out = (x: number, y: number) => Math.hypot(x - (middle[0] ?? 0), y - (middle[1] ?? 0));
			for (const [tx = 0, ty = 0, ax = 0, ay = 0, bx = 0, by = 0] of heads) {
				expect(out(tx, ty)).toBeGreaterThan(out((ax + bx) / 2, (ay + by) / 2));
			}
		}
	}
});

test("nodes without a class keep their plain unfilled boxes", async () => {
	const page = diagramPage(
		`<pre class="mermaid" id="flow">${SHORT_FLOW.replace("-->", "-->|go|")}</pre>`,
		{
			"node boxes are unfilled": `[...document.querySelectorAll("#flow .pele-node rect")].every((r) => getComputedStyle(r).fill === "rgba(0, 0, 0, 0)")`,
		},
	);

	expect(await packAndRun(dir, "plain", page)).toEqual([]);
}, 30_000);

test("on a phone an LR flowchart wider than the column is drawn top-down at its drawn size, in a Stepper as outside one", async () => {
	const flow = (id: string) =>
		`flowchart LR\n  ${id}a["panels"] --> ${id}b["hybrid inverter"] --> ${id}c["house"]`;
	const output = await packedMdx(
		dir,
		"stepped",
		`import { Stepper } from "kit";\n\n# Stepped\n\n<Stepper start={1} captions={["one", "two"]} refs={["sa", "sb sc"]}>\n\n\`\`\`mermaid\n${flow("s")}\n\`\`\`\n\n</Stepper>\n\n\`\`\`mermaid\n${flow("p")}\n\`\`\`\n`,
	);
	const sizes = await inPage(
		output,
		(cdp) =>
			cdp.evaluate<number[][]>(
				`[...document.querySelectorAll(".mermaid")].map((block) => [...block.querySelectorAll(":scope > svg")]
					.filter((svg) => getComputedStyle(svg).display !== "none")
					.flatMap((svg) => [svg.hasAttribute("data-phone") ? 1 : 0, ...[...svg.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize) * svg.getScreenCTM().a)]))`,
				true,
			),
		{ width: 390, height: 844, mobile: true },
	);

	expect(sizes).toHaveLength(2);
	for (const [phone, ...px] of sizes) {
		expect(phone).toBe(1);
		expect(px.length).toBeGreaterThan(0);
		expect(px.every((size) => size > 14.8 && size < 15.001)).toBe(true);
	}
}, 30_000);

const LONG_MEMBERS = `classDiagram
  class A {
    +getAccountBalanceFromLedger() Money
    +balance Money
  }
  class B {
    +name string
  }
  A <|-- B`;

const LONG_ATTRIBUTES = `erDiagram
  CUSTOMER {
    string customer_identifier PK
    int age
    string email_address_on_file PK,FK
  }
  ORDER {
    int id PK
  }
  CUSTOMER ||--o{ ORDER : places`;

test("a class box and an entity hold their rows' text, whose parts do not touch, as drawn in the browser", async () => {
	const page = diagramPage(
		`<pre class="mermaid" id="cls">${LONG_MEMBERS}</pre>\n<pre class="mermaid" id="er">${LONG_ATTRIBUTES}</pre>`,
		{
			"every class member sits inside its box": `[...document.querySelectorAll("#cls .pele-node.pele-class")].length === 2 && [...document.querySelectorAll("#cls .pele-node.pele-class")].every((node) => {
				const box = node.querySelector("rect").getBoundingClientRect();
				return [...node.querySelectorAll("text")].every((t) => {
					const r = t.getBoundingClientRect();
					return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
				});
			})`,
			"every entity row sits inside its box": `[...document.querySelectorAll("#er .pele-node.pele-entity")].length === 2 && [...document.querySelectorAll("#er .pele-node.pele-entity")].every((node) => {
				const box = node.querySelector("rect").getBoundingClientRect();
				return [...node.querySelectorAll("text")].every((t) => {
					const r = t.getBoundingClientRect();
					return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
				});
			})`,
			"in an entity row the type, the name and the keys are apart": `[...document.querySelectorAll("#er .pele-node.pele-entity")].every((node) => {
				const y = (el) => Math.round(el.getBoundingClientRect().top / 4);
				const rows = Map.groupBy([...node.querySelectorAll(".pele-er-attributes text")], y);
				return [...rows.values()].every((row) => {
					const sorted = row.map((el) => el.getBoundingClientRect()).sort((a, b) => a.left - b.left);
					return sorted.every((r, i) => i === 0 || r.left >= sorted[i - 1].right + 1);
				});
			})`,
		},
	);

	expect(await packAndRun(dir, "boxes", page)).toEqual([]);
}, 30_000);

test("an activation bar hides the lifeline behind it, a nested one too", async () => {
	const page = diagramPage(
		`<pre class="mermaid" id="seq">sequenceDiagram\n  A->>+B: call\n  A->>+B: again\n  B->>+C: nested\n  C-->>-B: back\n  B-->>-A: ret\n  B-->>-A: done</pre>`,
		{
			"each bar is filled with the tone under the diagram, over its lifeline": `(() => {
				const bars = [...document.querySelectorAll("#seq .pele-activation")];
				const probe = document.createElement("i");
				probe.style.background = "var(--under)";
				document.querySelector("#seq").append(probe);
				const tone = getComputedStyle(probe).backgroundColor;
				return bars.length >= 3 && bars.every((bar) => {
					const life = document.querySelector("#seq .pele-lifeline[data-id=" + bar.dataset.id + "]");
					const x = parseFloat(life.getAttribute("d").slice(1));
					return getComputedStyle(bar).fill === tone && +bar.getAttribute("x") < x && +bar.getAttribute("x") + +bar.getAttribute("width") > x;
				});
			})()`,
		},
	);

	expect(await packAndRun(dir, "activation", page)).toEqual([]);
}, 30_000);

test("a sequence message's label fits between its two lifelines, whatever it spans", async () => {
	const page = diagramPage(
		`<pre class="mermaid" id="seq">sequenceDiagram\n  A->>B: Return the configuration for the selected project\n  B->>C: short\n  A->>C: A label spanning two gaps, longer than either one\n  C->>A: one<br>two lines</pre>`,
		{
			"every label lies between the lifelines of its message": `(() => {
				const x = (id) => document.querySelector("#seq .pele-lifeline[data-id=" + id + "]").getBoundingClientRect().left;
				const ends = { m1: ["A", "B"], m2: ["B", "C"], m3: ["A", "C"], m4: ["C", "A"] };
				const messages = [...document.querySelectorAll("#seq .pele-edge-label")];
				return messages.length === 4 && messages.every((m) => {
					const [a, b] = ends[m.dataset.ref].map(x).sort((p, q) => p - q);
					const r = m.querySelector("text").getBoundingClientRect();
					return r.left >= a && r.right <= b;
				});
			})()`,
		},
	);

	expect(await packAndRun(dir, "labels", page)).toEqual([]);
}, 30_000);
