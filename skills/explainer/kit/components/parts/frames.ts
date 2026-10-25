/*
 * Explore's frames as the page carries them: the first frame whole, every other one as a patch against it, so a slider that
 * moves one series ships that series per frame and the rest once. Explore (explore.tsx) writes the patches while pack renders
 * the page; the island applies them in the browser. merge lays a frame over Explore's base, in pack or, for a frame the browser
 * computes, there.
 *
 * A patch is JSON. A plain object merges into an object, or into an array by index ({ "3": patch }); { "=": value } replaces
 * whatever was there; { "ys": [...] } gives an array of [x, y] points new y values over the same x; anything else (a number, a
 * string, null, an array) replaces the value. Only diff writes patches, so a page's own "=" key never reads as one: an object
 * holding it is written whole, inside "=".
 */

const REPLACE = "=";
const YS = "ys";

/** A JSON value: what a frame, an option and a patch are made of. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (value: unknown): value is JsonObject =>
	value !== null && typeof value === "object" && !Array.isArray(value);
/** An object written as `{ ... }`: an option's part, not JSX, an array or a class instance. */
const isPlain = (value: unknown): value is Record<string, unknown> =>
	isObject(value) && Object.getPrototypeOf(value) === Object.prototype && !("props" in value);
const size = (value: unknown) => JSON.stringify(value).length;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isPoint = (value: unknown): value is [number, number] =>
	Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number");

/** `a` with `patch` applied; `a` is not changed, and the parts the patch does not touch are shared. */
export function apply(a: Json | undefined, patch: Json): Json {
	if (!isObject(patch)) {
		return patch;
	}
	const replaced = patch[REPLACE];
	if (replaced !== undefined) {
		return replaced;
	}
	if (Array.isArray(a)) {
		const ys = patch[YS];
		if (Array.isArray(ys)) {
			return a.map((point, i) => [Array.isArray(point) ? (point[0] ?? null) : null, ys[i] ?? null]);
		}
		const items = [...a];
		for (const [key, value] of Object.entries(patch)) {
			items[Number(key)] = apply(items[Number(key)], value);
		}
		return items;
	}
	const base = isObject(a) ? a : {};
	const merged = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		merged[key] = apply(base[key], value);
	}
	return merged;
}

/** The new y values of `b` when it is a list of points over the same x values as `a`, else undefined. */
function newYs(a: Json[], b: Json[]): Json | undefined {
	const ys: number[] = [];
	for (const [i, point] of b.entries()) {
		const old = a[i];
		if (!(isPoint(point) && isPoint(old) && point[0] === old[0])) {
			return undefined;
		}
		ys.push(point[1]);
	}
	return { [YS]: ys };
}

/** The shortest patch from array `a` to the different array `b`: b itself, b's new y values, or the items that changed. */
function arrayPatch(a: Json[], b: Json[]): Json {
	if (a.length !== b.length) {
		return b;
	}
	const byIndex: JsonObject = {};
	for (const [i, item] of b.entries()) {
		const patch = diff(a[i], item);
		if (patch !== undefined) {
			byIndex[i] = patch;
		}
	}
	const ys = newYs(a, b);
	return [b, byIndex, ...(ys === undefined ? [] : [ys])].reduce((best, next) =>
		size(next) < size(best) ? next : best,
	);
}

/** `patch` merged into `base`: plain objects key by key, anything else (arrays included) replaced; neither is changed. */
export function merge(base: unknown, patch: unknown): unknown {
	if (!isPlain(base) || !isPlain(patch)) {
		return patch === undefined ? base : patch;
	}
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		merged[key] = merge(base[key], value);
	}
	return merged;
}

/** The patch that turns `a` into `b` (apply(a, diff(a, b)) is b), or undefined when they are the same. */
export function diff(a: Json | undefined, b: Json): Json | undefined {
	if (same(a, b)) {
		return undefined;
	}
	if (Array.isArray(b)) {
		return Array.isArray(a) ? arrayPatch(a, b) : b;
	}
	if (!isObject(b)) {
		return b;
	}
	// A key b has lost, or a key that would read as a marker, needs b whole.
	if (!isObject(a) || REPLACE in b || Object.keys(a).some((key) => !(key in b))) {
		return { [REPLACE]: b };
	}
	const patch: JsonObject = {};
	for (const [key, value] of Object.entries(b)) {
		const change = diff(a[key], value);
		if (change !== undefined) {
			patch[key] = change;
		}
	}
	return patch;
}
