/*
 * The prerender side of .mdx pages: pack bundles this module with the page and calls renderPage once, in Bun, to get the page's
 * static HTML. Client components ("islands": capitalised exports of a module whose first statement is "use client") render here
 * between `<!--island:N-->` and `<!--/island-->`, and their props are returned for the client bundle (islands/client.ts) to
 * hydrate with. Never shipped in a page.
 */
import {
	type ComponentChildren,
	type ComponentType,
	h,
	type Options,
	options,
	type VNode,
} from "preact";
import { renderToString } from "preact-render-to-string";
import "./bare-data.ts";

/** One prerendered client component: the module that defines it, its export name and the JSON props it hydrates with. */
export interface Island {
	module: string;
	name: string;
	props: Record<string, unknown>;
}

/** What the page would do wrong in the browser; the message is for the page's author. pack finds it by name, not by class. */
export class IslandError extends Error {
	override name = "IslandError";
}

/** The element a prerendered island sits in until renderPage turns it into comment markers. */
const MARKER = "explainer-island";

/** Above 0 while an island renders: its handlers hydrate, and an island inside it is a plain part of it. */
let depth = 0;
let islands: Island[] = [];
/** The component whose render is creating vnodes right now, for messages; the MDX content is the page. */
let rendering = "the page";
/** The components island() made: their function props are refused as not JSON, before this file's handler check would see them. */
const wrappers = new WeakSet<ComponentType<Record<string, unknown>>>();

/**
 * The value pack exports in place of a client module's export `name`: a component (a capitalised function, or the default
 * export) becomes an island; anything else is returned as it is.
 */
export function island(module: string, name: string, value: unknown): unknown {
	if (typeof value !== "function" || !(name === "default" || /^[A-Z]/.test(name))) {
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
		if (hasContent(children)) {
			throw new IslandError(
				`<${label}> has children in the page, but a client component takes JSON props only: pass the text as a prop, or write the content inside ${label}`,
			);
		}
		const problem = notJson(props, "");
		if (problem) {
			throw new IslandError(
				`<${label} ${problem.path.slice(1)}> is ${problem.what}, but props from the page to a client component must be JSON: move the code that makes it into your own "use client" component and render <${label}> there`,
			);
		}
		depth++;
		let html: string;
		try {
			html = renderToString(h(Component, props));
		} finally {
			depth--;
		}
		const n = islands.push({ module, name, props }) - 1;
		return h(MARKER, { "data-island": n, dangerouslySetInnerHTML: { __html: html } });
	}
	Island.displayName = label;
	wrappers.add(Island);
	return Island;
}

/** True for children that render something; whitespace between tags does not count. */
const hasContent = (children: ComponentChildren): boolean =>
	Array.isArray(children)
		? children.some(hasContent)
		: !(children == null || typeof children === "boolean" || /^\s*$/.test(String(children)));

/** The first part of `value` that JSON would not carry over unchanged, with its path (`.option.series[0].label`). */
function notJson(value: unknown, path: string): { path: string; what: string } | undefined {
	switch (typeof value) {
		case "string":
		case "boolean":
			return undefined;
		case "number":
			return Number.isFinite(value) ? undefined : { path, what: String(value) };
		case "object":
			return value === null ? undefined : notJsonObject(value, path);
		default:
			return { path, what: `a ${typeof value}` };
	}
}

function notJsonObject(value: object, path: string): { path: string; what: string } | undefined {
	if (Array.isArray(value)) {
		return firstProblem(
			value.map((item, i) => [`${path}[${i}]`, item] as const),
			"an undefined item",
		);
	}
	if ("type" in value && "props" in value) {
		return { path, what: "JSX" };
	}
	const proto: unknown = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) {
		return { path, what: `a ${value.constructor.name}` };
	}
	// JSON leaves out an undefined property, which the component then reads as undefined again.
	return firstProblem(
		Object.entries(value).map(([key, item]) => [`${path}.${key}`, item] as const),
	);
}

/** The first problem among `[path, value]` entries; an undefined value is `undefinedIs`, or fine when that is not given. */
function firstProblem(
	entries: (readonly [string, unknown])[],
	undefinedIs?: string,
): { path: string; what: string } | undefined {
	for (const [path, item] of entries) {
		const problem =
			item === undefined ? undefinedIs && { path, what: undefinedIs } : notJson(item, path);
		if (problem) {
			return problem;
		}
	}
	return undefined;
}

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

/** Renders the page's MDX content to HTML with each island between comment markers, and returns the islands in marker order. */
export function renderPage(Content: ComponentType): { html: string; islands: Island[] } {
	islands = [];
	rendering = "the page";
	const html = renderToString(h(Content, {})).replace(
		new RegExp(`<${MARKER} data-island="(\\d+)">([\\s\\S]*?)</${MARKER}>`, "g"),
		"<!--island:$1-->$2<!--/island-->",
	);
	return { html, islands };
}
