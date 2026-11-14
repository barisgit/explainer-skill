/* Question: a question the reader answers in the reply, checks on the spot (given the right answer), or writes out (no options).
   <Question name="first-fix" legend="Which fix would you try first?" options={{ second: "Second barista", steady: "Steadier orders" }} />
   <Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">A kWh is a kW for an hour.</Question>
   <Question name="why" legend="Why does the queue grow at noon?">Orders arrive faster than one barista serves them.</Question>
     name      the option group, unique on the page: each input's id is name-value (first-fix-second; a character other than
               a letter, digit or - is written _hex_, so "5 kWh" is 5_20_kWh), and a reload keeps the answer by it
     legend    the question
     options   value: label pairs, or a list of labels that are their own values; each value once
     multiple  checkboxes instead of radios: the answer is the checked labels
     checked   the value (or values) chosen to begin with
     recommended  the value (or values) you recommend: marked on its choice (kitLabels.recommended); the reply sends the
               bare option, with "(recommended)" when the reader's answer is the recommendation
     note      a text box under the choices where the reader says why; the reply prints it under the answer
     answer    the right value: a self-check. Choosing marks the right option and a wrong choice, says Right or Wrong (also
               to a screen reader) and opens the explanation written inside the Question; it is not part of the reply and
               brings no Reply button
   Without options the reader writes the answer in a text box (its id is the name, written as above). What is written inside the Question
   is the model answer, behind a fold the reader opens when ready (kitLabels.showAnswer), which Expand all leaves shut; such a Question
   is a self-check too: kept, but not in the reply. With nothing inside, the written answer joins the reply.
   The reply lists each answered question with its choice and its note; questions left alone are folded into one
   "Not answered: ..." line. A choice the reader never touched is sent as "(default)". With two or more questions the
   reply bar shows how many the reader answered.
   For a panel whose controls' current values join the reply, put data-reply on any element around plain controls with ids:
   <div class="controls" data-reply="Requirements"><label class="field"><span>Max latency</span><input id="lat" type="range" /></label></div> */
import type { ComponentChildren } from "preact";
import { idOf, idPart } from "./parts/answer-ids.ts";
import { NoteField } from "./parts/records-answer.tsx";

export interface QuestionProps {
	name: string;
	legend: ComponentChildren;
	/** The choices; left out, the reader writes the answer. */
	options?: Record<string, string> | string[];
	multiple?: boolean;
	checked?: string | string[];
	/** The value (or values) the page recommends, marked on its choice. */
	recommended?: string | string[];
	/** A note field under the choices, which the reply prints under the answer. */
	note?: boolean;
	/** The right value, which makes the Question a self-check; `children` are its explanation. */
	answer?: string;
	/** A self-check's explanation, or a written answer's model answer. */
	children?: ComponentChildren;
}

/** The English texts the component adds, by kitLabels key; `kit labels` lists them with the kit scripts' own. */
const LABELS = {
	showAnswer: "Show answer",
	recommended: "Recommended",
	right: "Right",
	wrong: "Wrong",
	note: "Note",
	notePlaceholder: "Note for the agent",
};

/**
 * The page's text for `key`, else the English one. The page's frontmatter labels are kitLabels both while pack renders the page
 * and in the browser, so a Question a client component renders later reads the same text.
 */
const kitText = (key: keyof typeof LABELS) =>
	(typeof kitLabels === "undefined" ? undefined : kitLabels?.[key]) || LABELS[key];

/** The problem with a written answer's props, if any: the props that pick among options have nothing to pick from. */
function writtenProblem({
	multiple,
	checked,
	answer,
	recommended,
	note,
}: QuestionProps): string | undefined {
	if (answer !== undefined) {
		return "has an answer but no options: a written answer has no value to check, so write the model answer inside the Question";
	}
	if (note) {
		return "has a note but no options: a written answer is already the reader's own words, so leave out note";
	}
	return multiple || checked !== undefined || recommended !== undefined
		? "has multiple, checked or recommended but no options: give the options, or leave them out for a written answer"
		: undefined;
}

/** The problem with a self-check's props, if any: it needs one right value among the options and starts unanswered. */
function selfCheckProblem(
	{ multiple, checked, answer, recommended, note, children }: QuestionProps,
	values: string[],
): string | undefined {
	if (answer === undefined) {
		return children === undefined
			? undefined
			: "has an explanation inside but no answer: give the right value as answer, or put the text after the Question";
	}
	if (recommended !== undefined) {
		return "has an answer and a recommendation: a self-check would give its answer away, so leave out recommended";
	}
	if (note) {
		return "has an answer and a note: a self-check is not in the reply, so leave out note";
	}
	if (multiple) {
		return "has multiple and an answer: a self-check has one right option, so ask one Question per statement";
	}
	if (checked !== undefined) {
		return "has checked and an answer: a self-check starts unanswered, so leave out checked";
	}
	return values.includes(answer)
		? undefined
		: `has the answer "${answer}", which is not one of its option values (${values.join(", ")})`;
}

