/*
 * The browser side of Explore: its controls, readout, stats, figure and caption, switched between the frames pack computed.
 * explore-plot.tsx, explore-chart.tsx and explore-text.tsx are the client modules around it, one per figure, so a page carries
 * the kit scripts of the figure it shows and no other.
 */
import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { apply, type Json } from "./frames.ts";

/** A control as the island gets it; a range's values are min + i * step, i < texts.length, shown as texts[i]. */
export type ExploreControl = { id: string; label: string } & (
	| { range: { min: number; step: number; digits: number; texts: string[] } }
	| { choice: string[] }
	| { toggle: true }
);

/** Explore's island props: the first frame, the distinct patches and which one each frame takes (frames in row-major order). */
export interface ExploreData {
	controls: ExploreControl[];
	start: number[];
	first: Json;
	patches: Json[];
	at: number[];
	label: string;
	class?: string;
	id?: string;
}

/** A frame as Explore shows it: its figure's option and the HTML of its readout, stats and caption. */
interface Frame {
	figure?: Json;
	readout?: string;
	stats?: Record<string, string>;
	caption?: string;
}

/** How many values a control has. */
export const valueCount = (control: ExploreControl): number =>
	"range" in control ? control.range.texts.length : "choice" in control ? control.choice.length : 2;

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
								value={text}
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

const html = (text: string) => ({ __html: text });

/** Explore's figure: the controls' row, then the frame they choose; `figure` draws the frame's option (none for text only). */
export function ExploreView({
	data,
	figure,
}: {
	data: ExploreData;
	figure?: (option: Json) => JSX.Element;
}) {
	const { controls, first, patches, at } = data;
	const [values, setValues] = useState(data.start);
	const index = controls.reduce((n, control, c) => n * valueCount(control) + (values[c] ?? 0), 0);
	const frame = useMemo(
		() => apply(first, patches[at[index] ?? 0] ?? {}) as Frame,
		[first, patches, at, index],
	);
	return (
		<figure class="fig" id={data.id}>
			<div class="controls">
				{controls.map((control, c) => (
					<Control
						control={control}
						value={values[c] ?? 0}
						set={(v) => setValues((now) => now.map((old, i) => (i === c ? v : old)))}
					/>
				))}
			</div>
			{frame.stats && (
				<dl class="stats" aria-live="polite">
					{Object.entries(frame.stats).map(([term, value]) => (
						<div class="stat">
							<dt>{term}</dt>
							<dd dangerouslySetInnerHTML={html(value)} />
						</div>
					))}
				</dl>
			)}
			{frame.readout !== undefined && (
				<p aria-live="polite" dangerouslySetInnerHTML={html(frame.readout)} />
			)}
			{figure && frame.figure !== undefined && figure(frame.figure)}
			{frame.caption !== undefined && <figcaption dangerouslySetInnerHTML={html(frame.caption)} />}
		</figure>
	);
}
