import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Element, Nodes as HastNodes, Root as HastRoot } from "hast";
import type { Root } from "mdast";
import { remarkMath } from "../../vendor/math.js";
import { compile, remarkFrontmatter, remarkGfm } from "../../vendor/mdx.js";
import { kitLabels } from "../kit.ts";
import { PackError } from "../pack-error.ts";
import { mathToMathml } from "./math.ts";
import { structurePage } from "./structure.ts";

/** What a page's YAML frontmatter sets; see MDX-ARM.md. */
export interface Frontmatter {
	title?: string;
	lang: string;
	/** kitLabels: the texts the kit scripts add, in the page's language. */
	labels?: Record<string, string>;
	/** The colour scheme the page is forced into (`<html data-scheme>`); unset, it follows the reader's system. */
	scheme?: "light" | "dark";
	/** Include reply.js (the reader's notes) on a page with no question. */
	reply: boolean;
}

/** An .mdx file compiled to a JavaScript module whose default export is the page's content component. */
export interface CompiledMdx {
	js: string;
	front: Frontmatter;
	/** The frontmatter title, else the text of the page's first `#`. */
	title: string | undefined;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEYS = "title, lang, labels, reply, scheme";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The frontmatter `labels` (undefined when absent) as kitLabels: texts by the keys the kit scripts read, as `kit labels` prints
 * them. Anything else throws `fail` with what to fix: a key no kit script reads would otherwise stay English without a word.
 */
function labelTexts(
	value: unknown,
	fail: (what: string) => PackError,
): Record<string, string> | undefined {
	if (value === undefined) {
		return undefined;
	}
	const entries = isRecord(value) ? Object.entries(value) : [];
	const strings = entries.flatMap(([key, text]) =>
		typeof text === "string" ? [[key, text] as const] : [],
	);
	if (!isRecord(value) || strings.length < entries.length) {
		throw fail("labels must be key: text lines; kit labels prints them all");
	}
	const known = new Set(kitLabels().flatMap((script) => Object.keys(script.labels)));
	const stray = strings.find(([key]) => !known.has(key))?.[0];
	if (stray !== undefined) {
		throw fail(
			`the kit has no label "${stray}"; kit labels prints every key with its English text`,
		);
	}
	return Object.fromEntries(strings);
}

/** The frontmatter's YAML as parsed, `{}` for none; a YAML error is a PackError naming the file. */
function frontmatterData(source: string, file: string): unknown {
	const yaml = FRONTMATTER.exec(source)?.[1];
	try {
		return yaml === undefined ? {} : (Bun.YAML.parse(yaml) ?? {});
	} catch (e) {
		throw new PackError(`${file} frontmatter: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** Reads and checks the frontmatter; anything pack would ignore or misread fails with the key to fix. */
function frontmatter(source: string, file: string): Frontmatter {
	const data = frontmatterData(source, file);
	const fail = (what: string) => new PackError(`${file} frontmatter: ${what}`);
	if (!isRecord(data)) {
		throw fail(`write key: value lines (${KEYS})`);
	}
	const { title, lang = "en", labels, reply = false, scheme, ...rest } = data;
	const unknown = Object.keys(rest)[0];
	if (unknown !== undefined) {
		throw fail(`pack does not read "${unknown}"; the keys are ${KEYS}`);
	}
	if (title !== undefined && typeof title !== "string") {
		throw fail("title must be text");
	}
	if (typeof lang !== "string") {
		throw fail("lang must be a language tag such as de");
	}
	if (typeof reply !== "boolean") {
		throw fail("reply must be true or false");
	}
	if (scheme !== undefined && scheme !== "light" && scheme !== "dark") {
		throw fail("scheme must be light or dark; leave it out to follow the reader's system");
	}
	const kitTexts = labelTexts(labels, fail);
	return {
		lang,
		reply,
		...(title === undefined ? {} : { title }),
		...(kitTexts ? { labels: kitTexts } : {}),
		...(scheme === undefined ? {} : { scheme }),
	};
}

/**
 * What pack warns about in a page's frontmatter: a language other than English without labels, whose kit texts (the stepper's
 * buttons, the reply, Show answer) would stay English beside the page's own words.
 */
export function frontmatterWarnings({ lang, labels }: Frontmatter): string[] {
	return /^en(-|$)/i.test(lang) || labels
		? []
		: [
				`lang is "${lang}" but the frontmatter has no labels, so the texts the kit adds (Back, Next, Reply, Show answer) are English: run kit labels, translate the block and paste it into the frontmatter`,
			];
}

/** Every element of the tree, depth first. */
function* elementsOf(node: HastNodes): Generator<Element> {
	if (node.type === "element") {
		yield node;
	}
	if ("children" in node) {
		for (const child of node.children) {
			yield* elementsOf(child);
		}
	}
}

/**
 * ```mermaid fences (`<pre><code class="language-mermaid">`) become `<pre class="mermaid">` with the source as their text, which
 * pack draws as one SVG in the HTML pass.
 */
function mermaidFences(tree: HastRoot) {
	for (const pre of elementsOf(tree)) {
		const [code] = pre.children;
		if (pre.tagName !== "pre" || code?.type !== "element") {
			continue;
		}
		const { className } = code.properties;
		if (Array.isArray(className) && className.includes("language-mermaid")) {
			pre.properties = { className: ["mermaid"] };
			pre.children = code.children;
		}
	}
}

/** The plain text of a hast node, as a cell's label. */
const hastText = (node: HastNodes): string =>
	node.type === "text"
		? node.value
		: "children" in node
			? node.children.map(hastText).join("")
			: "";

const childElements = (node: Element, tag: string) =>
	node.children.filter(
		(child): child is Element => child.type === "element" && child.tagName === tag,
	);

/** Rows of a table section (`thead`, `tbody`). */
const rowsOf = (table: Element, part: string) =>
	childElements(table, part).flatMap((section) => childElements(section, "tr"));

/** A body row as v0.8 writes it: the first cell heads the row, every other cell carries its column's name for the phone layout. */
function labelRow(row: Element, labels: string[]) {
	for (const [i, cell] of childElements(row, "td").entries()) {
		const label = labels[i];
		if (i === 0) {
			cell.tagName = "th";
			cell.properties = { ...cell.properties, scope: "row" };
		} else if (label) {
			cell.properties = { ...cell.properties, dataLabel: label };
		}
	}
}

/**
 * A cell's Markdown alignment as v0.8 writes it: a right-aligned column (`---:`) is a numeric one, `class="num"`, which lines its
 * digits up on wide screens and reads beside its label on phones. Other alignments are dropped: cells align to the start as in
 * v0.8, and on phones an aligned cell would push its label away from the value.
 */
function numericCell(cell: Element) {
	const { align, ...rest } = cell.properties;
	cell.properties = align === "right" ? { className: ["num"], ...rest } : rest;
}

/**
 * Markdown tables become the kit's `table.compare`, as a v0.8 page writes one: each body row's first cell is its header
 * (`<th scope="row">`), every other cell carries its column's header as `data-label`, which the phone layout shows beside
 * the value, and a right-aligned column is `class="num"` (numericCell).
 */
function compareTables(tree: HastRoot) {
	for (const table of elementsOf(tree)) {
		if (table.tagName !== "table") {
			continue;
		}
		table.properties = { ...table.properties, className: ["compare"] };
		for (const cell of elementsOf(table)) {
			if (cell.tagName === "th" || cell.tagName === "td") {
				numericCell(cell);
			}
		}
		const [head] = rowsOf(table, "thead");
		const labels = head ? childElements(head, "th").map(hastText) : [];
		for (const row of rowsOf(table, "tbody")) {
			labelRow(row, labels);
		}
	}
}

/** A message from the MDX parser: where in the file it is and what is wrong. */
interface MdxMessage {
	reason: string;
	line?: number | undefined;
	column?: number | undefined;
}
const isMdxMessage = (e: unknown): e is MdxMessage =>
	e instanceof Error && "reason" in e && typeof e.reason === "string";

/**
 * Compiles an .mdx file for Preact: frontmatter, GFM (tables as table.compare, task lists, strikethrough, autolinks), TeX math
 * as MathML (math.ts), Mermaid fences and the page
 * layout (structure.ts) when `page` is set, the page's own file; an imported .mdx file is compiled as a fragment. A syntax error
 * throws PackError with file:line:column.
 */
export async function compileMdx(path: string, page: boolean): Promise<CompiledMdx> {
	const file = relative(process.cwd(), path) || path;
	const value = readFileSync(path, "utf8");
	const front = frontmatter(value, file);
	let h1: string | undefined;
	try {
		const compiled = await compile(
			{ path, value },
			{
				jsxImportSource: "preact",
				elementAttributeNameCase: "html",
				remarkPlugins: [
					remarkFrontmatter,
					remarkGfm,
					remarkMath,
					() => (tree: Root) => {
						if (page) {
							h1 = structurePage(tree);
						}
					},
				],
				rehypePlugins: [() => mermaidFences, () => compareTables, mathToMathml(file)],
			},
		);
		return { js: String(compiled.value), front, title: front.title ?? h1 };
	} catch (e) {
		if (!isMdxMessage(e)) {
			throw e;
		}
		const at = e.line === undefined ? "" : `:${e.line}:${e.column ?? 1}`;
		throw new PackError(`${file}${at}: ${e.reason}`);
	}
}
