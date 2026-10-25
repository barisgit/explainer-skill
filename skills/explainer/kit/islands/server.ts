/*
 * The prerender side of .mdx pages: pack bundles this module with the page and calls renderPage once, in Bun, to get the page's
 * static HTML. Client components ("islands": capitalised exports of a module whose first statement is "use client") render here
 * between `<!--island:N-->` and `<!--/island-->`, and their props are returned for the client bundle (islands/client.ts) to
 * hydrate with. An island's children from the page are its slot: rendered here once to static HTML, between `<!--slot:N-->`
 * and `<!--/slot-->` where the component places `children`. Never shipped in a page.
 */
import {
	type ComponentChildren,
	type ComponentType,
	Fragment,
	h,
	type Options,
	options,
	type VNode,
} from "preact";
import { renderToString } from "preact-render-to-string";
import {
	type DrawRecord,
	type Fillable,
	FilledRecord,
	type FillProps,
} from "../components/view-body.ts";
import "./bare-data.ts";
import { CLIENT_REFERENCE, isClientExport, notJson } from "./props.ts";

/** A function a client module exports, found at `path` in an island's props: the browser takes it from that module's exports. */
export interface ClientRef {
	path: (string | number)[];
	module: string;
	name: string;
}

/**
 * One prerendered client component: the module that defines it, its export name and the JSON props it hydrates with, with
 * `refs` put in place of the nulls at their paths. With `view`, it has no markup: it draws the open record of that filled View
 * in the browser, from props that are FillProps.
 */
export interface Island {
	module: string;
	name: string;
	props: Record<string, unknown>;
	refs?: ClientRef[];
	view?: string;
}

/** What the page would do wrong in the browser; the message is for the page's author. pack finds it by name, not by class. */
export class IslandError extends Error {
	override name = "IslandError";
}

/** The elements a prerendered island and its slot sit in until renderPage turns them into comment markers. */
const MARKER = "explainer-island";
const SLOT = "explainer-slot";

/** Above 0 while an island renders: its handlers hydrate, and an island inside it is a plain part of it. */
let depth = 0;
let islands: Island[] = [];
/** The component whose render is creating vnodes right now, for messages; the MDX content is the page. */
let rendering = "the page";
/** The components island() made: their function props are refused as not JSON, before this file's handler check would see them. */
const wrappers = new WeakSet<ComponentType<Record<string, unknown>>>();
/** The client component whose slot renders right now; a client component of the author's inside it is refused. */
let slotOf: string | undefined;

/**
 * The value pack exports in place of a client module's export `name`: a component (a capitalised function, or the default
 * export) becomes an island; anything else is returned as it is. `kit` marks the kit's own client modules (Chart, Plot),
 * which may sit in another island's slot as islands of their own.
 */
export function island(module: string, name: string, value: unknown, kit = false): unknown {
	if (typeof value !== "function") {
		return value;
	}
	if (!(name === "default" || /^[A-Z]/.test(name))) {
		// A module that re-exports another client module's function: the first module to export it is where the browser finds it.
		if (!isClientExport(value)) {
			Object.defineProperty(value, CLIENT_REFERENCE, { value: { module, name } });
		}
		return value;
	}
	// A client module's capitalised function export is a component by the islands contract.
	const Component = value as ComponentType<Record<string, unknown>>;
	const label = name === "default" ? Component.displayName || Component.name || "default" : name;
	function Island({
		children,
		...props
	}: Record<string, unknown> & { children?: ComponentChildren }) {
		if (depth) {
			return h(Component, { ...props, children });
		}
		if (slotOf !== undefined && !kit) {
			throw new IslandError(
				`<${label}> is in the children of <${slotOf}>, which pack renders once as static HTML, so ${label} would not share ${slotOf}'s state: render <${label}> inside ${slotOf}, or beside it in the page`,
			);
		}
		const { json, refs } = clientRefs(props);
		const problem = notJson(json, "");
		if (problem) {
			throw new IslandError(
				`<${label} ${problem.path.slice(1)}> is ${problem.what}, but props from the page to a client component must be JSON or functions a "use client" module exports: export it from one, or render <${label}> in your own client component`,
			);
		}
		return prerendered(
			{ module, name, props: json, ...(refs.length ? { refs } : {}) },
			props,
			Component,
			label,
			children,
		);
	}
	Island.displayName = label;
	const fill: Fillable["fill"] = (view, props) => {
		const problem = notJson(props.records, "");
		if (problem) {
			throw new IslandError(
				`<View name="${view}" records>: ${problem.path.slice(1)} is ${problem.what}, but the records reach the browser as JSON`,
			);
		}
		drawEach(view, label, Component as DrawRecord, props);
		islands.push({ module, name, props: { ...props }, view });
	};
	Island.fill = fill;
	wrappers.add(Island);
	return Island;
}

