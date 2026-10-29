/* The keys that move between the rows of a Records block, on the fixture review (test/fixtures/review/). */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "../skills/explainer/src/cdp.ts";
import { inPage, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The review page, its import made absolute so it packs from the scratch directory. */
const reviewPage = () =>
	readFileSync(join(import.meta.dir, "fixtures", "review", "page.mdx"), "utf8").replace(
		"./decisions.json",
		join(import.meta.dir, "fixtures", "review", "decisions.json"),
	);

const KEY_CODES: Record<string, number> = {
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Home: 36,
	End: 35,
	Tab: 9,
};

/** Presses a key the way check --do does and lets the page settle, so a re-render after it has happened. */
async function press(cdp: Cdp, key: string) {
	const code = KEY_CODES[key];
	const keys = code ? { key, code: key, windowsVirtualKeyCode: code } : { key, text: key };
	await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...keys });
	await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...keys });
	await cdp.evaluate(
		`new Promise(requestAnimationFrame).then(() => new Promise((done) => setTimeout(done, 50)))`,
		true,
	);
}

const FOCUS_JS = `
const heads = () => [...document.querySelectorAll("#decisions .tree summary")];
const where = () => { const el = document.activeElement; return el.tagName === "SUMMARY" ? el.textContent.trim().split(/\\s/)[0] : el.tagName + ":" + (el.id || el.type); };
const stops = () => heads().filter((h) => h.tabIndex === 0).length + "/" + heads().filter((h) => h.tabIndex === -1).length;`;

test("the arrow keys move between rows and in and out of groups, Tab leaves a row for its answer, and / searches", async () => {
	const output = await packedMdx(dir, "keys", reviewPage());
	await inPage(output, async (cdp) => {
		await cdp.evaluate(FOCUS_JS, true);
		const at = () => cdp.evaluate<string>("where()", true);
		// One row is in the Tab order: the 3 groups and 10 decisions are 13 heads.
		expect(await cdp.evaluate("stops()", true)).toBe("1/12");
		await cdp.evaluate(`heads()[0].focus()`, true);
		await press(cdp, "ArrowDown");
		expect(await at()).toBe("D1");
		await press(cdp, "ArrowDown");
		expect(await at()).toBe("D2");
		await press(cdp, "Tab");
		expect(await at()).toBe("INPUT:decisions-answer-D2-Agree");
		await cdp.evaluate(`heads()[2].focus()`, true);
		await press(cdp, "ArrowUp");
		await press(cdp, "ArrowLeft");
		expect(await cdp.evaluate(`heads()[1].parentElement.open`, true)).toBe(false);
		await press(cdp, "ArrowLeft");
		expect(await at()).toBe("Packaging");
		await press(cdp, "ArrowLeft");
		// A closed group is passed over, and the one stop stays on a row the reader can reach.
		await press(cdp, "ArrowDown");
		expect(await at()).toBe("Security");
		expect(await cdp.evaluate("stops()", true)).toBe("1/12");
		await press(cdp, "ArrowUp");
		await press(cdp, "ArrowRight");
		await press(cdp, "ArrowRight");
		expect(await at()).toBe("D1");
		await press(cdp, "End");
		expect(await at()).toBe("D10");
		await press(cdp, "Home");
		expect(await at()).toBe("Packaging");
		await press(cdp, "/");
		expect(await cdp.evaluate(`document.activeElement.type`, true)).toBe("search");
		await press(cdp, "/");
		expect(await cdp.evaluate(`document.activeElement.value`, true)).toBe("/");
	});
}, 60_000);

test("in the table the arrow keys move between rows, one row being in the Tab order", async () => {
	const output = await packedMdx(
		dir,
		"table-keys",
		reviewPage().replace(
			"<Records {...decisions} />",
			'<Records {...decisions} views={["table"]} />',
		),
	);
	await inPage(output, async (cdp) => {
		const row = `(document.activeElement.closest("tr") ?? {}).rowIndex`;
		await cdp.evaluate(
			`window.stops = () => [...document.querySelectorAll("#decisions tbody tr")].map((tr) => (tr.querySelector("a, summary") ?? tr).tabIndex).join()`,
			true,
		);
		expect(await cdp.evaluate<string>("stops()", true)).toBe("0,-1,-1,-1,-1,-1,-1,-1,-1,-1");
		await cdp.evaluate(`document.querySelector("#decisions tbody tr summary").focus()`, true);
		await press(cdp, "ArrowDown");
		await press(cdp, "ArrowDown");
		expect(await cdp.evaluate(row, true)).toBe(3);
		expect(await cdp.evaluate<string>("stops()", true)).toBe("-1,-1,0,-1,-1,-1,-1,-1,-1,-1");
		await press(cdp, "End");
		expect(await cdp.evaluate(row, true)).toBe(10);
	});
}, 60_000);
