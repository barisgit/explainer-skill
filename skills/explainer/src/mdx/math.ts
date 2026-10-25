import type { Program } from "estree";
import type { Element, ElementContent, Root as HastRoot, RootContent } from "hast";
import type { MdxJsxAttribute, MdxJsxTextElementHast } from "mdast-util-mdx-jsx";
import { temml } from "../../vendor/math.js";
import { PackError } from "../pack-error.ts";

/**
 * TeX math in an .mdx page, rendered once in pack to MathML, which the browser lays out with no script: remark-math reads
 * `$...$` (inline) and `$$` on lines of their own (display) into `code.math-inline` and `pre > code.math-display`; this
 * rehype step replaces them. Inline math is a `<math>` in the text; display math is a `<math display="block">` inside a
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

/** The rehype step for one page file (its name as errors show it): every math code element becomes MathML. */
export function mathToMathml(file: string) {
	const where = (node: Element) => {
		const start = node.position?.start;
		return start ? `${file}:${start.line}:${start.column}` : file;
	};
	/** The MathML for a math code element (a display one is its `pre`), or undefined for any other node. */
	const rendered = (node: RootContent, markdown: string): ElementContent | undefined => {
		if (node.type !== "element") {
			return undefined;
		}
		const [code] = node.children;
		if (node.tagName === "pre" && isMath(code, "display")) {
			return {
				type: "element",
				tagName: "div",
				properties: { className: ["math"] },
				children: [mathElement(source(code), true, where(node))],
			};
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
				parent.children[i] = math;
			} else {
				visit(child, markdown);
			}
		});
	};
	return () => (tree: HastRoot, page: { value: unknown }) => visit(tree, String(page.value));
}
