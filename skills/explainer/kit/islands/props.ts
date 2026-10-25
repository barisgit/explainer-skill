/*
 * What may cross from the page into a client component's props: JSON, and functions a "use client" module exports, which the
 * browser takes from that module. The islands runtime (server.ts) enforces it at every island; Explore checks its own options
 * by the same rule first, to say which control or frame to fix. Pure, so a component may import it into the browser bundle.
 */

/**
 * Where a function a client module exports is defined, set on the function itself by server.ts's island(), so a prop holding it
 * can reach the browser as a reference and kit components can tell it from a function that exists only in pack.
 */
export const CLIENT_REFERENCE: unique symbol = Symbol.for("explainer.clientReference");

/** True for a function a "use client" module exports, which the browser can call. */
export const isClientExport = (
	value: unknown,
): value is ((...args: never[]) => unknown) & { [CLIENT_REFERENCE]: unknown } =>
	typeof value === "function" && CLIENT_REFERENCE in value;

/** The first part of a value that JSON would not carry over unchanged: where it is and what it is. */
export interface JsonProblem {
	path: string;
	what: string;
}

/** The first part of `value` that JSON would not carry over unchanged, with its path from `path` (`.option.series[0].label`). */
export function notJson(value: unknown, path: string): JsonProblem | undefined {
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

function notJsonObject(value: object, path: string): JsonProblem | undefined {
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
): JsonProblem | undefined {
	for (const [path, item] of entries) {
		const problem =
			item === undefined ? undefinedIs && { path, what: undefinedIs } : notJson(item, path);
		if (problem) {
			return problem;
		}
	}
	return undefined;
}
