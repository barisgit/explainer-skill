import { afterAll, expect, test } from "bun:test";
import { act, inPage, kitScriptsIn, load, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** A study page: a self-check and a written answer with a model answer, both kept, neither in a reply. */
const STUDY = `import { Question } from "kit";

# Study

<Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">A kWh is a kW for an hour.</Question>

<Question name="why" legend="Why does the queue grow?">Orders arrive faster than they are served.</Question>

## After the questions

The end.
`;

/** Page expression: the Clear control's state, the answers, what the page heard and what is stored. */
const STATE = `(() => {
	const button = document.querySelector(".keep-clear .btn");
	return {
		clear: button && !button.closest("[hidden]") ? button.textContent : null,
		armed: Boolean(button?.classList.contains("is-armed")),
		height: button?.getBoundingClientRect().height ?? 0,
		prompt: document.querySelector(".keep-clear [role=status]")?.textContent ?? "",
		last: Boolean(button && document.querySelector("main").lastElementChild.contains(button)),
		answers: [document.querySelector("[name=unit]:checked")?.value ?? "", document.getElementById("why").value],
		heard: window.heard ?? [],
		stored: Object.keys(localStorage).filter((k) => k.startsWith("explainer:")).length,
	};
})()`;

/** What STATE reads. */
interface State {
	clear: string | null;
	armed: boolean;
	height: number;
	prompt: string;
	last: boolean;
	answers: string[];
	heard: string[];
	stored: number;
}

const HEAR = `window.heard = []; document.addEventListener("input", (e) => window.heard.push(e.target.id));`;
const CLICK = `document.querySelector(".keep-clear .btn").click()`;

test("a page that keeps answers without a reply offers one Clear at its end once something is saved; it asks first, then clears with events", async () => {
	const output = await packedMdx(dir, "study", STUDY);
	expect(kitScriptsIn(output)).not.toContain("reply");
	const seen = await inPage(output, async (cdp) => {
		const fresh = await act<State>(cdp, "", STATE);
		const checked = await act<State>(cdp, `document.getElementById("unit-kWh").click()`, STATE);
		await act(
			cdp,
			`const box = document.getElementById("why"); box.value = "Too many"; box.dispatchEvent(new Event("input", { bubbles: true }))`,
			"0",
		);
		await load(cdp);
		const reloaded = await act<State>(cdp, HEAR, STATE);
		const asking = await act<State>(cdp, CLICK, STATE);
		const cleared = await act<State>(cdp, CLICK, STATE);
		await load(cdp);
		const after = await act<State>(cdp, "", STATE);
		return { fresh, checked, reloaded, asking, cleared, after };
	});
	expect(seen.fresh).toMatchObject({ clear: null, stored: 0 });
	// A self-check's answer alone brings Clear here: there is nothing else to clear it with.
	expect(seen.checked).toMatchObject({ clear: "Clear answers", last: true, stored: 1 });
	expect(seen.reloaded).toMatchObject({ clear: "Clear answers", answers: ["kWh", "Too many"] });
	expect(seen.asking).toMatchObject({
		clear: "Clear everything?",
		armed: true,
		prompt: "Press again to clear all answers.",
		answers: ["kWh", "Too many"],
	});
	// The longer confirm text stays on one line.
	expect(seen.asking.height).toBe(seen.reloaded.height);
	expect(seen.cleared).toMatchObject({ clear: null, answers: ["", ""], stored: 0 });
	expect(seen.cleared.heard).toContain("why");
	expect(seen.after).toMatchObject({ clear: null, answers: ["", ""], stored: 0 });
}, 30_000);

test("a reply question that appears after keep's Clear moves Clear into the reply bar, so one Clear shows at a time", async () => {
	const output = await packedMdx(
		dir,
		"ask-later",
		`import { Question } from "kit";\nimport { Ask } from "./ask.tsx";\n\n# Later\n\n<Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">A kWh is a kW for an hour.</Question>\n\n<Ask />\n`,
		{
			"ask.tsx": `"use client";
import { useState } from "preact/hooks";
import { Question } from "kit";

export function Ask() {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button type="button" class="btn" id="reveal" onClick={() => setOpen(true)}>Ask</button>
			{open && <Question name="next" legend="What next?" options={["More", "Less"]} />}
		</div>
	);
}
`,
		},
	);
	const shown = `[".keep-clear .btn", ".reply-bar .btn:not(.primary)", ".reply-bar .primary"].map((s) => Boolean(document.querySelector(s)?.checkVisibility())).concat(document.getElementById("unit-kWh").checked)`;
	const barClear = `document.querySelector(".reply-bar .btn:not(.primary)").click()`;
	const seen = await inPage(output, async (cdp) => {
		const chosen = await act(cdp, `document.getElementById("unit-kWh").click()`, shown);
		const asked = await act(cdp, `document.getElementById("reveal").click()`, shown);
		await act(cdp, barClear, "0");
		return { chosen, asked, cleared: await act(cdp, barClear, shown) };
	});
	// [keep's Clear, the bar's Clear, Reply, the self-check's choice]
	expect(seen).toEqual({
		chosen: [true, false, false, true],
		asked: [false, true, true, true],
		cleared: [false, false, true, false],
	});
}, 30_000);

const GAIN = `<label>Gain <input id="gain" type="range" min="0" max="10" value="5" /></label>`;
const SLIDE = `const g = document.getElementById("gain"); g.value = "8"; g.dispatchEvent(new Event("input", { bubbles: true }))`;
/** The slider's value, whether keep's own Clear shows, the self-check's choice and how many pages have saved state. */
const GAIN_STATE = `[document.getElementById("gain").value, Boolean(document.querySelector(".keep-clear .btn")?.checkVisibility()), document.getElementById("unit-kWh")?.checked ?? null, Object.keys(localStorage).filter((k) => k.startsWith("explainer:")).length]`;

test("a page with controls but no Question keeps them silently, with no Clear", async () => {
	const output = await packedMdx(dir, "controls-only", `# Controls\n\n${GAIN}\n`);
	const seen = await inPage(output, async (cdp) => {
		const moved = await act(cdp, SLIDE, GAIN_STATE);
		await load(cdp);
		return { moved, reloaded: await act(cdp, "", GAIN_STATE) };
	});
	// [slider, Clear shown, choice, pages with saved state]
	expect(seen).toEqual({ moved: ["8", false, null, 1], reloaded: ["8", false, null, 1] });
}, 30_000);

test("Clear answers belongs to the Question answers: moving a control brings none, and clearing leaves the control as the reader set it", async () => {
	const output = await packedMdx(
		dir,
		"controls-and-question",
		`import { Question } from "kit";\n\n# Both\n\n${GAIN}\n\n<Question name="unit" legend="Which one is energy?" options={["kW", "kWh"]} answer="kWh">A kWh is a kW for an hour.</Question>\n`,
	);
	const seen = await inPage(output, async (cdp) => {
		const moved = await act(cdp, SLIDE, GAIN_STATE);
		const chosen = await act(cdp, `document.getElementById("unit-kWh").click()`, GAIN_STATE);
		await load(cdp);
		const reloaded = await act(cdp, "", GAIN_STATE);
		await act(cdp, CLICK, "0");
		return { moved, chosen, reloaded, cleared: await act(cdp, CLICK, GAIN_STATE) };
	});
	expect(seen).toEqual({
		moved: ["8", false, false, 1],
		chosen: ["8", true, true, 1],
		reloaded: ["8", true, true, 1],
		cleared: ["8", false, false, 1],
	});
}, 30_000);
