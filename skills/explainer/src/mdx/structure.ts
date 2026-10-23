import type { BlockContent, DefinitionContent, Heading, Nodes, Paragraph, Root } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import type {} from "mdast-util-to-hast"; // its Data fields (hName, hProperties, hChildren) shape what the nodes render as

/** Content of a flow container: everything a page, a section or a view holds. */
type Flow = BlockContent | DefinitionContent;

/** The element a container's head is wrapped in: `header.masthead` on the overview, `div.view-head` in a view. */
interface Head {
	tag: string;
	className: string;
}

/** At the root of an MDX tree everything but `import`/`export` and frontmatter is flow content. */
const isFlow = (node: Root["children"][number]): node is Flow =>
	node.type !== "mdxjsEsm" && node.type !== "yaml";

const isJsx = (node: Nodes, name: string): node is MdxJsxFlowElement =>
	node.type === "mdxJsxFlowElement" && node.name === name;

const isHeading = (node: Nodes, depth: number): node is Heading =>
	node.type === "heading" && node.depth === depth;

/** A JSX element in the tree, as if the author had written `<name attribute="value">` around `children`. */
const element = (
	name: string,
	attributes: Record<string, string>,
	children: Flow[],
): MdxJsxFlowElement => ({
	type: "mdxJsxFlowElement",
	name,
	attributes: Object.entries(attributes).map(([key, value]) => ({
		type: "mdxJsxAttribute",
		name: key,
		value,
	})),
	children,
});

const withClass = (paragraph: Paragraph, className: string) => {
	paragraph.data = { ...paragraph.data, hProperties: { className: [className] } };
	return paragraph;
};

/** The plain text of a node, as a title. */
export const textOf = (node: Nodes): string =>
	"value" in node ? node.value : "children" in node ? node.children.map(textOf).join("") : "";

/** A `#` and the paragraphs right under it, as the container's head; the first paragraph is the `.lede`, later ones `.meta`. */
function headOf(
	nodes: Flow[],
	at: number,
	head: Head,
): { element: MdxJsxFlowElement; next: number } {
	const children: Flow[] = nodes.slice(at, at + 1);
	let next = at + 1;
	for (let node = nodes[next]; node?.type === "paragraph"; node = nodes[++next]) {
		children.push(withClass(node, next === at + 1 ? "lede" : "meta"));
	}
	return { element: element(head.tag, { class: head.className }, children), next };
}

/** A node a `##` section does not take in: the next `#`, or an element the author wrapped in `<section>` (or a view) themselves. */
const endsSection = (node: Flow) =>
	isHeading(node, 1) || isJsx(node, "section") || isJsx(node, "View");

/**
 * The house layout of one flow container (the overview or a view): its first `#` with the paragraphs right under it becomes the
 * head (`header.masthead` or `div.view-head`), and each `##` with what follows, up to the next `#`/`##` or an element the author
 * wrapped in `<section>` themselves, becomes a `<section>`.
 */
function layout(nodes: Flow[], head: Head): Flow[] {
	const out: Flow[] = [];
	let section: Flow[] | undefined;
	let headDone = false;
	for (let i = 0; i < nodes.length; ) {
		const node = nodes[i];
		if (node && isHeading(node, 1) && !headDone) {
			headDone = true;
			const taken = headOf(nodes, i, head);
			out.push(taken.element);
			section = undefined;
			i = taken.next;
			continue;
		}
		if (node && isHeading(node, 2)) {
			section = [node];
			out.push(element("section", {}, section));
		} else if (node && endsSection(node)) {
			section = undefined;
			out.push(node);
		} else if (node) {
			(section ?? out).push(node);
		}
		i++;
	}
	return out;
}

/**
 * Reshapes an MDX page's tree into the page skeleton the theme and views.js expect: the content outside views goes into
 * `<div data-overview>` with the masthead and sections laid out, and every top-level `<View>` follows it, laid out the same way
 * inside. `import`/`export` and frontmatter stay at the top. Returns the text of the page's first `#`, the default title.
 */
export function structurePage(tree: Root): string | undefined {
	const content = tree.children.filter(isFlow);
	const views = content.filter((node) => isJsx(node, "View"));
	for (const view of views) {
		view.children = layout(view.children, { tag: "div", className: "view-head" });
	}
	const overview = content.filter((node) => !isJsx(node, "View"));
	const title = overview.find((node) => isHeading(node, 1));
	tree.children = [
		...tree.children.filter((node) => !isFlow(node)),
		element(
			"div",
			{ "data-overview": "" },
			layout(overview, { tag: "header", className: "masthead" }),
		),
		...views,
	];
	return title && textOf(title);
}