/**
 * Numbers `entry` and renders its component from `props` (entry.props with the client functions still in place), with its slot
 * when the page gave it children, as the marker element for renderPage.
 */
function prerendered(
	entry: Island,
	props: Record<string, unknown>,
	Component: ComponentType<Record<string, unknown>>,
	label: string,
	children: ComponentChildren,
) {
	// Numbered before its slot renders, so an island in the slot comes after it, in page order.
	const n = islands.push(entry) - 1;
	const slot = hasContent(children) ? slotFor(label, n, children) : undefined;
	depth++;
	let html: string;
	try {
		html = renderToString(h(Component, slot ? { ...props, children: slot.vnode } : props));
	} finally {
		depth--;
	}
	if (slot && slot.placed() !== 1) {
		throw new IslandError(
			slot.placed()
				? `<${label}> renders its children from the page ${slot.placed()} times, but they are one piece of static HTML: write {children} once in ${label}`
				: `<${label}> has children in the page, but ${label} does not render them: write {children} in ${label} where they go, or leave them out`,
		);
	}
	return h(MARKER, { "data-island": n, dangerouslySetInnerHTML: { __html: html } });
}

/**
 * Draws every record of a filled view once and throws the HTML away: a record the component cannot draw fails the pack, naming
 * it, rather than leaving the reader an empty view.
 */
