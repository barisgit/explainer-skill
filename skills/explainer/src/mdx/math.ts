import type { Program } from "estree";
import type { Element, ElementContent, Root as HastRoot, RootContent } from "hast";
import type { Nodes as MdastNodes, Root as MdastRoot } from "mdast";
import type { MdxJsxAttribute, MdxJsxTextElementHast } from "mdast-util-mdx-jsx";
import { temml } from "../../vendor/math.js";
import { PackError } from "../pack-error.ts";
import type { Where } from "./origins.ts";

/**
 * TeX math in an .mdx page, rendered once in pack to MathML, which the browser lays out with no script: remark-math reads
 * `$...$` (inline) and `$$` on lines of their own (display) into `code.math-inline` and `pre > code.math-display`; this
 * rehype step replaces them. A paragraph that is one `$$...$$` on a single line is made display math before (displayParagraphs). Inline math is a `<math>` in the text; display math is a `<math display="block">` inside a
 * `div.math`, the box that scrolls sideways when the equation is wider than the column. kit:math.css styles both; pack adds
 * it to a page that holds math (MATH_ELEMENT).
 */

/** Markup that holds MathML: a page with it gets kit:math.css. */
export const MATH_ELEMENT = /<math[\s>]/;

/** The text of a code element: the TeX source remark-math put there. */
const source = (code: Element) =>
	code.children.map((child) => (child.type === "text" ? child.value : "")).join("");

const isMath = (node: ElementContent | undefined, kind: "inline" | "display"): node is Element =>
	node?.type === "element" &&
	node.tagName === "code" &&
	Array.isArray(node.properties.className) &&
	node.properties.className.includes(`math-${kind}`);

/** An attribute holding `{ __html: markup }`: the element's content written as given, as Preact's dangerouslySetInnerHTML does. */
function innerHtml(markup: string): MdxJsxAttribute {
	const estree: Program = {
		type: "Program",
		sourceType: "module",
		body: [
			{
				type: "ExpressionStatement",
				expression: {
					type: "ObjectExpression",
					properties: [
						{
							type: "Property",
							key: { type: "Identifier", name: "__html" },
							value: { type: "Literal", value: markup },
							kind: "init",
							method: false,
							shorthand: false,
							computed: false,
						},
					],
				},
			},
		],
	};
	return {
		type: "mdxJsxAttribute",
		name: "dangerouslySetInnerHTML",
		value: { type: "mdxJsxAttributeValueExpression", value: "", data: { estree } },
	};
}

