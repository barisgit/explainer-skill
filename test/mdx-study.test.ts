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
