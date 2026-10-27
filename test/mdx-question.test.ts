import { afterAll, describe, expect, test } from "bun:test";
import { act, inPage, kitScriptsIn, load, packedMdx, packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Packs `body` under a kit import as `<name>.mdx`, expecting a failure; returns the exit code and the message. */
async function packFailure(name: string, body: string) {
	const { result } = await packMdx(
		dir,
		name,
		`import { Question } from "kit";\n\n# Ids\n\n${body}\n`,
	);
	return [result.code, result.stderr.trim()];
}

describe("Question", () => {
	test("options whose values differ only in case keep their own answer across a reload, and the reply holds it", async () => {
		const output = await packedMdx(
			dir,
			"case",
			'import { Question } from "kit";\n\n# Case\n\n<Question name="pick" legend="Which one?" options={{ A: "Upper", a: "Lower" }} />\n',
		);
		const state = await inPage(output, async (cdp) => {
			await act(cdp, `document.querySelector('input[value="a"]').click()`, "0");
			await load(cdp);
			return act(
				cdp,
				`document.querySelector(".reply-bar .primary").click()`,
				`[[...document.querySelectorAll("input[name=pick]")].map((i) => i.checked).join(), document.querySelector(".reply-md").textContent.split("\\n").find((line) => line.includes("Which one?"))]`,
			);
		});
		expect(state).toEqual(["false,true", expect.stringContaining("Lower")]);
	}, 30_000);

	test("a value twice in one Question, or two Questions writing one id, fails the pack, saying what to change", async () => {
		const question = (name: string, options: string) =>
			`<Question name="${name}" legend="Which?" options={${options}} />`;
		const failed = packFailure;
		expect(await failed("twice", question("pick", '["Yes", "No", "Yes"]'))).toEqual([
			1,
			expect.stringContaining('<Question name="pick"> has the option value "Yes" twice'),
		]);
		expect(
			await failed("shared", `${question("a-b", '["c"]')}\n\n${question("a", '["b-c"]')}`),
		).toEqual([
			1,
			expect.stringContaining(
				'the id "a-b-c" is on 2 elements: <input type="radio" name="a-b" value="c"> under "Ids", <input type="radio" name="a" value="b-c"> under "Ids". A script, a label\'s for, a #link and a check --do step find only the first: give each its own id (a Question\'s option ids are its name and value, so give each Question its own name)',
			),
		]);
		expect(
			await failed("grouped", `${question("pick", '["Yes"]')}\n\n${question("pick", '["No"]')}`),
		).toEqual([1, expect.stringContaining('2 questions use the name "pick"')]);
	}, 30_000);
});

describe("self-check Question", () => {
	test("a self-check marks the choice, opens its explanation, keeps the choice after a reload, and is not in the reply", async () => {
		const output = await packedMdx(
			dir,
			"self-check",
			`import { Question } from "kit";

# Study

<Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">
A **kWh** is a kW for an hour.
</Question>

<Question name="unit2" legend="Which one is power?" options={["kW", "kWh"]} answer="kW" />
`,
		);
		expect(kitScriptsIn(output)).toEqual(["keep"]);
		// What the reader sees of the first question: the right and the chosen option's marks, and whether the explanation shows.
		const seen = `(() => {
			const look = (value) => { const s = getComputedStyle(document.querySelector('[name=unit][value="' + value + '"] + span')); return s.textDecorationLine + " " + s.boxShadow.includes("0px 0px 0px 2px"); };
			return [look("kW"), look("kWh"), document.querySelector(".explain").checkVisibility(), document.querySelector(".reply-bar")];
		})()`;
		const state = await inPage(output, async (cdp) => {
			const before = await cdp.evaluate(seen);
			const wrong = await act(cdp, `document.getElementById("unit-kW").click()`, seen);
			await load(cdp);
			return { before, wrong, reloaded: await cdp.evaluate(seen) };
		});
		expect(state.before).toEqual(["none false", "none false", false, null]);
		expect(state.wrong).toEqual(["line-through true", "none true", true, null]);
		expect(state.reloaded).toEqual(state.wrong);
	}, 30_000);

	test("a self-check a client component draws from its props shows no reply bar, chosen, reloaded or shown again", async () => {
		// The answer comes from a prop, so pack cannot tell this Question is a self-check and ships reply.js to be safe.
		dir.write(
			"quiz.tsx",
			`"use client";
import { useState } from "preact/hooks";
import { Question } from "kit";

export function Quiz({ answer }: { answer: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button type="button" class="btn" id="reveal" onClick={() => setOpen(true)}>Show</button>
			{open && <Question name="q" legend="Which is energy?" options={["kW", "kWh"]} answer={answer}>Power times time.</Question>}
		</div>
	);
}
`,
		);
		const output = await packedMdx(
			dir,
			"quiz",
			'import { Quiz } from "./quiz.tsx";\n\n# Quiz\n\n<Quiz answer="kWh" />\n',
		);
		const reveal = `document.getElementById("reveal").click()`;
		const clear = `document.querySelector(".keep-clear .btn").click()`;
		const seen = `[document.getElementById("q-kWh")?.checked ?? null, Boolean(document.querySelector(".reply-bar")?.checkVisibility()), Boolean(document.querySelector(".keep-clear .btn")?.checkVisibility())]`;
		const state = await inPage(output, async (cdp) => {
			await act(cdp, reveal, "0");
			const chosen = await act(cdp, `document.getElementById("q-kWh").click()`, seen);
			await load(cdp);
			const reloaded = await cdp.evaluate(seen);
			const shown = await act(cdp, reveal, seen);
			await act(cdp, clear, "0");
			return { chosen, reloaded, shown, cleared: await act(cdp, clear, seen) };
		});
		// reply.js is on the page, but with no reply question and no note, keep's own Clear clears the choice.
		expect(state).toEqual({
			chosen: [true, false, true],
			reloaded: [null, false, true],
			shown: [true, false, true],
			cleared: [false, false, false],
		});
	}, 30_000);

	test("a self-check with an answer that cannot be checked fails the pack, saying what to change", async () => {
		const question = (props: string, inside = "") =>
			`<Question name="q" legend="Which?" options={["a", "b"]} ${props}${inside ? `>${inside}</Question>` : " />"}`;
		const failed = (name: string, props: string, inside = "") =>
			packFailure(name, question(props, inside));
		expect(await failed("not-option", 'answer="c"')).toEqual([
			1,
			expect.stringContaining(
				'<Question name="q"> has the answer "c", which is not one of its option values (a, b)',
			),
		]);
		expect(await failed("multiple", 'answer="a" multiple')).toEqual([
			1,
			expect.stringContaining("a self-check has one right option"),
		]);
		expect(
			await packFailure("two-checks", `${question('answer="a"')}\n\n${question('answer="b"')}`),
		).toEqual([1, expect.stringContaining('2 questions use the name "q"')]);
		expect(await failed("no-answer", "", "Because.")).toEqual([
			1,
			expect.stringContaining("has an explanation inside but no answer"),
		]);
	}, 30_000);
});

/**
 * A study page: a section of written answers only, and one where two written answers sit beside two plain folds. The answers'
 * explanations are Markdown.
 */
const STUDY = `import { Question } from "kit";

# Study

## Before you read

<Question name="q1" legend="Why do sines build a square wave?">

Each harmonic fixes **more** of the error.

</Question>

<Question name="q2" legend={<>Which harmonics does <i>f</i> have?</>}>Only odd ones.</Question>

## Folds and answers

<details><summary>Notes</summary><p>One.</p></details>

<details><summary>More notes</summary><p>Two.</p></details>

<Question name="q3" legend="What converges?">The mean-square error.</Question>

<Question name="q4" legend="Where is the bump?">Next to the jump.</Question>
`;

/** Page code that writes `text` in the text box `id` as the reader would, with an input event. */
const write = (id: string, text: string) =>
	`(() => { const box = document.getElementById("${id}"); box.value = "${text}"; box.dispatchEvent(new Event("input", { bubbles: true })); })()`;

describe("written-answer Question", () => {
	test("a text box named by the legend, the answer behind its own fold, which Expand all never opens", async () => {
		const output = await packedMdx(dir, "study", STUDY);
		const seen = await inPage(output, async (cdp) => {
			const opening = await cdp.evaluate<{
				box: string[][];
				markdown: string;
				buttons: number[];
			}>(`({
				box: [...document.querySelectorAll("fieldset.written")].map((f) => [f.querySelector("textarea").id, document.getElementById(f.querySelector("textarea").getAttribute("aria-labelledby")).textContent, f.querySelector("details.answer > summary").textContent]),
				markdown: document.querySelector("#q1 ~ details.answer strong")?.textContent,
				buttons: [...document.querySelectorAll("section")].map((s) => s.querySelectorAll(".fold-all").length),
			})`);
			const expanded = await act<string[]>(
				cdp,
				`document.querySelector(".fold-all").click()`,
				`[[...document.querySelectorAll("details")].map((d) => d.open).join(), document.querySelector(".fold-all").textContent]`,
			);
			return { ...opening, expanded };
		});
		expect(seen.box).toEqual([
			["q1", "Why do sines build a square wave?", "Show answer"],
			["q2", "Which harmonics does f have?", "Show answer"],
			["q3", "What converges?", "Show answer"],
			["q4", "Where is the bump?", "Show answer"],
		]);
		expect(seen.markdown).toBe("more");
		// A section whose folds are all answers gets no Expand all; beside plain folds, Expand all opens only those.
		expect(seen.buttons).toEqual([0, 1]);
		expect(seen.expanded).toEqual(["false,false,true,true,false,false", "Collapse all"]);
	}, 30_000);

	test("the props that pick among options fail without options, saying what to write instead", async () => {
		expect(
			await packFailure("written-answer", `<Question name="w" legend="Why?" answer="b" />`),
		).toEqual([
			1,
			expect.stringContaining(
				'<Question name="w"> has an answer but no options: a written answer has no value to check, so write the model answer inside the Question',
			),
		]);
		expect(
			await packFailure("written-multiple", `<Question name="w" legend="Why?" multiple />`),
		).toEqual([1, expect.stringContaining("has multiple or checked but no options")]);
	}, 30_000);

	test("Show answer is the page's labels text, from the page and from a client component", async () => {
		const late = `"use client";
import { useState } from "preact/hooks";
import { Question } from "kit";

export function Late() {
	const [open, setOpen] = useState(false);
	return <div><button type="button" id="more" onClick={() => setOpen(true)}>More</button>{open && <Question name="late" legend="Zakaj?">Ker.</Question>}</div>;
}
`;
		const output = await packedMdx(
			dir,
			"study-labels",
			`---\nlang: sl\nlabels:\n  showAnswer: "Poka\u017ei odgovor"\n---\nimport { Question } from "kit";\nimport { Late } from "./late.tsx";\n\n# \u0160tudij\n\n<Question name="q" legend="Zakaj?">Ker.</Question>\n\n<Late />\n`,
			{ "late.tsx": late },
		);
		const summaries = await inPage(output, (cdp) =>
			act<string[]>(
				cdp,
				`document.getElementById("more").click()`,
				`[...document.querySelectorAll("details.answer > summary")].map((s) => s.textContent)`,
			),
		);
		expect(summaries).toEqual(["Poka\u017ei odgovor", "Poka\u017ei odgovor"]);
	}, 30_000);

	test("with nothing inside, the question joins the reply; Clear empties both kinds, and the kept one stays out of the reply", async () => {
		const output = await packedMdx(
			dir,
			"study-ask",
			'import { Question } from "kit";\n\n# Ask\n\n<Question name="ask" legend="What should change?" />\n\n<Question name="own" legend="Why?">Because.</Question>\n',
		);
		const seen = await inPage(output, async (cdp) => {
			await act(cdp, `${write("ask", "Shorter")}; ${write("own", "Mine")}`, "0");
			const reply = await act<string[]>(
				cdp,
				`document.querySelector(".reply-bar .primary").click()`,
				`document.querySelector(".reply-md").textContent.split("\\n").filter((line) => line.startsWith("- "))`,
			);
			const clear = `document.querySelector(".reply-dialog").close(); document.querySelector(".reply-bar .btn:not(.primary)")`;
			await act(cdp, `${clear}.click()`, "0");
			const cleared = await act<string[]>(
				cdp,
				`${clear}.click()`,
				`["ask", "own"].map((id) => document.getElementById(id).value)`,
			);
			return {
				reply,
				cleared,
				second: await cdp.evaluate(`document.querySelectorAll(".keep-clear").length`),
			};
		});
		expect(seen.reply).toEqual(["- What should change? Shorter"]);
		expect(seen.cleared).toEqual(["", ""]);
		// The reply bar's Clear is the page's only one.
		expect(seen.second).toBe(0);
	}, 30_000);
});

describe("Question a client component renders later", () => {
	test("children that may be undefined bring reply.js, and the Question joins the reply when they are", async () => {
		const output = await packedMdx(
			dir,
			"maybe",
			'import { Maybe } from "./maybe.tsx";\n\n# Maybe\n\n<Maybe index={1} />\n',
			{
				"maybe.tsx": `"use client";
import { useState } from "preact/hooks";
import { Question } from "kit";

export function Maybe({ index }: { index: number }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button type="button" class="btn" id="reveal" onClick={() => setOpen(true)}>Show</button>
			{open && <Question name="why" legend="Why?">{["Because."][index]}</Question>}
		</div>
	);
}
`,
			},
		);
		const shown = await inPage(output, (cdp) =>
			act<[boolean, boolean]>(
				cdp,
				`document.getElementById("reveal").click()`,
				`[Boolean(document.querySelector("fieldset.written[data-reply]")), Boolean(document.querySelector(".reply-bar .primary")?.checkVisibility())]`,
			),
		);
		expect(shown).toEqual([true, true]);
	}, 30_000);
});
