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
     answer    the right value: a self-check. Choosing marks the right option and a wrong choice, and opens the explanation
               written inside the Question; it is not part of the reply and brings no Reply button
   Without options the reader writes the answer in a text box (its id is the name, written as above) that joins the reply; what is written inside
   the Question is the model answer, behind a fold the reader opens when ready (kitLabels.showAnswer), which Expand all leaves shut.
   A reply question the reader never touched is sent as "(default)", one with nothing chosen as "no answer".
   For a panel whose controls' current values join the reply, put data-reply on any element around plain controls with ids:
   <div class="controls" data-reply="Requirements"><label class="field"><span>Max latency</span><input id="lat" type="range" /></label></div> */
import type { ComponentChildren } from "preact";

export interface QuestionProps {
	name: string;
	legend: ComponentChildren;
	/** The choices; left out, the reader writes the answer. */
	options?: Record<string, string> | string[];
	multiple?: boolean;
	checked?: string | string[];
	/** The right value, which makes the Question a self-check; `children` are its explanation. */
	answer?: string;
	/** A self-check's explanation, or a written answer's model answer. */
	children?: ComponentChildren;
}

/** The English texts the component adds, by kitLabels key; `kit labels` lists them with the kit scripts' own. */
const LABELS = {
	showAnswer: "Show answer",
};

/**
 * The page's text for `key`, else the English one. The page's frontmatter labels are kitLabels both while pack renders the page
 * and in the browser, so a Question a client component renders later reads the same text.
 */
const kitText = (key: keyof typeof LABELS) =>
	(typeof kitLabels === "undefined" ? undefined : kitLabels?.[key]) || LABELS[key];

/**
 * Text as part of an id, case kept: letters, digits and `-` stay, every other character (`_` included) becomes `_<hex code
 * point>_`, so distinct texts give distinct parts and the id holds no space or punctuation ("Ship now" is "Ship_20_now").
 */
const idPart = (text: string) =>
	text.replace(/[^\p{L}\p{N}-]/gu, (c) => `_${(c.codePointAt(0) ?? 0).toString(16)}_`);

/**
 * An option's id, `name-value`: the same on every pack and distinct for distinct values of one Question, so keep.js keeps the
 * answer by it. Two Questions can still meet ("a-b" with "c", "a" with "b-c"); pack fails on a page where they do.
 */
const idOf = (name: string, value: string) => `${idPart(name)}-${idPart(value)}`;

/** The problem with a written answer's props, if any: the props that pick among options have nothing to pick from. */
function writtenProblem({ multiple, checked, answer }: QuestionProps): string | undefined {
	if (answer !== undefined) {
		return "has an answer but no options: a written answer has no value to check, so write the model answer inside the Question";
	}
	return multiple || checked !== undefined
		? "has multiple or checked but no options: give the options, or leave both out for a written answer"
		: undefined;
}

/** The problem with a self-check's props, if any: it needs one right value among the options and starts unanswered. */
function selfCheckProblem(
	{ multiple, checked, answer, children }: QuestionProps,
	values: string[],
): string | undefined {
	if (answer === undefined) {
		return children === undefined
			? undefined
			: "has an explanation inside but no answer: give the right value as answer, or put the text after the Question";
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

/**
 * Renders a question in one of three forms. With `options`: `<fieldset data-reply="">` with its legend and a `.seg` of radios,
 * or checkboxes when `multiple`; with `answer` as well, a `<fieldset class="self-check">` whose right option carries
 * `data-right` and whose children follow in a `.explain` that the theme shows once an option is chosen. Without `options`: a
 * `<fieldset class="written" data-reply="">` with a textarea and the children in a `details.answer`, the fold kit views.js's
 * Expand all skips. A repeated value, or props that do not fit the form, throw.
 */
export function Question(props: QuestionProps) {
	const { name, options } = props;
	const problem = options === undefined ? writtenProblem(props) : undefined;
	if (problem) {
		throw new Error(`<Question name="${name}"> ${problem}`);
	}
	return options === undefined ? <Written {...props} /> : <Choice {...props} options={options} />;
}

/** A written answer: the legend names the text box (aria-labelledby), since a fieldset's legend names only the group. */
function Written({ name, legend, children }: QuestionProps) {
	const id = idPart(name);
	return (
		<fieldset class="written" data-reply="">
			<legend id={`${id}-legend`}>{legend}</legend>
			<textarea id={id} rows={3} aria-labelledby={`${id}-legend`} />
			{children !== undefined && (
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
	const problem = selfCheckProblem(props, values);
	if (problem) {
		throw new Error(`<Question name="${name}"> ${problem}`);
	}
	const chosen = new Set(checked === undefined ? [] : [checked].flat());
	const selfCheck = answer !== undefined;
	return (
		<fieldset {...(selfCheck ? { class: "self-check" } : { "data-reply": "" })}>
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
							data-right={selfCheck && value === answer ? "" : undefined}
						/>
						<span>{label}</span>
					</label>
				))}
			</div>
			{selfCheck && children !== undefined && <div class="explain">{children}</div>}
		</fieldset>
	);
}
