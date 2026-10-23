/* View: a drill-down view at #name or #name/param inside the one file, with Back, breadcrumbs, previous/next and a contents rail.
   <View name="person" param="ana" back="Team">

   # Ana Novak

   Leads the firmware work.

   ## Tasks
   ...
   </View>
     name    the view's name: a link to #name (or #name/param) opens it
     param   the record this view shows (#person/ana); leave it out for a single view at #name
     back    the text of its Back link, naming the overview
   Its # and the paragraphs right under it are the view's head (the first one its lede), and each ## starts a section, as on
   the page. pack puts every View after the overview wherever the page renders it, so one View per record works from data:
   {people.map((p) => <View name="person" param={p.id} back="Team"><h1>{p.name}</h1><p>{p.role}</p><section>...</section></View>)}
   Navigation needs no markup of its own. Link every view from the overview with a table or list whose link text names it
   briefly ("Ana", "1.6.3 Login form"): the crumbs and previous/next show that text, and a generic one ("Open") gives way to the
   view's heading. Previous and next walk the views of its kind (the ones the view it was opened from links to, else all of
   them); a page with views inside views (two or more view names) gets a contents rail of its sections. A section with two or
   more folds gets Expand all. A View is static: put client components inside it, not a View inside a client component. */
import { type ComponentChildren, cloneElement, h, toChildArray, type VNode } from "preact";

export interface ViewProps {
	name: string;
	param?: string;
	back?: string;
	id?: string;
	children?: ComponentChildren;
}

/** The element pack moves, with its content, after the overview (hoistViews in src/mdx/page.ts); it never reaches the page. */
const VIEW_MARKER = "explainer-view";

const isElement = (node: unknown, tag: string): node is VNode<{ class?: string }> =>
	typeof node === "object" && node !== null && "type" in node && node.type === tag;

/**
 * The view's head as views.js and the theme expect it: the Back link, the leading `#` and the paragraphs right under it, the
 * first marked `.lede` and later ones `.meta` (a class the author gave a paragraph stays). Returns the head and the rest.
 */
function splitHead(children: ComponentChildren, back: string | undefined) {
	const nodes = toChildArray(children);
	const head: ComponentChildren[] = back
		? [
				// biome-ignore lint/a11y/useValidAnchor: an empty hash is the overview's address in views.js, the v0.8 Back link
				<a class="back" href="#">
					{back}
				</a>,
			]
		: [];
	let next = 0;
	const heading = nodes[0];
	if (isElement(heading, "h1")) {
		head.push(heading);
		next = 1;
		for (let node = nodes[next]; isElement(node, "p"); node = nodes[++next]) {
			head.push(
				node.props.class ? node : cloneElement(node, { class: next === 1 ? "lede" : "meta" }),
			);
		}
	}
	return { head, rest: nodes.slice(next) };
}

/** Renders `<section class="view" data-view="name[/param]">` with its `.view-head`, inside the marker pack hoists by. */
export function View({ name, param, back, id, children }: ViewProps) {
	const { head, rest } = splitHead(children, back);
	return h(
		VIEW_MARKER,
		null,
		<section class="view" data-view={param === undefined ? name : `${name}/${param}`} id={id}>
			{head.length > 0 && <div class="view-head">{head}</div>}
			{rest}
		</section>,
	);
}
