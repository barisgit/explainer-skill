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
