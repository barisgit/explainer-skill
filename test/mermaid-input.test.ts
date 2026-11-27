import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { failureOf, packMdx, scratch, svgOf } from "./support.ts";

test("explicit classDef and style paint still draw, with warnings if they do not adapt", async () => {
	const dir = scratch();
	try {
		const { result, output } = await packMdx(
			dir,
			"fixed-paint",
			`# Diagram

\`\`\`mermaid
flowchart LR
  a[Start]:::info --> b[Work]:::themed --> c[End]
  classDef info fill:#fff,stroke:#777,color:#111
  classDef themed stroke:currentColor,fill:none,stroke-width:2
  style b stroke:currentColor
  style c fill:#eee
\`\`\`
`,
		);
		expect(result.code).toBe(0);
		const html = readFileSync(output, "utf8");
		expect(html).toContain("fill:#fff;stroke:#777;");
		expect(html).toContain("fill:#eee;");
		expect(result.stdout).toContain('mermaid block 1: classDef "info" uses fixed paint');
		expect(result.stdout).toContain('mermaid block 1: style "c" uses fixed paint');
		expect(result.stdout).not.toContain('classDef "themed"');
		expect(result.stdout).not.toContain('style "b"');
	} finally {
		dir.cleanup();
	}
});

// What pele reads: every line is drawn as Mermaid draws it, or fails naming what pack cannot read and what to write instead.

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
		name: "an end outside a subgraph",
		input: "flowchart LR\n  a --> b\n  end",
		message: '"end" closes no block; remove it, or open the block it ends',
	},
	{
		name: "a } outside a composite state",
		input: "stateDiagram-v2\n  A --> B\n  }",
		message: '"}" closes no block; remove it, or open the block it ends',
	},
	{
		name: "a deactivation of an inactive participant",
		input: "sequenceDiagram\n  A->>B: ask\n  B-->>-A: answer",
		message:
			'B is deactivated but not active; start it with "+" on an earlier message to B, e.g. "A->>+B: ask"',
	},
	{
		name: "a kit colour in a classDef",
		input: "flowchart LR\n  a:::hot --> b\n  classDef hot stroke:var(--accent)",
		message:
			'pack cannot read "(--accent)" in "classDef hot stroke:var(--accent)"; classDef and style take plain colours; for the kit\'s colours mark the node :::info, :::ok, :::warn or :::bad',
	},
];

test.each(misrenders)("$name fails with what to write instead", ({ input, message }) => {
	expect(failureOf(input)).toBe(message);
});

/** Mermaid syntax an earlier renderer refused, which pele draws: each with markup only its drawing has. */
const drawn = [
	{
		name: "a markdown string",
		input: 'flowchart LR\n  a["`**bold** text`"] --> b',
		has: ">bold</tspan>",
	},
	{ name: "a cross end", input: "flowchart LR\n  a --x b", has: 'data-ref="L_a_b_0"' },
	{ name: "a circle end", input: "flowchart LR\n  a --o b", has: 'data-ref="L_a_b_0"' },
	{
		name: "a new-style node shape",
		input: "flowchart LR\n  a@{ shape: circle } --> b",
		has: "pele-shape-circle",
	},
	{ name: "a state note", input: "stateDiagram-v2\n  A --> B\n  note right of A: hi", has: ">hi<" },
	{
		name: "a sequence title",
		input: "sequenceDiagram\n  title Login\n  A->>B: hi",
		has: ">Login<",
	},
	{ name: "a class note", input: 'classDiagram\n  A <|-- B\n  note for A "base"', has: ">base<" },
	{
		name: "a nested namespace",
		input: "classDiagram\n  namespace Outer {\n  namespace Inner {\n  class A\n  }\n  }",
		has: ">Inner<",
	},
	{
		name: "an activation that runs to the end",
		input: "sequenceDiagram\n  A->>+B: ask\n  B-->>A: answer",
		has: 'class="pele-activation"',
	},
	{
		name: "an activate line after a message from its participant",
		input: "sequenceDiagram\n  A->>B: ask\n  activate A\n  B-->>A: ok\n  deactivate A",
		has: 'class="pele-activation"',
	},
	{
		name: "a subgraph opened on the header's line",
		input: "flowchart LR; subgraph Group\n  A --> B\n  end",
		has: ">Group<",
	},
	{
		name: "a markdown label whose lines read like statements",
		input: 'flowchart TD\n  A["`start\nend\nthen -->`"]',
		has: ">start<",
	},
	{
		name: "a class body closed after its last member",
		input: "classDiagram\n  class A {\n    +String name }\n  A --> B",
		has: "name",
	},
	{
		name: "a transition label ending in a brace",
		input: "stateDiagram-v2\n  state S {\n    A --> B: done }\n  }",
		has: ">done }<",
	},
	{
		name: "a relation label ending in a brace",
		input: "classDiagram\n  A --> B : uses }",
		has: ">uses }<",
	},
];

test.each(drawn)("$name draws", ({ input, has }) => {
	expect(svgOf(input)).toContain(has);
});

