import { readFileSync } from "node:fs";
import type { Element, ElementContent, Nodes as HastNodes, Root as HastRoot } from "hast";
import type { Nodes, Root } from "mdast";
import type { MdxJsxFlowElementHast, MdxJsxTextElementHast } from "mdast-util-mdx-jsx";
import { remarkMath } from "../../vendor/math.js";
import { compile, remarkFrontmatter, remarkGfm } from "../../vendor/mdx.js";
import { kitLabels } from "../kit.ts";
import { PackError } from "../pack-error.ts";
import { shownPath } from "../paths.ts";
import { codeFences } from "./code.ts";
import { lowercaseImports } from "./esm.ts";
import { displayParagraphs, mathToMathml } from "./math.ts";
import { origins } from "./origins.ts";
import { spliceParts } from "./parts.ts";
import { structurePage } from "./structure.ts";

/** What a page's YAML frontmatter sets; authors read it in kit/components/index.ts (kit page). */
export interface Frontmatter {
	title?: string;
	lang: string;
	/** kitLabels: the texts the kit scripts add, in the page's language. */
	labels?: Record<string, string>;
	/** The colour scheme the page is forced into (`<html data-scheme>`); unset, it follows the reader's system. */
	scheme?: "light" | "dark";
	/** Include reply.js (the reader's notes) on a page with no question. */
	reply: boolean;
	/** The URL the reply dialog's Send posts to (a `serve` endpoint); written into the page, which brings reply.js. */
	replyTo?: string;
	/** Give the page the contents rail of its sections (`<main data-contents>`), views or not. */
	contents: boolean;
	/** The display face for the headline and section headings (kit:display.css); unset, they are in the kit's text face. */
	display?: "condensed";
}

