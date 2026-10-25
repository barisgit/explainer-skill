import { afterAll, describe, expect, test } from "bun:test";
import { type Cdp, withPage } from "../skills/explainer/src/chrome.ts";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Packs `source` as `<name>.mdx` with `files` beside it; the pack must succeed. Returns the output path and pack's stdout. */
async function pack(name: string, source: string, files: Record<string, string> = {}) {
	for (const [file, content] of Object.entries(files)) {
		dir.write(file, content);
	}
	const output = dir.path(`${name}.out.html`);
	const result = await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", output]);
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
	return { output, stdout: result.stdout };
}

/** Waits in the page for a re-render and the effects it starts: a frame, a task, another frame. */
const FRAMES = `new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done, 50))).then(() => new Promise(requestAnimationFrame))`;

/** Opens `url` (or reloads, keeping storage) and waits for the load event and the kit's load tasks. */
async function load(cdp: Cdp, url?: string) {
	const loaded = cdp.once("Page.loadEventFired");
	await (url ? cdp.send("Page.navigate", { url }) : cdp.send("Page.reload"));
	await loaded;
	await cdp.evaluate(`new Promise((done) => setTimeout(done, 100)).then(() => ${FRAMES})`, true);
}

/** Runs `action` in the page, waits for the re-render, and returns the page's `state` expression. */
const act = <T>(cdp: Cdp, action: string, state: string) =>
	cdp.evaluate<T>(`(() => { ${action} })(), ${FRAMES}.then(() => (${state}))`, true);

/** Opens a packed page in headless Chrome and runs `fn`; fails on any uncaught page error. */
function inPage<T>(output: string, fn: (cdp: Cdp) => Promise<T>): Promise<T> {
	return withPage(async (cdp) => {
		const errors: string[] = [];
		cdp.on("Runtime.exceptionThrown", ({ exceptionDetails: d }) =>
			errors.push(d.exception?.description ?? d.text),
		);
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		await load(cdp, `file://${output}`);
		const result = await fn(cdp);
		expect(errors).toEqual([]);
		return result;
	});
}

/** Packs `body` under a kit import as `<name>.mdx`, expecting a failure; returns the exit code and the message. */
async function packFailure(name: string, body: string) {
	const source = `import { Question } from "kit";\n\n# Fails\n\n${body}\n`;
	const out = dir.path(`${name}.out.html`);
	const result = await runCli(["pack", dir.write(`${name}.mdx`, source), "-o", out]);
	return [result.code, result.stderr.trim()];
}

/** A client component as the gallery's explorers write one: a switch picks the wave, and the Stepper derives it from step 1. */
const WAVES = `"use client";
import { useState } from "preact/hooks";
import { Stepper } from "kit";

const STEPS = { square: ["s1", "s2", "s3"], saw: ["w1", "w2", "w3", "w4"] };
type Wave = keyof typeof STEPS;

export function Waves() {
	const [wave, setWave] = useState<Wave>("square");
	const [step, setStep] = useState(0);
	return (
		<div>
			{(Object.keys(STEPS) as Wave[]).map((name) => (
				<label><input type="radio" name="wave" id={\`wave-\${name}\`} checked={name === wave} onChange={() => setWave(name)} /> {name}</label>
			))}
			<output id="heard">{step}</output>
			<Stepper id="deriv" start={1} restartOn={wave} captions={STEPS[wave]} onStep={(n) => setStep(n)}>
				{STEPS[wave].map((s, i) => <p data-step={i + 1}>{s}</p>)}
			</Stepper>
		</div>
	);
}
`;

describe("Stepper restartOn", () => {
	test("a new restartOn value starts the stepper at step 1; other re-renders keep the step", async () => {
		const { output } = await pack(
			"restart",
			`import { Waves } from "./waves.tsx";\n\n# Waves\n\n<Waves />\n`,
			{ "waves.tsx": WAVES },
		);
		const state = `[document.querySelector("#deriv .player output").textContent, document.getElementById("heard").textContent]`;
		const next = `document.querySelector('#deriv [data-go="1"]').click()`;
		const seen = await inPage(output, async (cdp) => {
			await act(cdp, next, "0");
			const stepped = await act(cdp, next, state);
			const saw = await act(cdp, `document.getElementById("wave-saw").click()`, state);
			const sawNext = await act(cdp, next, state);
			const square = await act(cdp, `document.getElementById("wave-square").click()`, state);
			return { stepped, saw, sawNext, square };
		});
		// onStep's own re-render (the readout) does not restart it: the stepper reaches step 3.
		expect(seen.stepped).toEqual(["3 / 3", "3"]);
		expect(seen.saw).toEqual(["1 / 4", "1"]);
		expect(seen.sawNext).toEqual(["2 / 4", "2"]);
		expect(seen.square).toEqual(["1 / 3", "1"]);
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

describe("written-answer Question", () => {
	test("a text box named by the legend, the answer behind its own fold, which Expand all never opens", async () => {
		const { output } = await pack("study", STUDY);
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

	test("what the reader wrote is kept across a reload and is sent in the reply under the question", async () => {
		const { output } = await pack("study-reply", STUDY);
		const seen = await inPage(output, async (cdp) => {
			await act(
				cdp,
				`const box = document.getElementById("q1"); box.value = "They add up"; box.dispatchEvent(new Event("input", { bubbles: true }))`,
				"0",
			);
			await load(cdp);
			return act<[string, string[]]>(
				cdp,
				`document.querySelector(".reply-bar .primary").click()`,
				`[document.getElementById("q1").value, document.querySelector(".reply-md").textContent.split("\\n").filter((line) => line.startsWith("- "))]`,
			);
		});
		expect(seen[0]).toBe("They add up");
		expect(seen[1]).toContain("- Why do sines build a square wave? They add up");
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
		const { output } = await pack(
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
});

/** Packs a page with `front` as its frontmatter body, expecting a failure; returns the exit code and the message. */
async function frontFailure(name: string, front: string) {
	const out = dir.path(`${name}.out.html`);
	const result = await runCli([
		"pack",
		dir.write(`${name}.mdx`, `---\n${front}\n---\n\n# T\n`),
		"-o",
		out,
	]);
	return [result.code, result.stderr.trim()];
}

describe("frontmatter", () => {
	test("scheme forces the colour scheme the system would pick; without it the page follows the system", async () => {
		const schemeOf = async (name: string, front: string) => {
			const { output } = await pack(name, `---\n${front}\n---\n\n# T\n\nText.\n`);
			return withPage(async (cdp) => {
				await cdp.send("Page.enable");
				await cdp.send("Emulation.setEmulatedMedia", {
					features: [{ name: "prefers-color-scheme", value: "light" }],
				});
				await load(cdp, `file://${output}`);
				return cdp.evaluate<[string | null, string]>(
					`[document.documentElement.getAttribute("data-scheme"), getComputedStyle(document.body).backgroundColor]`,
				);
			});
		};
		// The system asks for light throughout.
		const [none, paper] = await schemeOf("scheme-system", "title: T");
		const [dark, night] = await schemeOf("scheme-dark", "scheme: dark");
		expect([none, dark]).toEqual([null, "dark"]);
		expect(night).not.toBe(paper);
		expect(await schemeOf("scheme-light", "scheme: light")).toEqual(["light", paper]);
		expect(await frontFailure("scheme-auto", "scheme: auto")).toEqual([
			1,
			expect.stringContaining(
				"scheme-auto.mdx frontmatter: scheme must be light or dark; leave it out to follow the reader's system",
			),
		]);
	}, 30_000);
});