const unreadable = [
	{
		name: "an entity attribute without a name",
		input: "erDiagram\n  A {\n    string\n  }",
		unread: "string",
	},
	{
		name: "an unknown xychart series",
		input: "xychart-beta\n  x-axis [a, b]\n  bar [1, 2]\n  area [1, 2]",
		unread: "area [1, 2]",
	},
	{ name: "a dangling &", input: "flowchart LR\n  a --> b &", unread: "a --> b &" },
	{
		name: "an entity attribute with an unknown key",
		input: "erDiagram\n  A {\n    string id PK GARBAGE\n  }",
		unread: "string id PK GARBAGE",
	},
	{
		name: "an entity attribute with a second comment",
		input: 'erDiagram\n  A {\n    string id PK "a" "b"\n  }',
		unread: '"b"',
	},
	{
		name: "text after an xychart header",
		input: "xychart-beta GARBAGE\n  x-axis [a, b]\n  bar [1, 2]",
		unread: "GARBAGE",
	},
	{
		name: "text after x-axis categories",
		input: "xychart-beta\n  x-axis [a, b] GARBAGE\n  bar [1, 2]",
		unread: "GARBAGE",
	},
	{
		name: "an exponent in an axis range",
		input: "xychart-beta\n  x-axis 0 --> 10e3\n  line [1, 2]",
		unread: "e3",
	},
	{
		name: "a value that is not a number",
		input: "xychart-beta\n  x-axis [a, b]\n  bar [1junk, 2]",
		unread: "junk, 2]",
	},
	{
		name: "text after a classDiagram header",
		input: "classDiagram ; GARBAGE\n  A <|-- B",
		unread: "; GARBAGE",
	},
	{
		name: "a remote paint",
		input: "flowchart LR\n  a --> b\n  style a fill:url(https://example.com/p.svg#g)",
		unread: "(https://example.com/p.svg#g)",
	},
];

test.each(unreadable)("$name fails, naming what pack cannot read", ({ input, unread }) => {
	const message = failureOf(input);
	expect(message).toStartWith(`pack cannot read "${unread}"`);
	expect(message).toMatch(/; (?:write it as|a paint from a URL)/);
});

const unclosed = [
	{
		name: "a subgraph",
		input: "flowchart LR\n  subgraph Lost\n  a --> b",
		opener: "subgraph Lost",
		closer: "end",
	},
	{
		name: "a composite state",
		input: "stateDiagram-v2\n  state Lost {\n  A --> B",
		opener: "state Lost {",
		closer: "}",
	},
	{
		name: "a namespace",
		input: "classDiagram\n  namespace Lost {\n  class A",
		opener: "namespace Lost {",
		closer: "}",
	},
	{
		name: "a class body",
		input: "classDiagram\n  class A {\n  +int id",
		opener: "class A {",
		closer: "}",
	},
	{ name: "an entity", input: "erDiagram\n  A {\n  string id", opener: "A {", closer: "}" },
	{
		name: "a sequence block",
		input: "sequenceDiagram\n  loop Lost\n  A->>B: hi",
		opener: "loop Lost",
		closer: "end",
	},
];

test.each(unclosed)(
	"$name left open fails and says how to close it",
	({ input, opener, closer }) => {
		expect(failureOf(input)).toBe(`"${opener}" is never closed: end it with "${closer}"`);
	},
);

test("an entity attribute keeps every key of a comma list and its comment", () => {
	const svg = svgOf('erDiagram\n  A {\n    string id PK, FK "the id"\n  }');
	expect(svg).toMatch(/>PK,\s?FK</);
	expect(svg).toContain(">the id<");
});

test("a quoted x-axis category keeps its comma", () => {
	const svg = svgOf('xychart-beta\n  x-axis ["Jan, 1", Feb]\n  bar [1, 2]');
	expect(svg).toContain(">Jan, 1<");
	expect(svg).not.toContain('>"Jan<');
});

test("a participant declared again takes its latest name, as in Mermaid", () => {
	const svg = svgOf(
		"sequenceDiagram\n  participant A as First\n  participant A as Second\n  A->>B: hi",
	);
	expect(svg).toContain(">Second<");
	expect(svg).not.toContain(">First<");
});

test("brackets inside a quoted label stay in the label, and its edge is kept", () => {
	const svg = svgOf('flowchart LR\n  a["Array [i]"] --> b');
	expect(svg).toContain(">Array [i]<");
	expect(svg).toContain('data-ref="L_a_b_0"');
});

test("longer links draw like the short ones", () => {
	const svg = svgOf("flowchart TD\n  a ---> b\n  b -..-> c\n  c ===> d\n  d ---- e");
	expect(svg.match(/<g class="pele-edge"/g)).toHaveLength(4);
});

test("activate and deactivate lines draw the bar that + and - on the messages draw", () => {
	const signs = svgOf("sequenceDiagram\n  A->>+B: ask\n  B-->>-A: answer");
	const lines = svgOf(
		"sequenceDiagram\n  A->>B: ask\n  activate B\n  B-->>A: answer\n  deactivate B",
	);
	const bars = (svg: string) => svg.match(/<rect class="pele-activation"[^>]*>/g);
	expect(bars(signs)).toHaveLength(1);
	expect(bars(lines)).toEqual(bars(signs));
});