/** An .mdx file compiled to a JavaScript module whose default export is the page's content component. */
export interface CompiledMdx {
	js: string;
	front: Frontmatter;
	/** The frontmatter title, else the text of the page's first `#`. */
	title: string | undefined;
	/** What pack warns about the page's parts (parts.ts): parts kept as components whose headings make no sections. */
	warnings: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEYS = "title, lang, labels, reply, replyTo, contents, scheme, display";

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

/**
 * The frontmatter `replyTo` as Frontmatter holds it: absent, or an absolute http(s) URL without credentials, written as the
 * URL parser writes it, so the page posts exactly there whatever document it is opened as; anything else throws `fail`.
 */
function replyEndpoint(value: unknown, fail: (what: string) => PackError): { replyTo?: string } {
	if (value === undefined) {
		return {};
	}
	const url = typeof value === "string" && URL.canParse(value) ? new URL(value) : undefined;
	if (!url || !/^https?:$/.test(url.protocol)) {
		throw fail(
			"replyTo must be the absolute http(s) URL replies are sent to, such as http://127.0.0.1:4747/api/pages/plan/replies (serve prints it)",
		);
	}
	if (url.username || url.password) {
		throw fail(
			"replyTo must not carry a user name or password: every reader of the page would get them; write the URL without them",
		);
	}
	return { replyTo: url.href };
}

/** Reads and checks the frontmatter; anything pack would ignore or misread fails with the key to fix. */
function frontmatter(source: string, file: string): Frontmatter {
	const data = frontmatterData(source, file);
	const fail = (what: string) => new PackError(`${file} frontmatter: ${what}`);
	if (!isRecord(data)) {
		throw fail(`write key: value lines (${KEYS})`);
	}
	const {
		title,
		lang = "en",
		labels,
		reply = false,
		replyTo,
		contents = false,
		scheme,
		display,
		...rest
	} = data;
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
	if (typeof contents !== "boolean") {
		throw fail("contents must be true or false");
	}
	if (scheme !== undefined && scheme !== "light" && scheme !== "dark") {
		throw fail("scheme must be light or dark; leave it out to follow the reader's system");
	}
	if (display !== undefined && display !== "condensed") {
		throw fail(
			"display takes condensed (Barlow Condensed headings); leave it out for the kit's face",
		);
	}
	const kitTexts = labelTexts(labels, fail);
	return {
		lang,
		reply,
		contents,
		...(title === undefined ? {} : { title }),
		...replyEndpoint(replyTo, fail),
		...(kitTexts ? { labels: kitTexts } : {}),
		...(scheme === undefined ? {} : { scheme }),
		...(display === undefined ? {} : { display }),
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

/** The fence languages pack draws as a figure of their own. */
const DRAWN_FENCES = ["mermaid", "schematic"];

/**
 * ```mermaid and ```schematic fences (`<pre><code class="language-mermaid">`) become `<pre class="mermaid">` (or `schematic`) with
 * the source as their text, which pack draws as one SVG in the HTML pass. A mermaid fence's meta (its number tags) goes along as
 * data-meta.
 */
function drawnFences(tree: HastRoot) {
	for (const pre of elementsOf(tree)) {
		const [code] = pre.children;
		if (pre.tagName !== "pre" || code?.type !== "element") {
			continue;
		}
		const { className } = code.properties;
		const language = DRAWN_FENCES.find(
			(name) => Array.isArray(className) && className.includes(`language-${name}`),
		);
		if (language) {
			const meta = language === "mermaid" ? code.data?.meta : undefined;
			pre.properties = { className: [language], ...(meta ? { dataMeta: meta } : {}) };
			pre.children = code.children;
		}
	}
}

/** A word whose case carries meaning: a small letter, and a capital after its first letter (kWh, MHz, dB, iPhone). */
const casedWord = (word: string) => /\p{Ll}/u.test(word) && /\p{Lu}/u.test(word.slice(1));

/** `text` as text nodes, each cased word (casedWord) in `<span class="cased">`. */
function casedText(text: string): ElementContent[] {
	const parts = text.split(/(\p{L}+)/u);
	return parts.flatMap((part, i): ElementContent[] =>
		i % 2 === 1 && casedWord(part)
			? [
					{
						type: "element",
						tagName: "span",
						properties: { className: ["cased"] },
						children: [{ type: "text", value: part }],
					},
				]
			: part
				? [{ type: "text", value: part }]
				: [],
	);
}

/** An element as Markdown makes it or as JSX in the MDX writes it (`<h2 data-nav>`); both hold the same children. */
type Tagged = Element | MdxJsxFlowElementHast | MdxJsxTextElementHast;

const isTagged = (node: HastNodes): node is Tagged =>
	node.type === "element" || node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

/** `node`'s tag name, whether Markdown or JSX wrote it; a JSX fragment (`<>`) has none. */
const tagOf = (node: Tagged): string | null => (node.type === "element" ? node.tagName : node.name);

/** Code a reader may copy: display.css keeps its case (display.css), and pack leaves its text alone. */
const VERBATIM = new Set(["code", "kbd", "samp"]);

/** Wraps the cased words in `node`'s text, at any depth but code, so a display face's capitals leave them as written. */
function keepCase(node: Tagged) {
	node.children = node.children.flatMap((child) => {
		if (child.type === "text") {
			return casedText(child.value);
		}
		if (isTagged(child) && !VERBATIM.has(tagOf(child) ?? "")) {
			keepCase(child);
		}
		return [child];
	});
}

/**
 * For a display face (frontmatter display): the cased words of each `#` and `##` heading, Markdown or JSX, keep their case under
 * its capitals.
 */
function casedHeadings(node: HastNodes) {
	if (isTagged(node) && ["h1", "h2"].includes(tagOf(node) ?? "")) {
		keepCase(node);
		return;
	}
	if ("children" in node) {
		for (const child of node.children) {
			casedHeadings(child);
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

/** A body row as v0.8 writes it: the first cell heads the row, every other cell carries its column's name. */
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
 * digits up. Other alignments are dropped: cells align to the start as in v0.8.
 */
function numericCell(cell: Element) {
	const { align, ...rest } = cell.properties;
	cell.properties = align === "right" ? { className: ["num"], ...rest } : rest;
}

/**
 * Markdown tables become the kit's `table.compare` in a `div.scroll`, as a v0.8 page writes one: each body row's first cell is its header
 * (`<th scope="row">`), every other cell carries its column's header as `data-label`, and a right-aligned column is `class="num"` (numericCell).
 */
function compareTables(tree: HastRoot) {
	inScrollBoxes(tree);
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

/**
 * Puts each table in a `div.scroll`, the box a phone scrolls a table too wide for it in, so the table keeps its columns'
 * readable widths (theme.css); a Table component draws the same.
 */
function inScrollBoxes(node: HastNodes) {
	if (!("children" in node)) {
		return;
	}
	node.children = node.children.map((child) => {
		if (child.type === "element" && child.tagName === "table") {
			return {
				type: "element",
				tagName: "div",
				properties: { className: ["scroll"] },
				children: [child],
			};
		}
		inScrollBoxes(child);
		return child;
	});
}

/** Markdown destinations are strings, not MDX expressions; JSX is the dynamic-link form. */
function linkExpressions(node: Nodes, file: string) {
	if ((node.type === "link" || node.type === "definition") && /\{[^}]*\}/.test(node.url)) {
		throw new PackError(
			`${file}:${node.position?.start.line ?? 1}: Markdown link destinations do not evaluate expressions: write <a href={...}>...</a> for a dynamic link, or encode literal braces as %7B and %7D`,
		);
	}
	if ("children" in node) {
		for (const child of node.children) {
			linkExpressions(child, file);
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

/** The error a message from the MDX parser becomes: the file and, when it has one, line:column. */
const parseError = (e: MdxMessage, file: string) =>
	new PackError(`${file}${e.line === undefined ? "" : `:${e.line}:${e.column ?? 1}`}: ${e.reason}`);

/** Stops a part's processing once its Markdown is read (MDX's own steps and the remark plugins), before it is compiled. */
const READ = new Error("read");

/**
 * Reads an .mdx part as the page's Markdown is read: parsed with the same plugins, through MDX's own first step (JSX alone in
 * a paragraph is a block), with the checks every file gets; it is not compiled, since parts.ts splices it into the page.
 */
async function readPart(path: string): Promise<{ tree: Root; text: string }> {
	const file = shownPath(path);
	const text = readFileSync(path, "utf8");
	frontmatter(text, file);
	let read: Root | undefined;
	const remarkPlugins = [
		remarkFrontmatter,
		remarkGfm,
		remarkMath,
		() => (tree: Root) => {
			fileChecks(tree, file);
			read = tree;
			throw READ;
		},
	];
	try {
		await compile({ path, value: text }, { remarkPlugins });
	} catch (e) {
		if (e !== READ) {
			throw isMdxMessage(e) ? parseError(e, file) : e;
		}
	}
	if (!read) {
		throw new Error(`${file} was not read`);
	}
	return { tree: read, text };
}

/** What pack checks in every .mdx file's tree, page or part: link destinations and tags that name an import in lower case. */
function fileChecks(tree: Root, file: string) {
	linkExpressions(tree, file);
	lowercaseImports(tree, file);
}

/**
 * Compiles an .mdx file for Preact: frontmatter, GFM (tables as table.compare, task lists, strikethrough, autolinks), TeX math
 * as MathML (math.ts), Mermaid fences, code fences as lines and tokens (code.ts) and, when `page` is true (the page's own file),
 * its parts spliced in (parts.ts) and the page layout (structure.ts). Otherwise `page` is the frontmatter of the page that
 * imports the file, compiled as a fragment whose headings follow that page's display face. A syntax error throws PackError
 * with file:line:column, in the part that has it.
 */
export async function compileMdx(
	path: string,
	page: true | Pick<Frontmatter, "display">,
): Promise<CompiledMdx> {
	const file = shownPath(path);
	const value = readFileSync(path, "utf8");
	const front = frontmatter(value, file);
	const display = page === true ? front.display : page.display;
	const sources = origins(file, value);
	const loadPart = async (part: string) => {
		const { tree, text } = await readPart(part);
		sources.add(shownPath(part), text, tree);
		return tree;
	};
	let h1: string | undefined;
	const warnings: string[] = [];
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
					() => async (tree: Root, vfile: { value: unknown }) => {
						fileChecks(tree, file);
						if (page === true) {
							warnings.push(...(await spliceParts(tree, path, loadPart)));
							// Math reads a formula's source at its offsets, which for a part's nodes are in the joined text.
							vfile.value = sources.text();
						}
						displayParagraphs(tree, String(vfile.value));
						if (page === true) {
							h1 = structurePage(tree);
						}
					},
				],
				rehypePlugins: [
					() => drawnFences,
					() => compareTables,
					mathToMathml(sources.where),
					codeFences(sources.where),
					...(display ? [() => casedHeadings] : []),
				],
			},
		);
		return { js: String(compiled.value), front, title: front.title ?? h1, warnings };
	} catch (e) {
		if (!isMdxMessage(e)) {
			throw e;
		}
		throw new PackError(
			`${e.line === undefined ? file : sources.where({ line: e.line, column: e.column ?? 1 }, true)}: ${e.reason}`,
		);
	}
}