function drawEach(view: string, label: string, render: DrawRecord, { records, back }: FillProps) {
	depth++;
	try {
		for (const [param, record] of Object.entries(records)) {
			try {
				renderToString(h(FilledRecord, { render, record, back }));
			} catch (e) {
				throw new IslandError(
					`<View name="${view}" render={${label}}> threw for #${view}/${param}: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}
	} finally {
		depth--;
	}
}

/**
 * The slot of island `n`: its children from the page rendered once, now, as static HTML (handlers in them fail as anywhere
 * outside an island), and the vnode the component gets as `children`, which counts how often the component places it.
 */
function slotFor(label: string, n: number, children: ComponentChildren) {
	if (hasFunction(children)) {
		throw new IslandError(
			`<${label}> has a function among its children in the page, but they are rendered once in pack as static HTML, so it would never run: compute that part inside ${label}`,
		);
	}
	const outer = { slotOf, rendering };
	slotOf = label;
	let html: string;
	try {
		html = renderToString(h(Fragment, null, children));
	} finally {
		({ slotOf, rendering } = outer);
	}
	let placed = 0;
	function Slot() {
		placed++;
		return h(SLOT, { "data-slot": n, dangerouslySetInnerHTML: { __html: html } });
	}
	return { vnode: h(Slot, null), placed: () => placed };
}

/** True when `children` hold a function anywhere (a render prop), which static HTML would drop without a word. */
const hasFunction = (children: unknown): boolean =>
	Array.isArray(children)
		? children.some(hasFunction)
		: typeof children === "function" ||
			(typeof children === "object" &&
				children !== null &&
				"props" in children &&
				hasFunction((children.props as { children?: unknown }).children));

/**
 * `props` with each function a client module exports replaced by null, and where each was: JSON carries the rest to the browser,
 * and the client bundle imports those modules and puts the functions back (islands/client.ts).
 */
function clientRefs(props: Record<string, unknown>): {
	json: Record<string, unknown>;
	refs: ClientRef[];
} {
	const refs: ClientRef[] = [];
	const walk = (value: unknown, path: (string | number)[]): unknown => {
		if (isClientExport(value)) {
			refs.push({ path, ...(value[CLIENT_REFERENCE] as Omit<ClientRef, "path">) });
			return null;
		}
		if (Array.isArray(value)) {
			return value.map((item, i) => walk(item, [...path, i]));
		}
		if (
			value !== null &&
			typeof value === "object" &&
			Object.getPrototypeOf(value) === Object.prototype
		) {
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, walk(item, [...path, key])]),
			);
		}
		return value;
	};
	return { json: walk(props, []) as Record<string, unknown>, refs };
}

/** True for children that render something; whitespace between tags does not count. */
const hasContent = (children: ComponentChildren): boolean =>
	Array.isArray(children)
		? children.some(hasContent)
		: !(children == null || typeof children === "boolean" || /^\s*$/.test(String(children)));

/**
 * Preact's render hook under its mangled name (`_render` in preact's mangle.json): render-to-string calls it with each component
 * vnode just before running the component, which is how messages name the component that wrote a handler.
 */
type RenderHook = { __r?: (vnode: VNode) => void };
const hooks: Options & RenderHook = options;
const previousRender = hooks.__r;
hooks.__r = (vnode) => {
	if (typeof vnode.type === "function" && depth === 0) {
		const type = vnode.type as ComponentType;
		rendering = type.displayName || type.name || "a component";
	}
	previousRender?.(vnode);
};

/**
 * `<tag prop>` for a vnode made outside every island that holds a handler: an element's `on*` function, or a
 * component's `onX` function (a static component's other function props, such as Tree's `row`, run in pack and are fine).
 */
function staticHandler(vnode: VNode): string | undefined {
	const { type } = vnode;
	if (depth > 0 || (typeof type === "function" && wrappers.has(type))) {
		return undefined;
	}
	const handlerName = typeof type === "string" ? /^on/ : /^on[A-Z]/;
	const handler = Object.entries(vnode.props as Record<string, unknown>).find(
		([key, value]) => handlerName.test(key) && typeof value === "function",
	);
	if (!handler) {
		return undefined;
	}
	const tag = typeof type === "string" ? type : type.displayName || type.name || "a component";
	return `<${tag} ${handler[0]}>`;
}

/**
 * The message for a `ref` that is not a Preact ref (a function or a useRef object), anywhere in the page: Preact takes `ref`
 * out of the props of every element and component, so `ref="flow"` meant as a link name would vanish without a word.
 */
function misusedRef(vnode: VNode): string | undefined {
	const { ref, type } = vnode;
	if (ref == null || typeof ref === "function" || typeof ref === "object") {
		return undefined;
	}
	const written = typeof ref === "string" ? `"${ref}"` : `{${String(ref)}}`;
	const element = typeof type === "string";
	const tag = element ? type : type.displayName || type.name || "a component";
	const place = rendering === "MDXContent" ? "the page" : rendering;
	return `<${tag} ref=${written}> in ${place}: ref is Preact's handle to ${element ? "the element" : "a component"} (a function or useRef()) and never reaches the page${element ? "" : ` or ${tag}'s props`}; to link the part with others, write data-ref=${written}${element ? "" : `, or give ${tag}'s prop another name`}`;
}

// What is made outside every island is static HTML: a handler on it would never run, so the pack fails instead.
const previousVnode = options.vnode;
options.vnode = (vnode) => {
	const ref = misusedRef(vnode);
	if (ref) {
		throw new IslandError(ref);
	}
	const tag = staticHandler(vnode);
	if (tag) {
		throw new IslandError(
			rendering === "MDXContent"
				? `${tag} in the page is static HTML, so the handler would never run: move it into a component of your own in a .tsx module whose first line is "use client"`
				: `${tag} in ${rendering} is static HTML, so the handler would never run: put "use client" as the first line of the module that defines ${rendering}`,
		);
	}
	previousVnode?.(vnode);
};

/** The island and slot elements' tags (`explainer-<kind>`); a slot can hold an island, so each tag is replaced on its own. */
const MARKERS = /<(\/?)explainer-(island|slot)(?: data-\2="(\d+)")?>/g;

/**
 * Renders the page's MDX content to HTML with each island between `<!--island:N-->` and `<!--/island-->`, and its slot, if
 * any, between `<!--slot:N-->` and `<!--/slot-->`; returns the islands in marker order.
 */
export function renderPage(Content: ComponentType): { html: string; islands: Island[] } {
	islands = [];
	rendering = "the page";
	slotOf = undefined;
	const html = renderToString(h(Content, {})).replace(
		MARKERS,
		(_, close: string, kind: string, n: string | undefined) =>
			close ? `<!--/${kind}-->` : `<!--${kind}:${n}-->`,
	);
	return { html, islands };
}
