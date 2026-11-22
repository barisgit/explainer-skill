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

/** A page whose Term leads to a View far down its overview, and a Term to a static view whose param holds a ?. */
const VIEW_PAGE = `import { Term, View } from "kit";

# Mixing moves a band

<div style={{ blockSize: "1500px" }} />

A mixer multiplies by a cosine, which shifts the <Term view="spectrum">spectrum</Term> by $\\pm f_0$, as <Term view="person/a?b">Ana</Term> showed.

<div style={{ blockSize: "3000px" }} />

<View name="spectrum" back="Mixing">

# The spectrum

The **spectrum** $X(f)$ of a signal says how strong each frequency in it is.

</View>

<View name="person" param="a?b" back="Mixing">

# Ana

</View>
`;

/** Clicks the element `selector` names at its centre, as a pointer does (Chrome focuses no link on a mouse click). */
async function pointerClick(cdp: Cdp, selector: string) {
	const [x, y] = await cdp.evaluate<[number, number]>(
		`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
	);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
	}
	await cdp.evaluate(FRAMES, true);
}

describe("Terms that lead to a View", () => {
	test("pack writes a Term with view as a link to its View's route, which brings views.js and no recall.js", async () => {
		const output = await packedMdx(dir, "term-view", VIEW_PAGE);
		const html = readFileSync(output, "utf8");
		expect(html).toContain(
			'<a class="term" href="#spectrum" data-term-view="spectrum">spectrum</a>',
		);
		expect(html).toContain(
			'<a class="term" href="#person/a%3Fb" data-term-view="person/a?b">Ana</a>',
		);
		expect(kitScriptsIn(output)).toEqual(["views"]);
	}, 30_000);

	test("pack fails on a Term leading to no View, in a heading, or naming both a Recall and a View", async () => {
		const page = (body: string) => `import { Recall, Term, View } from "kit";

# Broken

${body}

<View name="person" param="ana" back="Broken">

# Ana

</View>

<View name="item" back="Broken">

# Item

</View>

<Recall id="a">A.</Recall>
`;
		const { result } = await packMdx(
			dir,
			"term-view-broken",
			page(`## The <Term view="item">item</Term> heading

See <Term view="nope">nope</Term>, <Term view="person/bo">Bo</Term>, <Term view="item/7">item 7</Term> and <Term recall="a">a</Term>.`),
		);
		expect(result.code).toBe(1);
		for (const problem of [
			'<Term view="item"> is in the heading "The item heading"',
			'<Term view="nope"> under "The item heading" leads to no View (the page\'s views are person, item)',
			'<Term view="person/bo"> under "The item heading" leads to no View',
		]) {
			expect(result.stderr).toContain(problem);
		}
		// A view without a param draws every param of its name, as views.js routes it.
		expect(result.stderr).not.toContain('<Term view="item/7">');
		const both = await packMdx(
			dir,
			"term-both",
			page('See <Term recall="a" view="item">a</Term>.'),
		);
		expect(both.result.code).toBe(1);
		expect(both.result.stderr).toContain('<Term> takes recall="..."');
	}, 30_000);

	test("Back and the view's Back link return the reader to the Term they left from, at its place in the window and focused", async () => {
		const output = await packedMdx(dir, "term-view-back", VIEW_PAGE);
		const term = `document.querySelector('a.term[href="#spectrum"]')`;
		const state = `({ top: Math.round(${term}.getBoundingClientRect().top), focused: document.activeElement === ${term}, hash: location.hash })`;
		for (const viewport of WIDTHS) {
			const seen = await inPage(
				output,
				async (cdp) => {
					await cdp.evaluate(`${term}.scrollIntoView({ block: "center" })`);
					const before = await act<{ top: number; focused: boolean; hash: string }>(cdp, "", state);
					await pointerClick(cdp, 'a.term[href="#spectrum"]');
					const opened = await act(
						cdp,
						"",
						`({ hash: location.hash, heading: document.activeElement?.textContent })`,
					);
					const back = await act(cdp, "history.back()", state);
					await pointerClick(cdp, 'a.term[href="#spectrum"]');
					const link = await act(
						cdp,
						`document.querySelector(".view.active .back").click()`,
						state,
					);
					return { before, opened, back, link };
				},
				viewport,
			);
			const at = { top: seen.before.top, focused: true, hash: "" };
			expect(seen).toEqual({
				before: { ...at, focused: false },
				opened: { hash: "#spectrum", heading: "The spectrum" },
				back: at,
				link: at,
			});
		}
	}, 60_000);
});
