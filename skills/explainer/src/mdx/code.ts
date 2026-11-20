import type { Element, ElementContent, Root as HastRoot, RootContent } from "hast";
import { refractor } from "../../vendor/refractor.js";
import { PackError } from "../pack-error.ts";

/**
 * Code fences, drawn once in pack: no script ships. Each line of a fence (`pre > code`) becomes a `span.code-line`, with
 * `--indent` set to its leading whitespace, so that on a phone a wrapped line continues under its own start. A fence in a
 * language refractor knows gets token spans (`tok-keyword`, ...) coloured from the kit's tokens; any other language stays
 * plain. A diff fence marks its inserted and deleted lines (`code-inserted`, `code-deleted`); ```` ```diff-python ```` also colours
 * the code after each line's marker as Python, the old side (context and deleted lines) and the new side (context and inserted
 * lines) each read as one listing. kit:code.css styles both. Its meta marks code for linked highlighting: ```` ```ts ref:call="api.call" ```` wraps every
 * `api.call` in a `<span data-ref="call">`, which lights with whatever else carries that ref (kit link).
 */

/**
 * Whether a page holds a fence, so it gets kit:code.css: as kit scripts are chosen (kit-scripts.ts), in its prerendered `html` or
 * in its client code (`scan`), which holds the fences of an .mdx fragment an island renders later or a filled view's records.
 */
