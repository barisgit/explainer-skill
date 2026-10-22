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
