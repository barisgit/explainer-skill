/**
 * What pack tells an author about Mermaid source before and after pele reads it: the types it draws and what to draw instead
 * of the others, statements pele would draw wrong without an error, blocks left open or closed twice, and pele's own errors
 * turned into the line it could not read and what to write instead. Every message names the text the author wrote.
 */
import { PeleError } from "../vendor/pele.js";

/** What pack does with a supported type beyond drawing it: misrender checks for flowcharts and sequences, and see `flows`. */
export type Family = "flowchart" | "state" | "sequence" | "class" | "er" | "xychart";

/** Flowcharts and state diagrams: they can be laid out across their direction and carry number tags. */
export const flows = (family: Family) => family === "flowchart" || family === "state";

/** The header keywords pack draws, with their family. */
const SUPPORTED = new Map<string, Family>([
	["flowchart", "flowchart"],
	["graph", "flowchart"],
	["stateDiagram", "state"],
	["stateDiagram-v2", "state"],
	["sequenceDiagram", "sequence"],
	["classDiagram", "class"],
	["erDiagram", "er"],
	["xychart", "xychart"],
	["xychart-beta", "xychart"],
]);

/** SUPPORTED as the author is told it: the older stateDiagram and xychart headers still draw but are not advertised. */
const SUPPORTED_LIST =
	"flowchart (graph), stateDiagram-v2, sequenceDiagram, classDiagram, erDiagram, xychart-beta";

/**
 * What to draw instead, per Mermaid type pack cannot render. The kit names are the components `kit <Name>` documents. A Map, unlike
 * an object literal, finds nothing for a header such as `constructor`.
 */
const INSTEAD = new Map([
	["pie", "a pie or, better for comparing, a bar chart with the kit's Chart (ECharts)"],
	["gantt", "a horizontal bar chart on a time axis with the kit's Chart, or a table of dates"],
	["timeline", "an ordered list or a table, or a flowchart LR with one node per period"],
	["journey", "a line chart of the scores per step with the kit's Plot or Chart"],
	["quadrantChart", "a scatter chart with the kit's Chart, with markLine at the two midpoints"],
	["gitGraph", "a flowchart LR with one node per commit and a subgraph per branch"],
	["sankey-beta", "a sankey chart with the kit's Chart"],
	["sankey", "a sankey chart with the kit's Chart"],
	["architecture-beta", "a flowchart with a subgraph per group"],
	["packet-beta", "a table with one column per bit range"],
	["packet", "a table with one column per bit range"],
	["mindmap", "a flowchart LR or a nested list"],
	["block-beta", "a flowchart with a subgraph per block group, or a CSS grid of boxes"],
	["block", "a flowchart with a subgraph per block group, or a CSS grid of boxes"],
]);
/** What to draw instead of a type INSTEAD does not name. */
const INSTEAD_OTHERWISE = "a flowchart for parts and links, or the kit's Chart for numbers";

/** The family of the source's header keyword; throws, saying what to draw instead, for a type pack cannot draw. */
export function familyOf(body: string): Family {
	const type = /^\S+/.exec(body)?.[0] ?? "";
	const family = SUPPORTED.get(type);
	if (!family) {
		throw new Error(
			`"${type}" diagrams are not supported (pack draws ${SUPPORTED_LIST}); draw it as ${INSTEAD.get(type) ?? INSTEAD_OTHERWISE}`,
		);
	}
	return family;
}

/** The source without front matter and `%%` comment lines; the header keyword is the first word left. */
export function stripPreamble(source: string): string {
	return source
		.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, "")
		.split("\n")
		.filter((line) => !line.trim().startsWith("%%"))
		.join("\n")
		.trim();
}

/**
 * The statements after the header, one per entry. In flowcharts and states Mermaid reads `;` outside quotes as a line break,
 * the header's included (`flowchart LR; A --> B`), and a quoted label may run over lines, which stay one statement.
 */
function statementsOf(family: Family, body: string): string[] {
	if (!flows(family)) {
		return body
			.split("\n")
			.slice(1)
			.map((line) => line.trim());
	}
	let quoted = false;
	let out = "";
	for (const ch of body) {
		quoted = ch === '"' ? !quoted : quoted;
		if (quoted) {
			out += ch === "\n" ? " " : ch;
		} else {
			out += ch === ";" ? "\n" : ch;
		}
	}
	return out
		.split("\n")
		.slice(1)
		.map((line) => line.trim());
}

/** A flowchart link (`-->`, `---`, `-.->`, `==>`, `--x`, `<-->`), with its optional `|label|`. */
const LINK = String.raw`<?(?:-{2,}|={2,}|-\.+-)[->ox]?(?:\|[^|]*\|)?`;
const NO_TARGET = new RegExp(`${LINK}\\s*$`);
const NO_SOURCE = new RegExp(`^\\s*${LINK}`);
/** A sequence message: sender, arrow (`->>`, `-->`, `-x`, `-)` and their dashed forms), receiver with an optional activation sign, text. */
const MESSAGE = /^([^:]*?)\s*(--?>>|--?>|--?x|--?\))\s*([+-]?)([^:]*?)\s*(:.*)?$/;

/**
 * Statements pele draws wrong without an error (a link missing its source is dropped), or reads as an error whose message would
 * not say what is missing (a link missing its target, a message missing a participant), each with what to write instead.
 */