export const holdsFence = (html: string, scan: string): boolean =>
	/<span class="code-line[" ]/.test(html) || /["'`]code-line[\s"'`]/.test(scan);

/**
 * Prism's token types by the kit class that colours them. A token takes the class of its innermost type listed here; inside an
 * interpolation or embedded script the text is plain again unless a token of its own says otherwise.
 */
const KIT_CLASSES: Record<string, string[]> = {
	comment: ["comment", "prolog", "doctype", "cdata", "shebang"],
	keyword: ["keyword", "atrule", "rule", "important", "directive", "macro"],
	string: ["string", "char", "attr-value", "template-string", "regex", "url"],
	number: ["number", "boolean", "constant", "symbol", "entity", "hexcode"],
	function: [
		"function",
		"function-variable",
		"method",
		"decorator",
		"function-name",
		"attr-name",
		"property",
	],
	type: ["class-name", "builtin", "tag", "selector", "namespace", "maybe-class-name"],
	inserted: ["inserted"],
	deleted: ["deleted"],
};
const KIT_CLASS = new Map(
	Object.entries(KIT_CLASSES).flatMap(([kit, types]) => types.map((type) => [type, `tok-${kit}`])),
);
const PLAIN_AGAIN = new Set(["interpolation", "script"]);

/** The class a Prism token gives its text: that of its first type listed in KIT_CLASSES, else the class it sits in. */
function tokenClass(token: Element, inherited: string | null): string | null {
	const { className } = token.properties;
	for (const type of Array.isArray(className) ? className.map(String) : []) {
		const kit = KIT_CLASS.get(type);
		if (kit || PLAIN_AGAIN.has(type)) {
			return kit ?? null;
		}
	}
	return inherited;
}

/** The kit class of each character of `text` in `language`: refractor's tokens read innermost first. */
function tokenClasses(text: string, language: string): (string | null)[] {
	const out: (string | null)[] = [];
	const walk = (nodes: ElementContent[], inherited: string | null) => {
		for (const node of nodes) {
			if (node.type === "element") {
				walk(node.children, tokenClass(node, inherited));
			} else if (node.type === "text") {
				for (let i = 0; i < node.value.length; i++) {
					out.push(inherited);
				}
			}
		}
	};
	walk(refractor.highlight(text, language).children as ElementContent[], null);
	if (out.length !== text.length) {
		throw new Error(`refractor rewrote the text of a ${language} fence`);
	}
	return out;
}

/** What a diff line holds: code after a marker, a header (`coord`) or other text such as `\ No newline at end of file`. */
type DiffKind = "inserted" | "deleted" | "unchanged" | "coord" | "other";

/** A diff line's kind and its part: each header starts a part (a hunk, or a file's changes), whose sides are read apart. */
interface DiffLine {
	kind: DiffKind;
	part: number;
}

/** The side of a diff each kind of line belongs to: the listing before the change and the one after it. */
const SIDES: DiffKind[][] = [
	["unchanged", "deleted"],
	["unchanged", "inserted"],
];

/** A line's kind by its marker; an empty line is context whose trailing space was trimmed. */
const markerKind = (line: string): DiffKind =>
	line.startsWith("+")
		? "inserted"
		: line.startsWith("-")
			? "deleted"
			: /^ |^\r?$/.test(line)
				? "unchanged"
				: "other";

/** A line's kind outside a unified hunk, as Prism's diff grammar reads its start. */
function looseKind(line: string): DiffKind {
	if (/^(?:\*{3}|-{3}|\+{3}|@@.*@@\r?$|\d)/.test(line)) {
		return "coord";
	}
	return markerKind(line.replace(/^>/, "+").replace(/^</, "-"));
}

/**
 * The kind and part of each line of a diff. A unified hunk header (`@@ -1,3 +1,4 @@ section`) is followed by exactly the lines
 * it counts, so `---i;` inside one is a deleted `--i;`, not a header; lines outside a hunk read as Prism's diff grammar reads
 * them, which keeps excerpts without headers working.
 */
function diffLines(text: string): DiffLine[] {
	let part = 0;
	let left = [0, 0];
	return text.split("\n").map((line): DiffLine => {
		if (left.some((count) => count > 0)) {
			const kind = markerKind(line);
			left = left.map((count, side) => count - Number(SIDES[side]?.includes(kind)));
			return { kind, part };
		}
		const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
		left = hunk ? [Number(hunk[1] ?? 1), Number(hunk[2] ?? 1)] : [0, 0];
		const kind = hunk ? "coord" : looseKind(line);
		part += Number(kind === "coord");
		return { kind, part };
	});
}

/** A diff line where the fence's text holds it: its first character's offset and the code after its marker. */
interface PlacedLine extends DiffLine {
	start: number;
	code: string;
}

const NO_DIFF: DiffLine = { kind: "other", part: 0 };

/** Writes into `out` the tokens of `lines`, one side of one part, read as one listing in `language`. */
function readSide(lines: PlacedLine[], language: string, out: (string | null)[]) {
	const tokens = tokenClasses(lines.map((line) => line.code).join("\n"), language);
	let from = 0;
	for (const { start, code } of lines) {
		out.splice(start + 1, code.length, ...tokens.slice(from, from + code.length));
		from += code.length + 1;
	}
}

/**
 * The kit class of each character of a diff. With a `language`, each side of each part is read as one listing, a context line
 * taking its tokens from the new side, and a changed line's marker is coloured as its change; without one the whole changed line
 * is.
 */
function diffTokenClasses(text: string, kinds: DiffLine[], language?: string): (string | null)[] {
	const out: (string | null)[] = Array.from({ length: text.length }, () => null);
	let at = 0;
	const lines = text.split("\n").map((line, n): PlacedLine => {
		const start = at;
		at += line.length + 1;
		return { ...(kinds[n] ?? NO_DIFF), start, code: line.slice(1) };
	});
	for (const part of language ? new Set(lines.map((line) => line.part)) : []) {
		for (const side of SIDES) {
			readSide(
				lines.filter((line) => line.part === part && side.includes(line.kind)),
				language ?? "",
				out,
			);
		}
	}
	for (const { start, code, kind } of lines) {
		if (kind === "inserted" || kind === "deleted") {
			out.fill(`tok-${kind}`, start, language ? start + 1 : start + 1 + code.length);
		}
	}
	return out;
}

/** One `ref:name="text"` of a fence's meta. */
interface Mark {
	name: string;
	text: string;
}

const MARK = /\s*ref:([^\s="']+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/y;

/** The marks a fence's meta writes; anything else in it throws `fail` with what to write. */
function marksOf(meta: string, fail: (what: string) => PackError): Mark[] {
	const marks: Mark[] = [];
	MARK.lastIndex = 0;
	while (MARK.lastIndex < meta.trimEnd().length) {
		const start = MARK.lastIndex;
		const match = MARK.exec(meta);
		if (!match) {
			const word = meta.slice(start).trim().split(/\s+/)[0];
			throw fail(
				`pack does not read "${word}" after the fence's language; mark code with ref:name="text"`,
			);
		}
		const [, name = "", double, single, bare] = match;
		const text = double ?? single ?? bare ?? "";
		if (!text) {
			throw fail(`ref:${name} marks no text; write ref:${name}="the code to mark"`);
		}
		marks.push({ name, text });
	}
	return marks;
}

/**
 * The refs of each character of `text`: every occurrence of each mark's text carries its name, several names where marks give
 * the same text. Text the code does not hold, and marks that overlap only in part, throw `fail`.
 */
function refsAt(text: string, marks: Mark[], fail: (what: string) => PackError): string[] {
	const spans: { at: number; end: number; names: string[] }[] = [];
	for (const { name, text: marked } of marks) {
		let at = text.indexOf(marked);
		if (at < 0) {
			throw fail(`ref:${name}: the code has no "${marked}"; mark text as the fence writes it`);
		}
		for (; at >= 0; at = text.indexOf(marked, at + marked.length)) {
			const end = at + marked.length;
			const same = spans.find((span) => span.at === at && span.end === end);
			if (same) {
				same.names.push(name);
			} else {
				spans.push({ at, end, names: [name] });
			}
		}
	}
	const refs = Array.from({ length: text.length }, () => "");
	for (const { at, end, names } of spans) {
		for (let i = at; i < end; i++) {
			if (refs[i]) {
				throw fail(
					`ref:${names[0]} overlaps another mark at "${text.slice(at, end)}"; mark separate text, or the same text twice`,
				);
			}
			refs[i] = names.join(" ");
		}
	}
	return refs;
}

/** The runs of equal `key` between `from` and `to`. */
function runs<T>(
	from: number,
	to: number,
	key: (i: number) => T,
): { start: number; end: number; key: T }[] {
	const out: { start: number; end: number; key: T }[] = [];
	for (let i = from; i < to; i++) {
		const last = out.at(-1);
		const k = key(i);
		if (last && last.key === k) {
			last.end = i + 1;
		} else {
			out.push({ start: i, end: i + 1, key: k });
		}
	}
	return out;
}

const span = (properties: Element["properties"], children: ElementContent[]): Element => ({
	type: "element",
	tagName: "span",
	properties,
	children,
});

/** The tab-size the phone layout sets: `--indent` counts columns at it. */
const TAB = 2;

/**
 * The columns of a line's leading whitespace at TAB, after its first `marker` columns (a diff line's sign), made even: a wrapped line's start (indent and code.css's 2ch hang) must
 * stay on a tab stop, which the browser measures from there, for the line's own tabs to keep their width.
 */
function indentOf(line: string, marker: number): number {
	let columns = marker;
	for (const char of /^[ \t]*/.exec(line.slice(marker))?.[0] ?? "") {
		columns = char === "\t" ? columns + TAB - (columns % TAB) : columns + 1;
	}
	return columns + (columns % TAB);
}

/**
 * A fence's code as line spans holding its ref and token spans; the newlines between them stay text, so copying is unchanged. A
 * diff's lines (`kinds`) carry their kind and are indented after their marker column.
 */
function codeLines(
	text: string,
	tokens: (string | null)[],
	refs: string[],
	kinds: DiffLine[] | undefined,
): ElementContent[] {
	const out: ElementContent[] = [];
	let start = 0;
	for (const [n, line] of text.split("\n").entries()) {
		const end = start + line.length;
		const pieces = runs(start, end, (i) => refs[i] ?? "").map((ref): ElementContent[] => {
			const parts = runs(ref.start, ref.end, (i) => tokens[i] ?? null).map(
				(tok): ElementContent => {
					const value: ElementContent = { type: "text", value: text.slice(tok.start, tok.end) };
					return tok.key ? span({ className: [tok.key] }, [value]) : value;
				},
			);
			return ref.key ? [span({ dataRef: ref.key }, parts)] : parts;
		});
		const kind = kinds?.[n]?.kind;
		const indent = indentOf(line, line && kind && kind !== "other" && kind !== "coord" ? 1 : 0);
		const marked = kind === "inserted" || kind === "deleted" ? [`code-${kind}`] : [];
		if (end < text.length || line) {
			out.push(
				span(
					{
						className: ["code-line", ...marked],
						...(indent ? { style: `--indent:${indent}` } : {}),
					},
					pieces.flat(),
				),
			);
		}
		if (end < text.length) {
			out.push({ type: "text", value: "\n" });
		}
		start = end + 1;
	}
	return out;
}

/** A fence's language from its `language-x` class, or undefined for none. */
function languageOf(code: Element): string | undefined {
	const { className } = code.properties;
	const name = Array.isArray(className)
		? className.map(String).find((c) => c.startsWith("language-"))
		: undefined;
	return name?.slice("language-".length);
}

/**
 * A fence's tokens in its `language`, and for a diff its lines' kinds: `diff-<language>` colours the code after each marker in
 * that language, and throws `fail` for a language refractor does not know.
 */
function colours(
	text: string,
	language: string | undefined,
	fail: (what: string) => PackError,
): { tokens: (string | null)[]; kinds?: DiffLine[] } {
	const inner = language?.startsWith("diff-") ? language.slice("diff-".length) : undefined;
	if (inner !== undefined && !refractor.registered(inner)) {
		throw fail(
			`pack colours no "${inner}" in ${language}; write diff-<language> with a language pack colours (diff-ts, diff-python, ...), or diff`,
		);
	}
	if (language !== "diff" && inner === undefined) {
		return {
			tokens: language && refractor.registered(language) ? tokenClasses(text, language) : [],
		};
	}
	const kinds = diffLines(text);
	return {
		tokens: diffTokenClasses(text, kinds, inner),
		kinds,
	};
}

/** The rehype step for one page file (its name as errors show it): every code fence is drawn as lines, tokens and marks. */
export function codeFences(file: string) {
	const draw = (pre: Element, code: Element) => {
		const line = pre.position?.start.line;
		const fail = (what: string) => new PackError(`${file}${line ? `:${line}` : ""}: ${what}`);
		const text = code.children.map((child) => (child.type === "text" ? child.value : "")).join("");
		const { tokens, kinds } = colours(text, languageOf(code), fail);
		const refs = refsAt(text, marksOf(code.data?.meta ?? "", fail), fail);
		code.children = codeLines(text, tokens, refs, kinds);
	};
	// Sections and views are MDX JSX elements (structure.ts), so the walk enters every node with children, not only elements.
	const visit = (node: HastRoot | RootContent) => {
		if (!("children" in node)) {
			return;
		}
		const [code] = node.children;
		if (
			node.type === "element" &&
			node.tagName === "pre" &&
			code?.type === "element" &&
			code.tagName === "code"
		) {
			draw(node, code);
			return;
		}
		node.children.forEach(visit);
	};
	return () => (tree: HastRoot) => visit(tree);
}
