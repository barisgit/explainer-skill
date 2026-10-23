/*
 * The browser side of .mdx pages: pack bundles this module with the page's client components into one script and calls
 * hydrateIslands with those modules. Each island pack prerendered (islands/server.ts) sits between `<!--island:N-->` and
 * `<!--/island-->`; it is hydrated in place with the props in `<script type="application/json" id="explainer-islands">`,
 * with no wrapper element, so the theme's child selectors still match.
 */
import { type ComponentType, type ContainerNode, h, hydrate } from "preact";
import "./bare-data.ts";

/** One island as pack writes it: the index of its module in hydrateIslands' list, its export name and its props. */
interface IslandData {
	m: number;
	e: string;
	p: Record<string, unknown>;
}

/**
 * A stand-in parent for the nodes between two comment markers, so Preact hydrates and later renders into that range of the
 * real parent: inserts go before the end marker, and the children are read afresh on every access.
 */
function range(start: Comment, end: Comment): ContainerNode {
	const parent = end.parentNode;
	if (!parent) {
		throw new Error("island marker without a parent");
	}
	const nodes = () => {
		const list: ChildNode[] = [];
		for (let node = start.nextSibling; node && node !== end; node = node.nextSibling) {
			list.push(node);
		}
		return list;
	};
	// Preact hands these methods only the DOM nodes it made or found, so they are real Nodes.
	const dom = (node: ContainerNode) => node as Node;
	return {
		nodeType: 1,
		parentNode: parent,
		get firstChild() {
			return nodes()[0] ?? null;
		},
		get childNodes() {
			return nodes();
		},
		contains: (other) => nodes().some((node) => other !== null && node.contains(dom(other))),
		insertBefore: (node, child) => parent.insertBefore(dom(node), child ? dom(child) : end),
		appendChild: (node) => parent.insertBefore(dom(node), end),
		removeChild: (child) => parent.removeChild(dom(child)),
	};
}

/** The start and end comment of every island in the document, by island number. */
function markers(): Map<number, [Comment, Comment]> {
	const found = new Map<number, [Comment, Comment]>();
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
	let open: { n: number; start: Comment } | undefined;
	for (let comment = walker.nextNode(); comment; comment = walker.nextNode()) {
		if (!(comment instanceof Comment)) {
			continue;
		}
		const start = /^island:(\d+)$/.exec(comment.data);
		if (start) {
			open = { n: Number(start[1]), start: comment };
		} else if (comment.data === "/island" && open) {
			found.set(open.n, [open.start, comment]);
			open = undefined;
		}
	}
	return found;
}

/** Hydrates every prerendered island with the component its module exports. `modules` are in the order pack numbered them. */
export function hydrateIslands(modules: Record<string, unknown>[]): void {
	const data: IslandData[] = JSON.parse(
		document.getElementById("explainer-islands")?.textContent ?? "[]",
	);
	// All markers are found before any island renders, since rendering changes the DOM between them.
	const found = markers();
	for (const [n, { m, e, p }] of data.entries()) {
		const component = modules[m]?.[e];
		const pair = found.get(n);
		if (typeof component !== "function" || !pair) {
			throw new Error(`island ${n} (${e}) is missing from the page`);
		}
		hydrate(h(component as ComponentType<Record<string, unknown>>, p), range(...pair));
	}
}