const MISRENDERS: Array<(family: Family, line: string) => string | undefined> = [
	(family, line) =>
		family === "flowchart" && NO_TARGET.test(line)
			? `"${line}" has no target node; write it as "${line} next", naming the node it points to`
			: undefined,
	(family, line) =>
		family === "flowchart" && NO_SOURCE.test(line)
			? `"${line}" has no source node; write it as "prev ${line}", naming the node it starts from`
			: undefined,
	(family, line) => {
		const [, from, arrow, sign, to, text = ""] =
			(family === "sequence" && MESSAGE.exec(line)) || [];
		return arrow && !(from && to)
			? `"${line}" is missing a participant; write it as "${from || "A"}${arrow}${sign}${to || "B"}${text}", sender before the arrow and receiver after`
			: undefined;
	},
];

/** Blocks per family: what opens one and the word that closes it. A `}` that closes nothing would be drawn as a state named "}". */
const BLOCKS: Record<Family, { opens: RegExp; closer: string } | undefined> = {
	flowchart: { opens: /^subgraph\b/, closer: "end" },
	sequence: { opens: /^(?:loop|alt|opt|par|par_over|critical|break|rect|box)\b/, closer: "end" },
	state: { opens: /^[^}]*\{$/, closer: "}" },
	class: { opens: /^[^}]*\{$/, closer: "}" },
	er: { opens: /^[^}]*\{$/, closer: "}" },
	xychart: undefined,
};

/** A label pele reads to the end of the line, `}` included: a state's or transition's after `:`, a relation's after its link. */
const LABELLED: Partial<Record<Family, RegExp>> = { state: /:/, class: /(?:--|\.\.)[^:]*:/ };

/** Whether a statement ends a block: its closer alone, or a `}` after a block's last member (`+String name }`) but not in a label. */
const closes = (family: Family, closer: string, line: string) =>
	line === closer ||
	(closer === "}" && line.endsWith("}") && !line.includes("{") && !LABELLED[family]?.test(line));

/** The first block problem: a closer with no block open, else the innermost block never closed. */
function blockProblem(family: Family, statements: string[]): string | undefined {
	const blocks = BLOCKS[family];
	if (!blocks) {
		return undefined;
	}
	const open: string[] = [];
	for (const line of statements) {
		if (closes(family, blocks.closer, line)) {
			if (!open.pop()) {
				return `"${line}" closes no block; remove it, or open the block it ends`;
			}
		} else if (blocks.opens.test(line)) {
			open.push(line);
		}
	}
	const unclosed = open.at(-1);
	return unclosed && `"${unclosed}" is never closed: end it with "${blocks.closer}"`;
}

/** The first statement pele would draw wrong, or a block left open or closed twice, as its message. */
export function sourceProblem(family: Family, body: string): string | undefined {
	const statements = statementsOf(family, body);
	for (const line of statements) {
		for (const check of MISRENDERS) {
			const problem = check(family, line);
			if (problem) {
				return problem;
			}
		}
	}
	return blockProblem(family, statements);
}

/** What to write instead of a line pele does not read, by what the line holds; else UNREAD_DEFAULT. */
const UNREAD_HINTS: Array<[RegExp, string]> = [
	[
		/^\s*(?:classDef|style|linkStyle)\b.*var\(/,
		"classDef and style take plain colours; for the kit's colours mark the node :::info, :::ok, :::warn or :::bad",
	],
	// url( as written or with its u as a CSS escape (\75, then an optional space or form feed)
	[
		/(?:u|\\0{0,4}75[ \t\f]?)rl\(/i,
		"a paint from a URL cannot be drawn offline; use a plain colour",
	],
];
const UNREAD_DEFAULT =
	"write it as Mermaid's syntax reference does (pack reads Mermaid 12), or leave it out";

/** pele's semantic errors that name what to write, by their message. */
const SEMANTIC: Array<[RegExp, (name: string) => string]> = [
	[
		/inactivate an inactive participant \((.+)\)/,
		(name) =>
			`${name} is deactivated but not active; start it with "+" on an earlier message to ${name}, e.g. "A->>+${name}: ask"`,
	],
];

/**
 * The author's message for an error pele throws on `text`: the text it could not read and what to write instead. Where pele
 * stops at a block's closer, the statement before it is the one it could not finish.
 */
export function peleMessage(error: unknown, text: string): string {
	if (!(error instanceof PeleError)) {
		return error instanceof Error ? error.message : String(error);
	}
	if (error.code !== "syntax") {
		const known = SEMANTIC.map(
			([pattern, say]) => [pattern.exec(error.message), say] as const,
		).find(([match]) => match);
		return known ? known[1](known[0]?.[1] ?? "") : error.message;
	}
	const stopped = error.snippet.split("\n")[0] ?? "";
	const before = text
		.split("\n")
		.slice(0, Math.max(0, error.line - 1))
		.findLast((line) => line.trim());
	const closer = /^\s*(?:\}|end)\s*$/.test(stopped) && before;
	const line = closer || stopped;
	const unread = closer ? "" : line.slice(Math.max(0, error.column - 1)).trim();
	const hint = UNREAD_HINTS.find(([pattern]) => pattern.test(line))?.[1] ?? UNREAD_DEFAULT;
	if (!line.trim()) {
		return `the diagram ends before a statement is complete; ${hint}`;
	}
	const at =
		unread && unread !== line.trim() ? `"${unread}" in "${line.trim()}"` : `"${line.trim()}"`;
	return `pack cannot read ${at}; ${hint}`;
}
