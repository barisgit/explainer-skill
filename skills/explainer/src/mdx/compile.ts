import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Element, Nodes as HastNodes, Root as HastRoot } from "hast";
import type { Nodes, Root } from "mdast";
import { compile, remarkFrontmatter, remarkGfm } from "../../vendor/mdx.js";
import { PackError } from "../pack-error.ts";
import { structurePage } from "./structure.ts";

/** What a page's YAML frontmatter sets; see MDX-ARM.md. */
export interface Frontmatter {
	title?: string;
	lang: string;
	/** kitLabels: the texts the kit scripts add, in the page's language. */
	labels?: Record<string, string>;
	/** Include reply.js (notes, keeping) on a page with no question. */
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
const KEYS = "title, lang, labels, reply";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** `value` as a map of texts, or undefined when it is not one. */
function texts(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const entries = Object.entries(value);
	const strings = entries.flatMap(([key, text]) =>
		typeof text === "string" ? [[key, text] as const] : [],
	);
	return strings.length === entries.length ? Object.fromEntries(strings) : undefined;
}

/** Reads and checks the frontmatter; anything pack would ignore or misread fails with the key to fix. */
function frontmatter(source: string, file: string): Frontmatter {
	const yaml = FRONTMATTER.exec(source)?.[1];
	let data: unknown;
	try {
		data = yaml === undefined ? {} : (Bun.YAML.parse(yaml) ?? {});
	} catch (e) {
		throw new PackError(`${file} frontmatter: ${e instanceof Error ? e.message : String(e)}`);
	}
	const fail = (what: string) => new PackError(`${file} frontmatter: ${what}`);
	if (!isRecord(data)) {
		throw fail(`write key: value lines (${KEYS})`);
	}
	const { title, lang = "en", labels, reply = false, ...rest } = data;
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
	const labelTexts = texts(labels);
	if (labels !== undefined && !labelTexts) {
		throw fail("labels must be key: text lines, the kitLabels keys of the kit files");
	}
	return {
		lang,
		reply,
		...(title === undefined ? {} : { title }),
		...(labelTexts ? { labels: labelTexts } : {}),
	};
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
 * Markdown tables become the kit's `table.compare`, as a v0.8 page writes one: each body row's first cell is its header
 * (`<th scope="row">`), and every other cell carries its column's header as `data-label`, which the phone layout shows beside
 * the value. A column aligned in Markdown (`---:`) keeps its alignment, as an inline style the theme's `text-align` does not
 * override.
 */
function compareTables(tree: HastRoot) {
	for (const table of elementsOf(tree)) {
		if (table.tagName !== "table") {
			continue;
		}
		table.properties = { ...table.properties, className: ["compare"] };
		const [head] = rowsOf(table, "thead");
		const labels = head ? childElements(head, "th").map(hastText) : [];
		for (const row of rowsOf(table, "tbody")) {
			labelRow(row, labels);
		}
		for (const cell of elementsOf(table)) {
			const { align, ...properties } = cell.properties;
			if (typeof align === "string") {
				cell.properties = { ...properties, style: `text-align: ${align}` };
			}
		}
	}
}

/** Every node of a Markdown tree, depth first. */
function* nodesOf(node: Nodes): Generator<Nodes> {
	yield node;
	if ("children" in node) {
		for (const child of node.children) {
			yield* nodesOf(child);
		}
	}
}

/**
 * A bare `data-*` attribute on an HTML element written in the MDX (`<fieldset data-reply>`) is empty, as in HTML. JSX would make
 * it `true`, which Preact writes as "true", and reply.js would take that for the question's label.
 */
function bareDataAttributes(tree: Root) {
	for (const node of nodesOf(tree)) {
		const isHtml =
			(node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
			/^[a-z]/.test(node.name ?? "");
		for (const attribute of isHtml ? node.attributes : []) {
			if (
				attribute.type === "mdxJsxAttribute" &&
				attribute.name.startsWith("data-") &&
				attribute.value == null
			) {
				attribute.value = "";
			}
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
 * Compiles an .mdx file for Preact: frontmatter, GFM (tables as table.compare, task lists, strikethrough, autolinks), Mermaid fences and the page
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
					() => (tree: Root) => {
						bareDataAttributes(tree);
						if (page) {
							h1 = structurePage(tree);
						}
					},
				],
				rehypePlugins: [() => mermaidFences, () => compareTables],
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
