/*
 * The layout a View gives its content, shared by the static View (kit/components/view.tsx) and the record a filled View draws
 * in the browser (kit/islands/client.ts, and kit/islands/server.ts, which tries each record at pack time). Plain h() calls, no
 * JSX, so the islands runtime can import it under the CLI's tsconfig too.
 */
import { type ComponentChildren, Fragment, h, toChildArray, type VNode } from "preact";
import { useState } from "preact/hooks";
import { anonymousPlace, PlaceContext } from "./parts/place.ts";

/** A filled view's `render` as the kit calls it, for any record. */
export type DrawRecord = (props: { record: unknown }) => ComponentChildren;

/** What a filled view's island carries: the records by param, and the Back link's text. */
export interface FillProps {
	records: Record<string, unknown>;
	back?: string;
}

/**
 * What kit/islands/server.ts adds to a client component for a filled View: `fill` records the island that draws `view` from
 * `props` in the browser. A component without it is not a client component.
 */
export interface Fillable {
	fill(view: string, props: FillProps): void;
}

const isElement = (node: unknown, tag: unknown): node is VNode =>
	typeof node === "object" && node !== null && "type" in node && node.type === tag;

/**
 * The view's content as views.js and the theme expect it: a `.view-head` with the Back link (an empty hash is the overview's
 * address in views.js) and the leading `#`; then the rest, paragraphs under the `#` included, as body text.
 */
export function viewBody(children: ComponentChildren, back: string | undefined): VNode {
	const nodes = toChildArray(children);
	const head: ComponentChildren[] = back ? [h("a", { class: "back", href: "#" }, back)] : [];
	const heading = nodes[0];
	const titled = isElement(heading, "h1");
	if (titled) {
		head.push(heading);
	}
	return h(
		Fragment,
		null,
		head.length > 0 && h("div", { class: "view-head" }, head),
		nodes.slice(titled ? 1 : 0),
	);
}

/**
 * One record of a filled view, laid out as a static View lays out its children; an unknown param (no record) shows the head
 * alone. `render` is called rather than rendered, so its output can be split into head and rest: its hooks are this
 * component's, which the browser keys by the param, so each record starts with fresh state, and a place of its own for the
 * Controls it draws.
 */
export function FilledRecord({
	render,
	record,
	back,
}: {
	render: DrawRecord;
	record: unknown;
	back: string | undefined;
}): ComponentChildren {
	const [place] = useState(anonymousPlace);
	const out = record === undefined ? null : render({ record });
	return h(
		PlaceContext.Provider,
		{ value: place },
		viewBody(
			isElement(out, Fragment) ? (out.props as { children?: ComponentChildren }).children : out,
			back,
		),
	);
}
