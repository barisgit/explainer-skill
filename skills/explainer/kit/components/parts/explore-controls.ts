/*
 * The controls of Explore and Controls as the page writes them, checked and turned into what the islands get: each control's
 * texts and values, and the index of the value it starts on. Runs in pack (and in the browser for an Explore inside a client
 * component).
 */
import type { ExploreControl } from "./explore-view.tsx";
import { numberText } from "./format.ts";

/** One control as the page writes it. */
export type ExploreControlProps = { id: string; label: string } & (
	| { range: readonly [number, number, number]; value?: number; format?: NumberFormat }
	| { choice: readonly string[] | Readonly<Record<string, string>>; value?: string }
	| { toggle: true; value?: boolean }
);

/** Decimals a number is written with: 2 for 0.05, 7 for 1e-7 (JavaScript writes small and large numbers with an exponent). */
function decimals(n: number): number {
	const [digits = "", exponent = "0"] = String(n).split("e");
	return Math.max(0, (digits.split(".")[1] ?? "").length - Number(exponent));
}

/** The range's slider as the island gets it, its readout written in `format` for the page's lang. */
function rangeControl(
	fail: (message: string) => never,
	id: string,
	[min, max, step]: readonly number[],
	format?: NumberFormat,
) {
	if (min === undefined || max === undefined || step === undefined || !(step > 0)) {
		return fail(`control "${id}": range is [min, max, step] with a step above 0`);
	}
	const count = Math.round((max - min) / step) + 1;
	if (count < 2 || Math.abs(min + (count - 1) * step - max) > step * 1e-6) {
		return fail(
			`control "${id}": range [${min}, ${max}, ${step}] needs max to be min plus whole steps`,
		);
	}
	const digits = Math.max(decimals(min), decimals(step));
	const text = numberText({ digits, ...format });
	const texts = Array.from({ length: count }, (_, i) => text(+(min + i * step).toFixed(digits)));
	return { range: { min, step, digits, texts } };
}

/** The control as the island gets it, and the index of the value it starts on; `fail` throws the page's error for a message. */
function control(
	fail: (message: string) => never,
	spec: ExploreControlProps,
): { control: ExploreControl; start: number } {
	const { id, label } = spec;
	if (!id || !label) {
		return fail("every control needs an id, which keeps its value across reloads, and a label");
	}
	if ("range" in spec) {
		const shown = rangeControl(fail, id, spec.range, spec.format);
		const { min, step, texts } = shown.range;
		const at = Math.round(((spec.value ?? min) - min) / step);
		return {
			control: { id, label, ...shown },
			start: Math.min(Math.max(at, 0), texts.length - 1),
		};
	}
	if ("choice" in spec) {
		const [values, texts] = Array.isArray(spec.choice)
			? [[...spec.choice], [...spec.choice]]
			: [Object.keys(spec.choice), Object.values(spec.choice)];
		const start = spec.value === undefined ? 0 : values.indexOf(spec.value);
		if (values.length < 2 || start < 0) {
			return fail(`control "${id}": choice needs two or more values, and value one of them`);
		}
		return { control: { id, label, choice: texts, values }, start };
	}
	if (spec.toggle !== true) {
		return fail(`control "${id}" needs range, choice or toggle: true`);
	}
	return { control: { id, label, toggle: true }, start: spec.value ? 1 : 0 };
}

/** The controls as the islands get them, and the index each starts on. */
export function parseControls(
	specs: readonly ExploreControlProps[],
	fail: (message: string) => never,
): { controls: ExploreControl[]; start: number[] } {
	const made = specs.map((spec) => control(fail, spec));
	return { controls: made.map((m) => m.control), start: made.map((m) => m.start) };
}
