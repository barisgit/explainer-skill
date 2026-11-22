import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { placeRecalls } from "../skills/explainer/src/recalls.ts";
import {
	act,
	FRAMES,
	inPage,
	kitScriptsIn,
	packedMdx,
	packMdx,
	scratch,
	WIDTHS,
} from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A page with one Recall mentioned twice (the second mention open, and linked by ref), and a second Recall of two paragraphs' worth of markup. */
const PAGE = `import { Recall, Term } from "kit";

# Mixing moves a band

A mixer multiplies by a cosine, which shifts the <Term recall="spectrum">spectrum</Term> by $\\pm f_0$.

## Down to the IF

The shifted <Term recall="spectrum" open>spectrum</Term> lands on <Term recall="if" data-ref="if">the intermediate frequency</Term>, where one fixed filter keeps it.

The <span data-ref="if">IF</span> filter.

<Recall id="spectrum">The **spectrum** $X(f)$ of a signal says how strong each frequency in it is.</Recall>

<Recall id="if">

The **intermediate frequency** is the one fixed frequency a receiver moves every channel to.

</Recall>
`;

/** Each Term on the page: its text, state, and whether its reminder shows. */
const TERMS = `[...document.querySelectorAll("button.term")].map((term) => ({
	text: term.textContent,
	open: term.getAttribute("aria-expanded"),
	shown: getComputedStyle(term.nextElementSibling).display !== "none",
}))`;

/** Presses `key` on the focused element as a keyboard does, with the character a key down types. */
async function press(cdp: Cdp, key: "Enter" | " ") {
	const code = key === "Enter" ? 13 : 32;
	const text = key === "Enter" ? "\r" : " ";
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key,
		text,
		windowsVirtualKeyCode: code,
	});
	await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code });
	await cdp.evaluate(FRAMES, true);
}

