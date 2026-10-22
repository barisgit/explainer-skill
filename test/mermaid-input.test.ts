import { expect, test } from "bun:test";
import { failureOf, svgOf } from "./support.ts";

// What the renderer's parsers read: every line is drawn as written, drawn as Mermaid draws it, or fails naming what pack
// cannot read and what to write instead. Nothing is dropped.

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
	expect(failureOf(input)).toBe(message);
});

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
	{
		name: "a style property without a value",
		input: "flowchart LR\n  a --> b\n  style a fill:red,GARBAGE",
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "a classDef property with an empty value",
		input: "flowchart LR\n  a --> b\n  classDef hot fill:red,bad:",
		unread: "bad:",
		hint: "leave it out",
	},
	{
		name: "a link style with two indexes and no comma",
		input: "flowchart LR\n  a --> b\n  linkStyle 0 1 stroke:red",
		unread: "1 stroke:red",
		hint: "leave it out",
	},
	{
		name: "a state link style with an empty index",
		input: "stateDiagram-v2\n  A --> B\n  linkStyle 0,,1 stroke:red",
		unread: "linkStyle 0,,1 stroke:red",
		hint: "leave it out",
	},
	{
		name: "a dangling &",
		input: "flowchart LR\n  a --> b &",
		unread: "&",
		hint: "leave it out",
	},
	{
		name: "an end outside a subgraph",
		input: "flowchart LR\n  a --> b\n  end",
		unread: "end",
		hint: "leave it out",
	},
	{
		name: "a } outside a composite state",
		input: "stateDiagram-v2\n  A --> B\n  }",
		unread: "}",
		hint: "leave it out",
	},
	{
		name: "a nested namespace",
		input: "classDiagram\n  namespace Outer {\n  namespace Inner {\n  class A\n  }\n  }",
		unread: "namespace Inner {",
		hint: "leave it out",
	},
	{
		name: "an entity attribute with an unknown key",
		input: "erDiagram\n  A {\n    string id PK GARBAGE\n  }",
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "an entity attribute with a second comment",
		input: 'erDiagram\n  A {\n    string id PK "a" "b"\n  }',
		unread: '"b"',
		hint: "leave it out",
	},
	{
		name: "a block keyword run into its label",
		input: "sequenceDiagram\n  loopGARBAGE\n  A->>B: hi\n  end",
		unread: "loopGARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after an xychart header",
		input: "xychart-beta GARBAGE\n  x-axis [a, b]\n  bar [1, 2]",
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after an xychart title",
		input: 'xychart-beta\n  title "Revenue" GARBAGE\n  x-axis [a, b]\n  bar [1, 2]',
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after x-axis categories",
		input: "xychart-beta\n  x-axis [a, b] GARBAGE\n  bar [1, 2]",
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after an x-axis range",
		input: "xychart-beta\n  x-axis 0 --> 10 GARBAGE\n  line [1, 2]",
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "an exponent in an axis range",
		input: "xychart-beta\n  x-axis 0 --> 10e3\n  line [1, 2]",
		unread: "e3",
		hint: "leave it out",
	},
	{
		name: "text after a y-axis range",
		input: 'xychart-beta\n  x-axis [a, b]\n  y-axis "t" 0 --> 100 GARBAGE\n  bar [1, 2]',
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after a bar series",
		input: "xychart-beta\n  x-axis [a, b]\n  bar [1, 2] GARBAGE",
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after a line series",
		input: "xychart-beta\n  x-axis [a, b]\n  line [1, 2] GARBAGE",
		unread: "GARBAGE",
		hint: "leave it out",
	},
	{
		name: "an empty last x-axis category",
		input: "xychart-beta\n  x-axis [a, b,]\n  bar [1, 2]",
		unread: "a, b,",
		hint: "leave it out",
	},
	{
		name: "a value that is not a number",
		input: "xychart-beta\n  x-axis [a, b]\n  bar [1junk, 2]",
		unread: "1junk",
		hint: "leave it out",
	},
	{
		name: "an empty value",
		input: "xychart-beta\n  x-axis [a, b, c]\n  bar [1, , 2]",
		unread: "1, , 2",
		hint: "leave it out",
	},
	{
		name: "text after a classDiagram header",
		input: "classDiagram ; GARBAGE\n  A <|-- B",
		unread: "; GARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after an erDiagram header",
		input: "erDiagram ; GARBAGE\n  A ||--o{ B : has",
		unread: "; GARBAGE",
		hint: "leave it out",
	},
	{
		name: "text after a sequenceDiagram header",
		input: "sequenceDiagram ; GARBAGE\n  A->>B: hi",
		unread: "; GARBAGE",
		hint: "leave it out",
	},
];

test.each(unreadable)("$name fails, naming what pack cannot read", ({ input, unread, hint }) => {
	const message = failureOf(input);
	expect(message).toContain(`pack cannot read "${unread}"`);
	expect(message).toContain(hint);
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
	expect(svg).toContain(">PK,FK<");
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
