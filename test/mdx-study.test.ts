import { afterAll, describe, expect, test } from "bun:test";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { act, inPage, load, packedMdx, packMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

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
		const output = await packedMdx(
			dir,
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

/** Packs a page with `front` as its frontmatter body, expecting a failure; returns the exit code and the message. */
async function frontFailure(name: string, front: string) {
	const { result } = await packMdx(dir, name, `---\n${front}\n---\n\n# T\n`);
	return [result.code, result.stderr.trim()];
}

describe("frontmatter", () => {
	test("scheme forces the colour scheme the system would pick; without it the page follows the system", async () => {
		const schemeOf = async (name: string, front: string) => {
			const output = await packedMdx(dir, name, `---\n${front}\n---\n\n# T\n\nText.\n`);
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

	test("pack warns about a lang other than English with no labels, and says how to translate them", async () => {
		const warned = async (name: string, front: string) => {
			const { result } = await packMdx(dir, name, `---\n${front}\n---\n\n# T\n`);
			expect([result.code, result.stderr]).toEqual([0, ""]);
			return result.stdout.split("\n").filter((line) => line.startsWith("warning: "));
		};
		expect(await warned("lang-sl", "lang: sl")).toEqual([
			'warning: lang is "sl" but the frontmatter has no labels, so the texts the kit adds (Back, Next, Reply, Show answer) are English: run kit labels, translate the block and paste it into the frontmatter',
		]);
		expect(await warned("lang-en", "lang: en-GB")).toEqual([]);
		expect(await warned("lang-labelled", 'lang: sl\nlabels:\n  next: "Naprej"')).toEqual([]);
	}, 30_000);
});
