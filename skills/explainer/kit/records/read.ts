/** The reading primitives validate.ts checks a config with: each reports a problem at its property path and goes on. */

/** Records one problem: where in the config, and what is wrong with what to write. */
export type Report = (path: string, message: string) => void;

/** A block id, view name or anchor part: safe in a URL hash and an element id, and never mistaken for a `#name/param` route. */
export const NAME = /^[A-Za-z][\w-]*$/;
export const NAME_HINT = "letters, digits, - and _, starting with a letter";

export const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
export const list = (values: readonly string[]) => values.map((v) => JSON.stringify(v)).join(", ");

/** The object's own value at `key`: a record that leaves out a field named `constructor` holds nothing there, not Object. */
export const own = (obj: Readonly<Record<string, unknown>>, key: string): unknown =>
	Object.hasOwn(obj, key) ? obj[key] : undefined;

/** A value as a message quotes it, cut short. */
export function show(value: unknown): string {
	const text = JSON.stringify(value) ?? String(value);
	return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** `path.key`, or `path["odd key"]` for a key that is not a plain name. */
export function prop(path: string, key: string): string {
	if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
		return `${path}[${JSON.stringify(key)}]`;
	}
	return path ? `${path}.${key}` : key;
}

/** Reports each property of `obj` that is not `allowed`. */
export function knownKeys(
	obj: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
	report: Report,
) {
	for (const key of Object.keys(obj)) {
		if (!allowed.includes(key)) {
			report(prop(path, key), `unknown property; expected one of ${list(allowed)}`);
		}
	}
}

/** A pattern a text must match, and how a message describes it. */
export type Rule = { pattern: RegExp; hint: string };

/** Non-empty text matching `rule` when one is given, else undefined with the problem reported. */
export function readString(
	value: unknown,
	path: string,
	report: Report,
	rule?: Rule,
): string | undefined {
	if (typeof value !== "string" || value === "") {
		report(path, `expected ${rule ? rule.hint : "non-empty text"}; got ${show(value)}`);
		return undefined;
	}
	if (rule && !rule.pattern.test(value)) {
		report(path, `expected ${rule.hint}; got ${show(value)}`);
		return undefined;
	}
	return value;
}

/** A required text property of `obj`, checked like readString. */
export const readProp = (
	obj: Record<string, unknown>,
	key: string,
	path: string,
	report: Report,
	rule?: Rule,
) => readString(obj[key], prop(path, key), report, rule);

/** An optional text property of `obj`: undefined when left out, else checked like readString. */
export const readOptional = (
	obj: Record<string, unknown>,
	key: string,
	path: string,
	report: Report,
	rule?: Rule,
) => (obj[key] === undefined ? undefined : readProp(obj, key, path, report, rule));
