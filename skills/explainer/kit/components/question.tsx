/* Question: a question the reader answers in the reply: the legend is its label, the checked option its answer.
   <Question name="first-fix" legend="Which fix would you try first?" options={{ second: "Second barista", steady: "Steadier orders" }} />
     name      the option group, unique on the page: the inputs' ids (name-value) come from it, so a reload keeps the answer
     legend    the question
     options   value: label pairs, or a list of labels that are their own values
     multiple  checkboxes instead of radios: the answer is the checked labels
     checked   the value (or values) chosen to begin with
   pack includes reply.js. A question the reader never touched is sent as "(default)", one with nothing chosen as "no answer".
   For a panel whose controls' current values join the reply, put data-reply on any element around plain controls with ids:
   <div class="controls" data-reply="Requirements"><label class="field"><span>Max latency</span><input id="lat" type="range" /></label></div> */
import type { ComponentChildren } from "preact";

export interface QuestionProps {
	name: string;
	legend: ComponentChildren;
	options: Record<string, string> | string[];
	multiple?: boolean;
	checked?: string | string[];
}

/** An id from the group name and an option's value: the same on every pack, so reply.js keeps the answer by it. */
const idOf = (name: string, value: string) =>
	`${name}-${value}`.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-");

/** Renders `<fieldset data-reply="">` with its legend and a `.seg` of radios, or checkboxes when `multiple`. */
export function Question({ name, legend, options, multiple, checked }: QuestionProps) {
	const pairs = Array.isArray(options)
		? options.map((label) => [label, label] as const)
		: Object.entries(options);
	const chosen = new Set(checked === undefined ? [] : [checked].flat());
	return (
		<fieldset data-reply="">
			<legend>{legend}</legend>
			<div class="seg">
				{pairs.map(([value, label]) => (
					<label key={value}>
						<input
							type={multiple ? "checkbox" : "radio"}
							name={name}
							value={value}
							id={idOf(name, value)}
							checked={chosen.has(value)}
						/>
						<span>{label}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
