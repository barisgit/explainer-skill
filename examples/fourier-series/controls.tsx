/* The figures' controls in the kit's classes: a seg switch, a slider with its readout, a checkbox toggle. Each input has an
   id, so a reload keeps it (kit reply.js), and sets its state in onInput or onChange, which the restore fires too. */

interface SegProps<V extends string> {
	name: string;
	label: string;
	options: Readonly<Record<V, string>>;
	value: V;
	onChange: (value: V) => void;
}

/** A row of radio buttons with ids name-value. */
export function Seg<V extends string>({ name, label, options, value, onChange }: SegProps<V>) {
	return (
		<div class="seg" role="radiogroup" aria-label={label}>
			{(Object.entries(options) as [V, string][]).map(([v, text]) => (
				<label>
					<input
						type="radio"
						id={`${name}-${v}`}
						name={name}
						value={v}
						checked={v === value}
						onChange={() => onChange(v)}
					/>
					<span>{text}</span>
				</label>
			))}
		</div>
	);
}

interface SliderProps {
	id: string;
	label: string;
	max: number;
	value: number;
	onInput: (value: number) => void;
}

/** A slider from 1 to max with its value in an output beside it (id-out). */
export function Slider({ id, label, max, value, onInput }: SliderProps) {
	return (
		<label class="field">
			<span>{label}</span>
			<input
				type="range"
				id={id}
				min="1"
				max={max}
				value={value}
				onInput={(e) => onInput(Number(e.currentTarget.value))}
			/>
			<output id={`${id}-out`} for={id}>
				{value}
			</output>
		</label>
	);
}

interface ToggleProps {
	id: string;
	label: string;
	on: boolean;
	onChange: (on: boolean) => void;
}

export function Toggle({ id, label, on, onChange }: ToggleProps) {
	return (
		<label class="toggle">
			<input
				type="checkbox"
				id={id}
				checked={on}
				onChange={(e) => onChange(e.currentTarget.checked)}
			/>
			<span>{label}</span>
		</label>
	);
}
