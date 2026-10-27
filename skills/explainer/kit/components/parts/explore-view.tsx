/*
 * The browser side of Explore: its controls (or, with `use`, the ones Controls shows elsewhere on the page), stats, readout,
 * figure and caption for the frame the controls choose, taken from the frames pack computed or computed here by the page's
 * frame function. explore-plot.tsx, explore-chart.tsx and
 * explore-text.tsx are the client modules around it, one per figure, so a page carries the kit scripts of the figure it shows
 * and no other.
 */
import type { ComponentChildren, JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { apply, type Json, merge } from "./frames.ts";
import { anchorOf, type SharedControls, sharedControls, useShared } from "./shared-controls.ts";

/**
 * A control as the island gets it; a range's values are min + i * step, i < texts.length, shown as texts[i]; a choice's are
 * `values`, shown as `choice`.
 */
export type ExploreControl = { id: string; label: string } & (
	| { range: { min: number; step: number; digits: number; texts: string[] } }
	| { choice: string[]; values: string[] }
	| { toggle: true }
);

/** What one frame shows; in a page's frame function, readout, stats and caption are text or JSX. */
export interface ExploreFrame {
	plot?: PlotOption;
	chart?: ChartOption;
	readout?: ComponentChildren;
	stats?: Record<string, ComponentChildren>;
	caption?: ComponentChildren;
}

/** A control's value as the frame function gets it: a range's number, a choice's text, a toggle's true or false. */
export type ExploreValue = number | string | boolean;

/** The page's frame function, called with the controls' values in their order. */
export type FrameFunction = (...values: ExploreValue[]) => ExploreFrame;

/**
 * Explore's island props. Its controls, with the index each starts on, or `use`, the id of the Controls whose set it follows.
 * Precomputed: the first frame, the distinct patches against it and which patch each frame takes (frames in row-major order),
 * their texts HTML. Live: the frame function, a client module's export, and the JSON base under its frames.
 */
export type ExploreData = {
	label: string;
	class?: string;
	height?: string;
	id?: string;
} & ({ controls: ExploreControl[]; start: number[] } | { use: string }) &
	({ first: Json; patches: Json[]; at: number[] } | { frame: FrameFunction; base: ExploreFrame });

/** How many values a control has. */
export const valueCount = (control: ExploreControl): number =>
	"range" in control ? control.range.texts.length : "choice" in control ? control.choice.length : 2;

/** The control's value at index `i`. */
export function valueAt(control: ExploreControl, i: number): ExploreValue {
	if ("range" in control) {
		const { min, step, digits } = control.range;
		return +(min + i * step).toFixed(digits);
	}
	return "choice" in control ? (control.values[i] ?? "") : i === 1;
}

/** `frame` over `base`: the figure's option merged key by key, the texts and each stat replaced. */
export const withBase = (base: ExploreFrame, frame: ExploreFrame): ExploreFrame => ({
	...base,
	...frame,
	...(frame.plot && { plot: merge(base.plot, frame.plot) as PlotOption }),
	...(frame.chart && { chart: merge(base.chart, frame.chart) as ChartOption }),
	...((base.stats || frame.stats) && { stats: { ...base.stats, ...frame.stats } }),
});

/** The control's markup; `set` takes the index of the value the reader chose. */
function Control({
	control,
	value,
	set,
}: {
	control: ExploreControl;
	value: number;
	set: (value: number) => void;
}) {
	const { id, label } = control;
	if ("range" in control) {
		const { min, step, digits, texts } = control.range;
		return (
			<label class="field">
				<span>{label}</span>
				<input
					type="range"
					id={id}
					min={min}
					max={(min + (texts.length - 1) * step).toFixed(digits)}
					step={step}
					value={(min + value * step).toFixed(digits)}
					onInput={(e) => {
						const i = Math.round((Number(e.currentTarget.value) - min) / step);
						set(Math.min(Math.max(i, 0), texts.length - 1));
					}}
				/>
				<output for={id}>{texts[value]}</output>
			</label>
		);
	}
	if ("choice" in control) {
		return (
			<div class="field">
				<span>{label}</span>
				<div class="seg" role="radiogroup" aria-label={label}>
					{control.choice.map((text, i) => (
						<label>
							<input
								type="radio"
								name={id}
								id={`${id}-${i}`}
								value={control.values[i]}
								checked={i === value}
								onChange={() => set(i)}
							/>
							<span>{text}</span>
						</label>
					))}
				</div>
			</div>
		);
	}
	return (
		<label class="toggle">
			<input
				type="checkbox"
				id={id}
				checked={value === 1}
				onChange={(e) => set(e.currentTarget.checked ? 1 : 0)}
			/>
			<span>{label}</span>
		</label>
	);
}

/** The controls' row; `set` takes the control's index and the index of the value the reader chose. */
export function ControlRow({
	controls,
	values,
	set,
}: {
	controls: ExploreControl[];
	values: number[];
	set: (c: number, value: number) => void;
}) {
	return (
		<div class="controls">
			{controls.map((control, c) => (
				<Control control={control} value={values[c] ?? 0} set={(v) => set(c, v)} />
			))}
		</div>
	);
}

/** The frame the controls' value indices choose: a patch applied to the first frame, or the frame function's result. */
function useFrame(data: ExploreData, controls: ExploreControl[], values: number[]): ExploreFrame {
	const index = controls.reduce((n, control, c) => n * valueCount(control) + (values[c] ?? 0), 0);
	// data is the island's props, the same object for its life, so the frame is computed again only when a value changes.
	return useMemo(
		() =>
			"frame" in data
				? withBase(data.base, data.frame(...controls.map((c, i) => valueAt(c, values[i] ?? 0))))
				: (apply(data.first, data.patches[data.at[index] ?? 0] ?? {}) as ExploreFrame),
		[data, controls, values, index],
	);
}

/**
 * What the chosen values say, in control order: a choice's or range's text, a toggle's label while it is on (off says nothing).
 * A range's text follows its label, since a number alone says nothing.
 */
function chosenTexts(controls: ExploreControl[], values: number[]): string[] {
	return controls.flatMap((control, c) => {
		const value = values[c] ?? 0;
		if ("range" in control) {
			return [`${control.label} ${control.range.texts[value]}`];
		}
		if ("choice" in control) {
			return [control.choice[value] ?? ""];
		}
		return value === 1 ? [control.label] : [];
	});
}

/**
 * The line that tells a figure following a Controls what it shows, and links to the controls to change it. Spaces separate the
 * values, so a screen reader reads them as a list; the theme writes the dots.
 */
function ControlsState({
	use,
	controls,
	values,
}: {
	use: string;
	controls: ExploreControl[];
	values: number[];
}) {
	const texts = chosenTexts(controls, values);
	return (
		texts.length > 0 && (
			<p class="controls-state">
				<a href={`#${anchorOf(use)}`}>
					{texts.flatMap((text, i) => (i ? [" ", <span>{text}</span>] : [<span>{text}</span>]))}
				</a>
			</p>
		)
	);
}

/** The set `use` names, which Controls declared as it rendered earlier in the page. */
function sharedSet(use: string): SharedControls {
	const set = sharedControls(use);
	if (!set) {
		throw new Error(`<Explore use="${use}"> found no <Controls id="${use}"> above it in the page`);
	}
	return set;
}

/**
 * The controls Explore follows and the indices chosen in them: its own, which it shows (`row`), or the set `use` names, which
 * Controls shows. A hook per source is always called, so the order of hooks never changes.
 */
function useControls(data: ExploreData) {
	const shared = "use" in data ? sharedSet(data.use) : undefined;
	const [own, setOwn] = useState("start" in data ? data.start : []);
	const [chosen, choose] = useShared(shared);
	return {
		controls: shared?.controls ?? ("controls" in data ? data.controls : []),
		values: chosen ?? own,
		set: shared
			? choose
			: (c: number, value: number) => setOwn((now) => now.map((old, i) => (i === c ? value : old))),
		shows: !shared,
	};
}

/**
 * Explore's figure: its controls' row unless a Controls shows them, then the frame they choose; `figure` draws the frame's
 * option (none for text only).
 */
export function ExploreView({
	data,
	figure,
}: {
	data: ExploreData;
	figure?: (option: PlotOption | ChartOption) => JSX.Element;
}) {
	const { controls, values, set, shows } = useControls(data);
	const frame = useFrame(data, controls, values);
	// Precomputed texts are HTML pack rendered; a frame function's are text or JSX.
	const content = (text: ComponentChildren) =>
		"frame" in data ? { children: text } : { dangerouslySetInnerHTML: { __html: String(text) } };
	const option = frame.plot ?? frame.chart;
	return (
		<figure class="fig" id={data.id}>
			{"use" in data && <ControlsState use={data.use} controls={controls} values={values} />}
			{shows && <ControlRow controls={controls} values={values} set={set} />}
			{frame.stats && (
				<dl class="stats" aria-live="polite">
					{Object.entries(frame.stats).map(([term, value]) => (
						<div class="stat">
							<dt>{term}</dt>
							<dd {...content(value)} />
						</div>
					))}
				</dl>
			)}
			{frame.readout !== undefined && <p aria-live="polite" {...content(frame.readout)} />}
			{figure && option !== undefined && figure(option)}
			{frame.caption !== undefined && <figcaption {...content(frame.caption)} />}
		</figure>
	);
}