const ROOT = /^<math((?:\s+[a-z-]+="[^"]*")*)>([\s\S]*)<\/math>$/;
const ATTRIBUTE = /([a-z-]+)="([^"]*)"/g;
/** Temml escapes attribute values for HTML; JSX string values are written unescaped and escaped again by Preact. */
const ENTITIES: Record<string, string> = {
	"&quot;": '"',
	"&#x27;": "'",
	"&lt;": "<",
	"&gt;": ">",
	"&amp;": "&",
};
const attributeValue = (value: string) =>
	value.replace(/&(?:quot|#x27|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);

/**
 * The `<math>` element Temml renders for `tex`, as an MDX JSX element: its own attributes as attributes and its content as
 * inner HTML, so the markup reaches the page exactly as Temml wrote it. `wrap: "none"` keeps an expression in one piece: Temml
 * would otherwise split it into rows that Chromium wraps at line ends. A TeX error fails the pack at the formula's line.
 */
function mathElement(tex: string, display: boolean, where: string): MdxJsxTextElementHast {
	let markup: string;
	try {
		markup = temml.renderToString(tex, { displayMode: display, wrap: "none", throwOnError: true });
	} catch (e) {
		const reason = e instanceof Error ? e.message.trim() : String(e);
		throw new PackError(`${where}: ${reason.replace(/^Temml parse error: /, "")}`);
	}
	const root = ROOT.exec(markup);
	if (!root) {
		throw new Error(`Temml wrote markup that is not one <math> element: ${markup.slice(0, 80)}`);
	}
	const [, attributes = "", inner = ""] = root;
	return {
		type: "mdxJsxTextElement",
		name: "math",
		attributes: [
			...[...attributes.matchAll(ATTRIBUTE)].map(
				([, name = "", value = ""]): MdxJsxAttribute => ({
					type: "mdxJsxAttribute",
					name,
					value: attributeValue(value),
				}),
			),
			innerHtml(inner),
		],
		children: [],
	};
}

/**
 * Why an inline formula looks like two dollar amounts rather than math ("costs $5 and $6", "$5-$10"), or undefined: Pandoc's rule,
 * which remark-math does not apply, is that the opening $ is followed and the closing $ preceded by a non-space, and the closing $
 * is not followed by a digit. Rendering such a span would set prose in math italics without a word of warning.
 */
function dollarAmounts(markdown: string, node: Element): string | undefined {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start === undefined || end === undefined) {
		return undefined;
	}
	const span = markdown.slice(start, end);
	const body = span.replace(/^\$+|\$+$/g, "");
	return /^\s|\s$/.test(body) || /\d/.test(markdown[end] ?? "")
		? `${span} reads as math between two dollar signs; write a dollar sign in prose as \\$`
		: undefined;
}

/** Keep closing punctuation in the same line box as the atomic formula, without changing the copied text. */
function withPunctuation(
	math: MdxJsxTextElementHast,
	next: RootContent | undefined,
): ElementContent {
	const tail = next?.type === "text" ? /^[,.…;:!?\p{Pe}\p{Pf}]+/u.exec(next.value)?.[0] : undefined;
	if (next?.type !== "text" || !tail) {
		return math;
	}
	next.value = next.value.slice(tail.length);
	return {
		type: "element",
		tagName: "span",
		properties: { className: ["math-tail"] },
		children: [math, { type: "text", value: tail }],
	};
}

/** A display equation's box: the `div.math` that scrolls sideways when the equation is wider than the column. */
const displayBox = (tex: string, where: string): Element => ({
	type: "element",
	tagName: "div",
	properties: { className: ["math"] },
	children: [mathElement(tex, true, where)],
});

/** The rehype step for one page file (`at` names a node's file, line and column): every math code element becomes MathML. */
export function mathToMathml(at: Where) {
	const where = (node: Element) => at(node.position?.start, true);
	/** The MathML for a math code element (a display one is its `pre`), or undefined for any other node. */
	const rendered = (node: RootContent, markdown: string): ElementContent | undefined => {
		if (node.type !== "element") {
			return undefined;
		}
		const [code] = node.children;
		if (node.tagName === "pre" && isMath(code, "display")) {
			return displayBox(source(code), where(node));
		}
		if (!isMath(node, "inline")) {
			return undefined;
		}
		const amounts = dollarAmounts(markdown, node);
		if (amounts) {
			throw new PackError(`${where(node)}: ${amounts}`);
		}
		return mathElement(source(node), false, where(node));
	};
	// Sections and views are MDX JSX elements (structure.ts), so the walk enters every node with children, not only elements.
	const visit = (parent: HastRoot | RootContent, markdown: string) => {
		if (!("children" in parent)) {
			return;
		}
		parent.children.forEach((child, i) => {
			const math = rendered(child, markdown);
			if (math) {
				parent.children[i] =
					math.type === "mdxJsxTextElement" ? withPunctuation(math, parent.children[i + 1]) : math;
			} else {
				visit(child, markdown);
			}
		});
	};
	return () => (tree: HastRoot, page: { value: unknown }) => visit(tree, String(page.value));
}

/**
 * Makes each paragraph that holds one `$$...$$` and nothing else a display equation, in the Markdown tree before the page is laid
 * out, so it is drawn, in a list item too, as an equation on lines of its own is. remark-math reads `$$` as display
 * math only on lines of its own and takes one written on a single line for inline math, which set alone would be a small
 * formula at the start of the line. `markdown` is the text the tree's offsets point into.
 */
export function displayParagraphs(tree: MdastRoot, markdown: string) {
	const visit = (node: MdastNodes) => {
		if (!("children" in node)) {
			return;
		}
		node.children.forEach((child, i) => {
			const display = child.type === "paragraph" ? loneMath(child.children, markdown) : undefined;
			if (display) {
				node.children[i] = display;
			} else {
				visit(child);
			}
		});
	};
	visit(tree);
}

/** The display math node for a paragraph's content that is one `$$...$$` (spaces around it aside), or undefined. */
function loneMath(content: MdastNodes[], markdown: string) {
	const shown = content.filter((child) => child.type !== "text" || child.value.trim());
	const [only] = shown;
	const start = only?.position?.start.offset;
	if (
		shown.length !== 1 ||
		only?.type !== "inlineMath" ||
		start === undefined ||
		!markdown.startsWith("$$", start)
	) {
		return undefined;
	}
	// The hast remark-math's own display node carries, which mathToMathml renders.
	const code: Element = {
		type: "element",
		tagName: "code",
		properties: { className: ["language-math", "math-display"] },
		children: [{ type: "text", value: only.value }],
	};
	return {
		type: "math" as const,
		value: only.value,
		meta: null,
		position: only.position,
		data: { hName: "pre", hChildren: [code] },
	};
}
