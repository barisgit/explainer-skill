/* Question: a question answered in the reply (choices or table rows), checked on the spot (given the right answer), or written out.
   <Question name="first-fix" legend="Which fix would you try first?" options={{ second: "Second barista", steady: "Steadier orders" }} />
   <Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">A kWh is a kW for an hour.</Question>
   <Question name="why" legend="Why does the queue grow at noon?">Orders arrive faster than one barista serves them.</Question>
     name      the option group, unique on the page: each input's id is name-value (first-fix-second; a character other than
               a letter, digit or - is written _hex_, so "5 kWh" is 5_20_kWh), and a reload keeps the answer by it
     legend    the question. Leave it out under the heading that asks it: the group then takes that heading (the nearest h2 to h6
               before it in its own section) as its name and as the reply's label, and its note field is named by it too. pack fails
               if there is none, and for a Question drawn in the browser (inside a filled View's record, or one a client component
               mounts after load), which needs its legend. A written answer keeps its legend
     options   value: label pairs, or a list of labels that are their own values; each value once
     rows, cols  in place of options, a comparison whose rows are the choices, taken as Table takes them; each row's first
               column is its value (text or a number), and a click on a row chooses it (not on a control, link or fold in it, and not
               a text selection). No answer: a self-check uses options
               <Question name="size" legend="Which size?" rows={sizes} cols={[{ head: "Size", value: "size" }, { head: "Price", value: "price", format: { currency: "EUR" } }]} />
     multiple  checkboxes instead of radios: the answer is the checked labels
     checked   the value (or values) chosen to begin with
     recommended  the value (or values) you recommend: marked on its choice (kitLabels.recommended); the reply sends the
               bare option, with "(recommended)" when the reader's answer is the recommendation
     note      a full-width, multiline text box under the choices where the reader says why; it starts one line high and grows
               up to a scrollable cap. Enter adds a line; the reply keeps those lines under the answer, and print shows them all
     answer    the right value: a self-check. Choosing marks the right option and a wrong choice, says Right or Wrong (also
               to a screen reader) and opens the explanation written inside the Question; it is not part of the reply and
               brings no Reply button
   Without options or rows the reader writes the answer in a text box (its id is the name, written as above). What is written inside the Question
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
import { compareTable, read, type TableColumn } from "./table.tsx";

/** What every form of Question takes. */
interface QuestionBase {
	name: string;
	legend?: ComponentChildren;
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

/** The choices: options, the rows of a table (each row one option, valued by its first column), or neither (a written answer). */
type QuestionChoices<Row> =
	| { options?: Record<string, string> | string[]; rows?: undefined; cols?: undefined }
	| { rows: readonly Row[]; cols: readonly TableColumn<Row>[]; options?: undefined };

export type QuestionProps<Row = unknown> = QuestionBase & QuestionChoices<Row>;

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
	legend,
	multiple,
	checked,
	answer,
	recommended,
	note,
}: QuestionBase): string | undefined {
	if (legend === undefined) {
		return "has no legend: a written answer's text box is named by it, so write legend";
	}
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
	{ multiple, checked, answer, recommended, note, children }: QuestionBase,
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

/**
 * The problem with the values checked or recommended, if any: each is one of the options, and one recommendation alone without
 * multiple.
 */
function chosenProblem(
	{ checked, recommended, multiple }: QuestionBase,
	values: string[],
): string | undefined {
	const missing = (given: string | string[] | undefined) =>
		[given ?? []].flat().find((value) => !values.includes(value));
	for (const [verb, given] of [
		["checks", checked],
		["recommends", recommended],
	] as const) {
		const value = missing(given);
		if (value !== undefined) {
			return `${verb} "${value}", which is not one of its option values (${values.join(", ")})`;
		}
	}
	const given = new Set([recommended ?? []].flat());
	return given.size > 1 && !multiple
		? "recommends several values but takes one: recommend one, or add multiple"
		: undefined;
}

/** The problem with a Question over rows, if any: rows replace options, need their columns, and are never a self-check. */
function rowsProblem<Row>({ options, rows, cols, answer }: QuestionProps<Row>): string | undefined {
	if (rows === undefined) {
		return cols === undefined ? undefined : "has cols but no rows: give the rows the columns show";
	}
	if (options !== undefined) {
		return "has options and rows: each row is an option, so give the choices one way";
	}
	if (cols === undefined) {
		return "has rows but no cols: give the columns each row shows, as a Table's cols";
	}
	return answer === undefined
		? undefined
		: "has rows and an answer: a self-check asks with options, so give them as options";
}

/**
 * Renders a question in one of four forms. With `options`: `<fieldset data-reply="">` with its legend and a `.seg` of radios,
 * or checkboxes when `multiple`, a recommended option's text carrying `data-recommended` (the mark the theme shows, outside the
 * label's text the reply sends), and with `note` a `data-note` field after them; with `answer` as well, a
 * `<fieldset class="self-check">` whose right option carries `data-right`, followed by a paragraph holding both words, each `data-verdict` (the
 * theme shows the one that applies), an empty `role="status"` that kit keep.js fills for the reader's own choice, and the
 * children in a `.explain` that the theme shows once an option is chosen. With `rows` and `cols`: the same fieldset around the
 * `table.compare` a Table draws of them, each row's name cell holding that row's option. Without either: a
 * `<fieldset class="written">` with a textarea; with children it is also a self-check (`class="written self-check"`, kept
 * but out of the reply) and holds them in a `details.answer`, the fold kit views.js's Expand all skips; without, it is
 * `data-reply`. A repeated value, or props that do not fit the form, throw.
 */
export function Question<Row>(props: QuestionProps<Row>) {
	const { name, options, rows, cols } = props;
	const problem =
		rowsProblem(props) ??
		(options === undefined && rows === undefined ? writtenProblem(props) : undefined);
	if (problem) {
		throw new Error(`<Question name="${name}"> ${problem}`);
	}
	if (rows !== undefined && cols !== undefined) {
		return <RowsChoice {...props} rows={rows} cols={cols} />;
	}
	return options === undefined ? <Written {...props} /> : <Choice {...props} options={options} />;
}

/**
 * A written answer: the legend names the text box (aria-labelledby), since a fieldset's legend names only the group. The
 * children decide its form, as kit-scripts.ts's questionScripts reads them in client code.
 */
function Written({ name, legend, children }: QuestionBase) {
	const id = idPart(name);
	const selfCheck = children !== undefined;
	return (
		<fieldset
			{...(selfCheck ? { class: "written self-check" } : { class: "written", "data-reply": "" })}
		>
			<legend id={`${id}-legend`}>{legend}</legend>
			<textarea id={id} rows={1} data-grow="" aria-labelledby={`${id}-legend`} />
			{selfCheck && (
				<details class="answer">
					<summary>{kitText("showAnswer")}</summary>
					{children}
				</details>
			)}
		</fieldset>
	);
}

/** Throws when the option values repeat or the props that pick among them do not fit them. */
function checkValues(props: QuestionBase, values: string[]) {
	const twice = values.find((value, i) => values.indexOf(value) !== i);
	const problem =
		twice === undefined
			? (selfCheckProblem(props, values) ?? chosenProblem(props, values))
			: `has the option value "${twice}" twice: the reply could not tell the two apart, so give each option its own value`;
	if (problem) {
		throw new Error(`<Question name="${props.name}"> ${problem}`);
	}
}

/** What the options of one Question share: how they are picked, and which start chosen or recommended. */
interface OptionGroup {
	name: string;
	multiple: boolean | undefined;
	chosen: Set<string>;
	recommended: Set<string>;
	/** The right value of a self-check. */
	answer: string | undefined;
}

const optionGroup = ({
	name,
	multiple,
	checked,
	recommended,
	answer,
}: QuestionBase): OptionGroup => ({
	name,
	multiple,
	answer,
	chosen: new Set(checked === undefined ? [] : [checked].flat()),
	recommended: new Set([recommended ?? []].flat()),
});

/** One option: its input (id name-value) and its text, which carries the recommendation mark. */
function Option({
	group,
	value,
	children,
}: {
	group: OptionGroup;
	value: string;
	children: ComponentChildren;
}) {
	const { name, multiple, answer } = group;
	return (
		<label>
			<input
				type={multiple ? "checkbox" : "radio"}
				name={name}
				value={value}
				id={idOf(name, value)}
				checked={group.chosen.has(value)}
				data-right={answer !== undefined && value === answer ? "" : undefined}
			/>
			<span data-recommended={group.recommended.has(value) ? kitText("recommended") : undefined}>
				{children}
			</span>
		</label>
	);
}

/**
 * What names a question: its legend, or, with none, the section heading that asks it. pack (src/mdx/question-heading.ts) finds
 * that heading and turns the marker into the fieldset's aria-label, which the reply reads as it reads a legend.
 */
function Legend({
	name,
	legend,
	note,
}: {
	name: string;
	legend: ComponentChildren;
	note?: boolean | undefined;
}) {
	return legend === undefined ? null : (
		<legend id={note ? legendId(name) : undefined}>{legend}</legend>
	);
}

/** The marker on a fieldset whose question is the section heading above it; its value is the Question's name, for pack's message. */
const fromHeading = (name: string, legend: ComponentChildren) =>
	legend === undefined ? { "data-legend-from-heading": name } : {};

/** A reply question's legend id. A dot never appears in an option's id, so the legend's and the note's ids cannot meet one. */
const legendId = (name: string) => `${idPart(name)}.legend`;

/** The note field under a reply question's choices, described by its legend when it has one. */
function Note({ name, legend }: { name: string; legend: ComponentChildren }) {
	return (
		<NoteField
			id={`${idPart(name)}.note`}
			label={kitText("note")}
			placeholder={kitText("notePlaceholder")}
			{...(legend === undefined ? {} : { describedBy: legendId(name) })}
		/>
	);
}

/** A reply question or a self-check over its options. */
function Choice(props: QuestionBase & { options: Record<string, string> | string[] }) {
	const { name, legend, options, answer, children } = props;
	const pairs = Array.isArray(options)
		? options.map((label) => [label, label] as const)
		: Object.entries(options);
	checkValues(
		props,
		pairs.map(([value]) => value),
	);
	const group = optionGroup(props);
	const selfCheck = answer !== undefined;
	return (
		<fieldset
			{...(selfCheck ? { class: "self-check" } : { "data-reply": "" })}
			{...fromHeading(name, legend)}
		>
			<Legend name={name} legend={legend} note={props.note} />
			<div class="seg">
				{pairs.map(([value, label]) => (
					<Option key={value} group={group} value={value}>
						{label}
					</Option>
				))}
			</div>
			{props.note && <Note name={name} legend={legend} />}
			{selfCheck && <Verdict />}
			{selfCheck && children !== undefined && <div class="explain">{children}</div>}
		</fieldset>
	);
}

/**
 * A reply question over the rows of a table: each row's value is its first column's text or number, and its name cell holds
 * the option, whose label the theme stretches over the whole row.
 */
function RowsChoice<Row>(
	props: QuestionBase & { rows: readonly Row[]; cols: readonly TableColumn<Row>[] },
) {
	const { name, legend, rows, cols } = props;
	const [first] = cols;
	const values = rows.map((row) => (first ? read(row, first.value) : undefined));
	if (values.some((value) => typeof value === "string" && value.trim() === "")) {
		throw new Error(
			`<Question name="${name}"> has a row whose first column is empty: its first column names the row and gives its value, so give every row its name there (write "None yet" for a row that chooses nothing)`,
		);
	}
	if (!values.every((value) => typeof value === "string" || typeof value === "number")) {
		throw new Error(
			`<Question name="${name}"> has a row whose first column is not text or a number: its first column gives each row's value, which the option's id, checked and recommended use, so make it a key or (row) => text or a number`,
		);
	}
	const strings = values.map(String);
	checkValues(props, strings);
	const group = optionGroup(props);
	return (
		<fieldset data-reply="" {...fromHeading(name, legend)}>
			<Legend name={name} legend={legend} note={props.note} />
			{compareTable({ rows, cols }, (shown, i) => (
				<Option group={group} value={strings[i] ?? ""}>
					{shown}
				</Option>
			))}
			{props.note && <Note name={name} legend={legend} />}
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
