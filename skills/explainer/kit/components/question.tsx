/* Question: a question the reader answers in the reply: the legend is its label, the checked option its answer.
   <Question name="first-fix" legend="Which fix would you try first?" options={{ second: "Second barista", steady: "Steadier orders" }} />
     name      the option group, unique on the page: each input's id is name-value (first-fix-second; a character other than
               a letter, digit or - is written _hex_, so "5 kWh" is 5_20_kWh), and a reload keeps the answer by it
     legend    the question
     options   value: label pairs, or a list of labels that are their own values; each value once
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

/**
 * Text as part of an id, case kept: letters, digits and `-` stay, every other character (`_` included) becomes `_<hex code
 * point>_`, so distinct texts give distinct parts and the id needs no escaping in a CSS selector ("Ship now" is "Ship_20_now").
 */
const idPart = (text: string) =>
	text.replace(/[^\p{L}\p{N}-]/gu, (c) => `_${(c.codePointAt(0) ?? 0).toString(16)}_`);

/**
 * An option's id, `name-value`: the same on every pack, so reply.js keeps the answer by it, and distinct for distinct values
 * of one Question. Two Questions can still meet ("a-b" with "c", "a" with "b-c"); pack fails on a page where they do.
 */
const idOf = (name: string, value: string) => `${idPart(name)}-${idPart(value)}`;

/** Renders `<fieldset data-reply="">` with its legend and a `.seg` of radios, or checkboxes when `multiple`; a repeated value throws. */
export function Question({ name, legend, options, multiple, checked }: QuestionProps) {
	const pairs = Array.isArray(options)
		? options.map((label) => [label, label] as const)
		: Object.entries(options);
	const values = pairs.map(([value]) => value);
	const twice = values.find((value, i) => values.indexOf(value) !== i);
	if (twice !== undefined) {
		throw new Error(
			`<Question name="${name}"> has the option value "${twice}" twice: the reply could not tell the two apart, so give each option its own value`,
		);
	}
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