/** The problem with a recommendation, if any: each recommended value is one of the options, and one alone without multiple. */
function recommendedProblem(
	{ recommended, multiple }: QuestionProps,
	values: string[],
): string | undefined {
	const given = new Set([recommended ?? []].flat());
	const missing = [...given].find((value) => !values.includes(value));
	if (missing !== undefined) {
		return `recommends "${missing}", which is not one of its option values (${values.join(", ")})`;
	}
	return given.size > 1 && !multiple
		? "recommends several values but takes one: recommend one, or add multiple"
		: undefined;
}

/**
 * Renders a question in one of three forms. With `options`: `<fieldset data-reply="">` with its legend and a `.seg` of radios,
 * or checkboxes when `multiple`, a recommended option's text carrying `data-recommended` (the mark the theme shows, outside the
 * label's text the reply sends), and with `note` a `data-note` field after them; with `answer` as well, a
 * `<fieldset class="self-check">` whose right option carries `data-right`, followed by a paragraph holding both words, each `data-verdict` (the
 * theme shows the one that applies), an empty `role="status"` that kit keep.js fills for the reader's own choice, and the
 * children in a `.explain` that the theme shows once an option is chosen. Without `options`: a
 * `<fieldset class="written">` with a textarea; with children it is also a self-check (`class="written self-check"`, kept
 * but out of the reply) and holds them in a `details.answer`, the fold kit views.js's Expand all skips; without, it is
 * `data-reply`. A repeated value, or props that do not fit the form, throw.
 */
export function Question(props: QuestionProps) {
	const { name, options } = props;
	const problem = options === undefined ? writtenProblem(props) : undefined;
	if (problem) {
		throw new Error(`<Question name="${name}"> ${problem}`);
	}
	return options === undefined ? <Written {...props} /> : <Choice {...props} options={options} />;
}

/**
 * A written answer: the legend names the text box (aria-labelledby), since a fieldset's legend names only the group. The
 * children decide its form, as kit-scripts.ts's questionScripts reads them in client code.
 */
function Written({ name, legend, children }: QuestionProps) {
	const id = idPart(name);
	const selfCheck = children !== undefined;
	return (
		<fieldset
			{...(selfCheck ? { class: "written self-check" } : { class: "written", "data-reply": "" })}
		>
			<legend id={`${id}-legend`}>{legend}</legend>
			<textarea id={id} rows={3} aria-labelledby={`${id}-legend`} />
			{selfCheck && (
				<details class="answer">
					<summary>{kitText("showAnswer")}</summary>
					{children}
				</details>
			)}
		</fieldset>
	);
}

/** A reply question or a self-check over its options. */
function Choice(props: QuestionProps & Required<Pick<QuestionProps, "options">>) {
	const { name, legend, options, multiple, checked, answer, children } = props;
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
	const problem = selfCheckProblem(props, values) ?? recommendedProblem(props, values);
	if (problem) {
		throw new Error(`<Question name="${name}"> ${problem}`);
	}
	const chosen = new Set(checked === undefined ? [] : [checked].flat());
	const recommended = new Set([props.recommended ?? []].flat());
	const selfCheck = answer !== undefined;
	// A dot never appears in an option's id, so the legend's and the note's ids cannot meet one.
	const legendId = `${idPart(name)}.legend`;
	return (
		<fieldset {...(selfCheck ? { class: "self-check" } : { "data-reply": "" })}>
			<legend id={props.note ? legendId : undefined}>{legend}</legend>
			<div class="seg">
				{pairs.map(([value, label]) => (
					<label key={value}>
						<input
							type={multiple ? "checkbox" : "radio"}
							name={name}
							value={value}
							id={idOf(name, value)}
							checked={chosen.has(value)}
							data-right={selfCheck && value === answer ? "" : undefined}
						/>
						<span data-recommended={recommended.has(value) ? kitText("recommended") : undefined}>
							{label}
						</span>
					</label>
				))}
			</div>
			{props.note && (
				<NoteField
					id={`${idPart(name)}.note`}
					label={kitText("note")}
					placeholder={kitText("notePlaceholder")}
					describedBy={legendId}
				/>
			)}
			{selfCheck && <Verdict />}
			{selfCheck && children !== undefined && <div class="explain">{children}</div>}
		</fieldset>
	);
}

/** A self-check's verdict: both words, of which the theme shows the one that applies, and the region keep.js speaks it in. */
function Verdict() {
	return (
		<>
			<p>
				<span data-verdict="right">{kitText("right")}</span>
				<span data-verdict="wrong">{kitText("wrong")}</span>
			</p>
			<span role="status" />
		</>
	);
}
