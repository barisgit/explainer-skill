import type { BlockContent, DefinitionContent, Heading, Nodes, Paragraph, Root } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import type {} from "mdast-util-to-hast"; // its Data fields (hName, hProperties, hChildren) shape what the nodes render as

/** Content of a flow container: everything a page, a section or a view holds. */
type Flow = BlockContent | DefinitionContent;

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
const textOf = (node: Nodes): string =>
	"value" in node ? node.value : "children" in node ? node.children.map(textOf).join("") : "";

/** A `#` and the paragraphs right under it, as the page's `header.masthead`; the first paragraph is the `.lede`, later ones `.meta`. */
function mastheadOf(nodes: Flow[], at: number): { element: MdxJsxFlowElement; next: number } {
	const children: Flow[] = nodes.slice(at, at + 1);
	let next = at + 1;
	for (let node = nodes[next]; node?.type === "paragraph"; node = nodes[++next]) {
		children.push(withClass(node, next === at + 1 ? "lede" : "meta"));
	}
	return { element: element("header", { class: "masthead" }, children), next };
}

/**
 * The `<section>` a `##` starts. A heading written `<h2 data-nav="Price">The price is 40 €</h2>` starts one too, and its
 * data-nav, the section's short name in the contents rail, moves to the section, where views.js reads it.
 */
function sectionOf(heading: Heading | MdxJsxFlowElement, children: Flow[]): MdxJsxFlowElement {
	const section = element("section", {}, children);
	if (heading.type === "mdxJsxFlowElement") {
		const isNav = (a: (typeof heading.attributes)[number]) =>
			a.type === "mdxJsxAttribute" && a.name === "data-nav";
		section.attributes = heading.attributes.filter(isNav);
		heading.attributes = heading.attributes.filter((a) => !isNav(a));
	}
	return section;
}

/**
 * The heading of the section `node` starts: a `##` or `<h2>`, or the one a component's children from the page open with. A
 * client component places those children (its slot) among its own markup, so the component and what follows it form the
 * section, with the heading as the section's direct child, where the theme and the contents rail look for it.
 */
function sectionHeading(node: Nodes): Heading | MdxJsxFlowElement | undefined {
	const component =
		node.type === "mdxJsxFlowElement" && /^[A-Z]/.test(node.name ?? "") && node.name !== "View";
	const heading = component ? node.children[0] : node;
	return isSectionHeading(heading) ? heading : undefined;
}

const isSectionHeading = (node: Nodes | undefined): node is Heading | MdxJsxFlowElement =>
	node !== undefined && (isHeading(node, 2) || isJsx(node, "h2"));

/** A node a section does not take in: the next `#`, or a section the author wrote themselves (to give it data-nav, say). */
const endsSection = (node: Flow) => isHeading(node, 1) || isJsx(node, "section");

/**
 * The house layout of one flow container (the overview or a view): each `##` (or `<h2>`, or a component whose children open
 * with one) with what follows, up to the next `#`/`##` or a `<section>` the author wrote themselves, becomes a `<section>`.
 * With `masthead` (the overview), its first `#` with the paragraphs right under it becomes the masthead; a View lays out its
 * own head (kit/components/view.tsx), so that a view rendered from data gets one too.
 */
function layout(nodes: Flow[], masthead: boolean): Flow[] {
	const out: Flow[] = [];
	let section: Flow[] | undefined;
	let headDone = !masthead;
	for (let i = 0; i < nodes.length; ) {
		const node = nodes[i];
		if (node && isHeading(node, 1) && !headDone) {
			headDone = true;
			const taken = mastheadOf(nodes, i);
			out.push(taken.element);
			section = undefined;
			i = taken.next;
			continue;
		}
		const heading = node && sectionHeading(node);
		if (node && heading) {
			section = [node];
			out.push(sectionOf(heading, section));
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

/** Every `<View>` written in the MDX, at any depth. */
function* viewsIn(node: Nodes): Generator<MdxJsxFlowElement> {
	if (isJsx(node, "View")) {
		yield node;
	}
	if ("children" in node) {
		for (const child of node.children) {
			yield* viewsIn(child);
		}
	}
}

/** A string written as a JavaScript literal without escapes or `${}`: `"usage"`, `'usage'` or `usage` in backquotes. */
const STRING_LITERAL = /^\s*(?:"([^"\\]*)"|'([^'\\]*)'|`([^`\\$]*)`)\s*$/;

/** The value of a JSX element's attribute when it is a constant string: `id="usage"` or `id={"usage"}`. */
const stringAttribute = (node: MdxJsxFlowElement, name: string): string | undefined => {
	const found = node.attributes.find((a) => a.type === "mdxJsxAttribute" && a.name === name);
	const value = found?.type === "mdxJsxAttribute" ? found.value : undefined;
	if (typeof value === "string" || value === undefined || value === null) {
		return value ?? undefined;
	}
	const [, ...quoted] = STRING_LITERAL.exec(value.value) ?? [];
	return quoted.find((text) => text !== undefined);
};

/**
 * Marks each `<Explore use="x">` written right after `<Controls id="x">` with `under`: the controls are in sight there, so the
 * figure's line of chosen values is left out on screen. Only pack sees the order the page was written in, and CSS cannot tell
 * which Controls a figure follows, so a Controls of another set between them would hide the line wrongly.
 */
function markUnder(node: Nodes) {
	if (!("children" in node)) {
		return;
	}
	for (const [i, child] of node.children.entries()) {
		const next = node.children[i + 1];
		const id = isJsx(child, "Controls") ? stringAttribute(child, "id") : undefined;
		if (id !== undefined && next && isJsx(next, "Explore") && stringAttribute(next, "use") === id) {
			next.attributes.push({ type: "mdxJsxAttribute", name: "under", value: null });
		}
		markUnder(child);
	}
}

/**
 * Reshapes an MDX page's tree into the page skeleton the theme and views.js expect: the content goes into `<div data-overview>`
 * with the masthead and sections laid out, and each `<View>` written in Markdown gets its sections laid out the same way.
 * Views stay where they are written: pack moves every rendered view after the overview (src/mdx/page.ts), including views a
 * page renders from data. `import`/`export` and frontmatter stay at the top. Returns the text of the page's first `#`, the
 * default title.
 */
export function structurePage(tree: Root): string | undefined {
	for (const view of viewsIn(tree)) {
		view.children = layout(view.children, false);
	}
	const content = tree.children.filter(isFlow);
	const title = content.find((node) => isHeading(node, 1));
	tree.children = [
		...tree.children.filter((node) => !isFlow(node)),
		element("div", { "data-overview": "" }, layout(content, true)),
	];
	markUnder(tree);
	return title && textOf(title);
}
