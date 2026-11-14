import type { Element, ElementContent, Root as HastRoot, RootContent } from "hast";
import { refractor } from "../../vendor/refractor.js";
import { PackError } from "../pack-error.ts";

/**
 * Code fences, drawn once in pack: no script ships. Each line of a fence (`pre > code`) becomes a `span.code-line`, with
 * `--indent` set to its leading whitespace, so that on a phone a wrapped line continues under its own start. A fence in a
 * language refractor knows gets token spans (`tok-keyword`, ...) coloured from the kit's tokens; any other language stays
 * plain. kit:code.css styles both. Its meta marks code for linked highlighting: ```` ```ts ref:call="api.call" ```` wraps every
 * `api.call` in a `<span data-ref="call">`, which lights with whatever else carries that ref (kit link).
 */

/**
 * Whether a page holds a fence, so it gets kit:code.css: as kit scripts are chosen (kit-scripts.ts), in its prerendered `html` or
 * in its client code (`scan`), which holds the fences of an .mdx fragment an island renders later or a filled view's records.
 */
export const holdsFence = (html: string, scan: string): boolean =>
	/<span class="code-line"/.test(html) || /["'`]code-line["'`]/.test(scan);

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
 * The columns of a line's leading whitespace at TAB, made even: a wrapped line's start (indent and code.css's 2ch hang) must
 * stay on a tab stop, which the browser measures from there, for the line's own tabs to keep their width.
 */
function indentOf(line: string): number {
	let columns = 0;
	for (const char of /^[ \t]*/.exec(line)?.[0] ?? "") {
		columns = char === "\t" ? columns + TAB - (columns % TAB) : columns + 1;
	}
	return columns + (columns % TAB);
}

/** A fence's code as line spans holding its ref and token spans; the newlines between them stay text, so copying is unchanged. */
function codeLines(text: string, tokens: (string | null)[], refs: string[]): ElementContent[] {
	const out: ElementContent[] = [];
	let start = 0;
	for (const line of text.split("\n")) {
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
		const indent = indentOf(line);
		if (end < text.length || line) {
			out.push(
				span(
					{ className: ["code-line"], ...(indent ? { style: `--indent:${indent}` } : {}) },
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

/** The rehype step for one page file (its name as errors show it): every code fence is drawn as lines, tokens and marks. */
export function codeFences(file: string) {
	const draw = (pre: Element, code: Element) => {
		const line = pre.position?.start.line;
		const fail = (what: string) => new PackError(`${file}${line ? `:${line}` : ""}: ${what}`);
		const text = code.children.map((child) => (child.type === "text" ? child.value : "")).join("");
		const language = languageOf(code);
		const tokens = language && refractor.registered(language) ? tokenClasses(text, language) : [];
		const refs = refsAt(text, marksOf(code.data?.meta ?? "", fail), fail);
		code.children = codeLines(text, tokens, refs);
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