describe("recalls when the page packs", () => {
	test("pack writes each Recall's text into the box of every Term that mentions it, the first marked for print", async () => {
		const output = await packedMdx(dir, "recall", PAGE);
		const html = readFileSync(output, "utf8");

		expect(html).not.toContain("explainer-recall");
		expect(html).not.toContain("data-recall-text");
		const boxes = [...html.matchAll(/<span class="recall"( data-first="")?>(.*?)<\/span>(?= )/g)];
		expect(boxes.map(([, first]) => Boolean(first))).toEqual([true, false, true]);
		expect(boxes[0]?.[2]).toBe(boxes[1]?.[2]);
		expect(boxes[0]?.[2]).toContain("<strong>spectrum</strong> <math>");
		// A Recall of one paragraph loses the paragraph: its box sits inside a sentence.
		expect(boxes[2]?.[2]).toStartWith("The <strong>intermediate frequency</strong>");
		// Punctuation right after a Term stays beside it, before its box.
		expect(html).toContain('the intermediate frequency</button>,<span class="recall"');
		expect(html).toContain('data-recall="spectrum" aria-expanded="true"');
		expect(html).toContain('data-recall="if" data-ref="if" aria-expanded="false"');
		expect(kitScriptsIn(output)).toEqual(["link", "recall"]);
	}, 30_000);

	test("pack fails naming each Term without a Recall, in a heading or a link, and each Recall written twice, with no id, empty, or holding what a sentence cannot", async () => {
		const { result } = await packMdx(
			dir,
			"broken",
			`import { Recall, Term } from "kit";
import { Later } from "./later.tsx";

# Broken

## The <Term recall="a">a</Term> heading

Uses <Term recall="nope">nope</Term>, <Term recall="b">b</Term> and <Term recall="c">c</Term>.

<Recall id="a">A.</Recall>

<Recall id="a">A again.</Recall>

<Recall id="b">

- a list

</Recall>

<Recall id="c">C mentions <Term recall="a">a</Term>.</Recall>

<Recall id="">Nameless.</Recall>

<Recall>No id at all.</Recall>

## Links and boxes

See [the <Term recall="a">a</Term> page](#x), and <Term recall="a">[linked](#x)</Term>.

<Recall id="d"><search>Search</search> text.</Recall>

<Recall id="e"><span> </span></Recall>

<Recall id="f">Holds <Later />.</Recall>

## Nested

<Term recall="a">outer <Term recall="a">inner</Term></Term>.
`,
			{
				"later.tsx": `"use client";

export function Later() {
	return <span>later</span>;
}
`,
			},
		);
		expect(result.code).toBe(1);
		const lines = result.stderr.split("\n");
		for (const problem of [
			'<Term recall="a"> is in the heading "The a heading"',
			'<Term recall="nope"> under "The a heading" names no Recall (the page\'s recalls are a, b, c, d, e, f): write <Recall id="nope">',
			'<Recall id="a"> is written 2 times (under "The a heading", under "The a heading")',
			'<Recall id="b"> holds a <ul>, but it opens inside a sentence',
			'<Recall id="c"> mentions a <Term>',
			'a <Recall> under "The a heading" has no id',
			'<Term recall="a"> under "Links and boxes" is inside a link, another control or another Term',
			'<Term recall="a"> under "Links and boxes" holds a <a>',
			'<Recall id="d"> holds a <search>',
			'<Recall id="e"> is empty',
			'<Recall id="f"> holds a client component',
			'<Term recall="a"> under "Nested" is inside a link, another control or another Term',
		]) {
			expect(
				lines.some((line) => line.includes(problem)),
				problem,
			).toBe(true);
		}
	}, 30_000);

	test("pack warns about a Recall no Term mentions, and moves the punctuation after a Term's phrase before its box", async () => {
		const { result, output } = await packMdx(
			dir,
			"unused",
			`import { Recall, Term } from "kit";

# Unused

The *<Term recall="a">a</Term>*, said once, and <bdi><Term recall="a">a</Term></bdi>; twice.

<Recall id="a">A.</Recall>

<Recall id="lonely">Never mentioned.</Recall>
`,
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain(
			'warning: <Recall id="lonely"> under "Unused" is never mentioned: mark a mention with <Term recall="lonely">...</Term>, or remove it',
		);
		expect(result.stdout).not.toContain('Recall id="a"');
		// The comma that ends the term's phrase moves before the box, inside the emphasis the box closes.
		expect(readFileSync(output, "utf8")).toContain(
			'>a</button>,<span class="recall" data-first="">A.</span></em> said once, and',
		);
		expect(readFileSync(output, "utf8")).toContain(
			'>a</button>;<span class="recall">A.</span></bdi> twice.',
		);
	}, 30_000);

	test("pack fails on a Term a client component renders, since pack places the reminder's text", async () => {
		const { result } = await packMdx(
			dir,
			"client",
			'import { Later } from "./later.tsx";\n\n# Client\n\n<Later />\n',
			{
				"later.tsx": `"use client";
import { Term } from "kit";

export function Later() {
	return <p>The <Term recall="a">a</Term>.</p>;
}
`,
			},
		);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('a "use client" component renders a <Term> or <Recall>');
	}, 30_000);
});

test("pack reads Recalls from the page's elements only, leaving marker-shaped script text and comments as they are", async () => {
	const script = `<script>const example = '<explainer-recall data-id="a">Example</explainer-recall>';</script>`;
	const comment = `<!--<explainer-recall data-id="a">Old</explainer-recall>-->`;
	const { html, problems } = await placeRecalls(
		`<p>The <button type="button" class="term" data-recall="a" aria-expanded="false">a</button><span class="recall" data-recall-text="a"></span>.</p><explainer-recall data-id="a">A.</explainer-recall>${comment}${script}`,
	);
	expect(problems).toEqual([]);
	expect(html).toContain(script);
	expect(html).toContain(comment);
	expect(html).toContain('>a</button>.<span class="recall" data-first="">A.</span></p>');
});

describe("recalls in the browser", () => {
	test("a Term opens and closes its reminder by click, Enter and Space, on desktop and phone, and keeps its ref link", async () => {
		const output = await packedMdx(dir, "toggle", PAGE);
		for (const viewport of WIDTHS) {
			const seen = await inPage(
				output,
				async (cdp) => {
					const start = await cdp.evaluate(TERMS);
					const clicked = await act(cdp, `document.querySelector("button.term").click()`, TERMS);
					const closed = await act(cdp, `document.querySelector("button.term").click()`, TERMS);
					await cdp.evaluate(`document.querySelector('[data-recall="if"]').focus()`);
					await press(cdp, "Enter");
					const entered = await cdp.evaluate(TERMS);
					await press(cdp, " ");
					const spaced = await cdp.evaluate(TERMS);
					const linked = await cdp.evaluate(
						`[...document.querySelectorAll('[data-ref="if"]')].every((el) => el.classList.contains("is-linked"))`,
					);
					return { start, clicked, closed, entered, spaced, linked };
				},
				viewport,
			);
			const terms = (spectrum: string, again: string, ifOpen: string) => [
				{ text: "spectrum", open: spectrum, shown: spectrum === "true" },
				{ text: "spectrum", open: again, shown: again === "true" },
				{ text: "the intermediate frequency", open: ifOpen, shown: ifOpen === "true" },
			];
			expect(seen).toEqual({
				start: terms("false", "true", "false"),
				clicked: terms("true", "true", "false"),
				closed: terms("false", "true", "false"),
				entered: terms("false", "true", "true"),
				spaced: terms("false", "true", "false"),
				linked: true,
			});
		}
	}, 60_000);

	test("a printout shows each reminder at its first mention and wherever it is open", async () => {
		const output = await packedMdx(dir, "print", PAGE);
		const shown = await inPage(output, async (cdp) => {
			await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
			return cdp.evaluate(`${TERMS}.map(({ shown }) => shown)`);
		});
		expect(shown).toEqual([true, true, true]);
		const closedAgain = await inPage(output, async (cdp) => {
			await act(cdp, `document.querySelectorAll("button.term")[1].click()`, "0");
			await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
			return cdp.evaluate(`${TERMS}.map(({ shown }) => shown)`);
		});
		expect(closedAgain).toEqual([true, false, true]);
	}, 30_000);
});
