/* A reader who must judge every item of a Records block, on the fixture review (test/fixtures/review/): the answer on each row,
   what is kept and what the reply says. */
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, inPage, kitScriptsIn, load, packedMdx, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const FIXTURES = join(import.meta.dir, "fixtures");

/** The review page, its import made absolute so it packs from the scratch directory. */
const reviewPage = () =>
	readFileSync(join(FIXTURES, "review", "page.mdx"), "utf8").replace(
		"./decisions.json",
		join(FIXTURES, "review", "decisions.json"),
	);

const PAGE_JS = `
const $ = (selector) => document.querySelector(selector);
const answer = (n, value) => document.getElementById("decisions-answer-D" + n + "-" + value);
const note = (n) => document.getElementById("decisions-answer-D" + n + ".note");
const typeNote = (n, text) => { note(n).value = text; note(n).dispatchEvent(new Event("input", { bubbles: true })); };
const replyText = async () => {
	$(".reply-bar .primary").click();
	await new Promise(requestAnimationFrame);
	return $(".reply-md").textContent;
};`;

test("an answer on a row is kept across a reload and joins the reply under the record's label, with its note", async () => {
	const output = await packedMdx(dir, "answer", reviewPage());
	expect(kitScriptsIn(output)).toEqual(expect.arrayContaining(["keep", "reply"]));
	await inPage(output, async (cdp) => {
		await cdp.evaluate(PAGE_JS, true);
		await act(
			cdp,
			`answer(1, "Agree").click(); answer(4, "Change").click(); typeNote(4, "use cosign keyless");`,
			"0",
		);
		await act(cdp, `typeNote(9, "only a note")`, "0");
		await load(cdp);
		await cdp.evaluate(PAGE_JS, true);
		expect(
			await cdp.evaluate(
				`[answer(1, "Agree").checked, answer(4, "Change").checked, note(4).value].join()`,
				true,
			),
		).toBe("true,true,use cosign keyless");
		const reply = await cdp.evaluate<string>(`replyText()`, true);
		expect(reply).toContain("- D1 Publish release candidates to the main channel? Agree\n");
		expect(reply).toContain(
			"- D4 Sign release archives with a project key? Change\n  Note: use cosign keyless\n",
		);
		expect(reply).toContain(
			"- D9 Support Windows paths with spaces in the config file? no answer\n  Note: only a note\n",
		);
		expect(reply).toMatch(/Not answered: D2 [^;\n]*; D3 [^;\n]*; D5 /);
		expect(reply.match(/^- D\d+/gm)).toHaveLength(3);
	});
}, 60_000);

test("a table with a search still answers for every record", async () => {
	const output = await packedMdx(
		dir,
		"table",
		reviewPage().replace(
			"<Records {...decisions} />",
			'<Records {...decisions} views={["tree", "table"]} />',
		),
	);
	await inPage(output, async (cdp) => {
		await cdp.evaluate(PAGE_JS, true);
		await act(
			cdp,
			`$("#decisions .toolbar .seg label:nth-child(2) input").click(); const s = $("#decisions input[type=search]"); s.value = "windows"; s.dispatchEvent(new Event("input", { bubbles: true }));`,
			"0",
		);
		expect(
			await cdp.evaluate(`document.querySelectorAll("#decisions tbody tr").length`, true),
		).toBe(1);
		await act(cdp, `$("#decisions tbody fieldset input[type=radio]").click()`, "0");
		const reply = await cdp.evaluate<string>(`replyText()`, true);
		expect(reply).toContain("- D9 Support Windows paths with spaces in the config file? Agree");
		expect(reply).toMatch(/Not answered: D1 [^;]*; D2 /);
	});
}, 60_000);

test("only a Records block with a reply brings the scripts that keep and send answers", async () => {
	const plain = await packedMdx(
		dir,
		"plain",
		reviewPage().replace(
			"<Records {...decisions} />",
			"<Records {...decisions} reply={undefined} />",
		),
	);
	expect(kitScriptsIn(plain)).not.toContain("reply");
	expect(kitScriptsIn(plain)).not.toContain("keep");
});

const THREE_VIEWS = (source: string) =>
	source.replace(
		"<Records {...decisions} />",
		'<Records {...decisions} views={["tree", "table", "board"]} />',
	);

/** What the reader has entered for decision 1, as the page shows it now. */
const D1 = `[answer(1, "Agree").checked, note(1).value].join()`;

test("an answer survives a change of view and a filter that hides its row and brings it back", async () => {
	const output = await packedMdx(dir, "remount", THREE_VIEWS(reviewPage()));
	await inPage(output, async (cdp) => {
		await cdp.evaluate(PAGE_JS, true);
		const view = (n: number) =>
			act(cdp, `$("#decisions .toolbar .seg label:nth-child(${n}) input").click()`, D1);
		const search = (text: string) =>
			act(
				cdp,
				`const s = $("#decisions input[type=search]"); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event("input", { bubbles: true }));`,
				D1,
			);
		await act(cdp, `answer(1, "Agree").click(); typeNote(1, "use the vault");`, "0");
		const kept = "true,use the vault";
		expect(await view(2)).toBe(kept);
		expect(await view(3)).toBe(kept);
		expect(await view(1)).toBe(kept);
		// Filtered out (its fieldset moves to the hidden list) and back.
		expect(await view(2)).toBe(kept);
		expect(await search("windows")).toBe(kept);
		expect(await search("")).toBe(kept);
		// Clear still resets what the reader entered, in the block as it is now.
		await cdp.evaluate(
			`document.querySelector(".reply-bar .btn:not(.primary)").click(), document.querySelector(".reply-bar .btn:not(.primary)").click()`,
			true,
		);
		expect(await view(1)).toBe("false,");
		const reply = await cdp.evaluate<string>(`replyText()`, true);
		expect(reply).not.toContain("use the vault");
	});
}, 60_000);

/** A client component that shows `jsx`, a Records block, only after a click: its markup is not in the prerendered page. */
const revealing = (jsx: string) => `"use client";
import { useState } from "preact/hooks";
import { Records } from "kit";

export function Reveal() {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button type="button" class="btn" id="reveal" onClick={() => setOpen(true)}>Show</button>
			{open && ${jsx}}
		</div>
	);
}
`;

const LATER = `id: "r", idField: "id", data: [{ id: "a", t: "A" }], fields: { id: { label: "Item", kind: "text" }, t: { label: "Title", kind: "text" } }, columns: ["id", "t"]`;

test("a Records block with a reply that a client component renders later brings keep.js and reply.js; one written out without a reply brings neither", async () => {
	const scripts = async (name: string, jsx: string) => {
		dir.write(`${name}.tsx`, revealing(jsx));
		const page = `import { Reveal } from "./${name}.tsx";\n\n# Review\n\n<Reveal />\n`;
		return kitScriptsIn(await packedMdx(dir, name, page));
	};
	const needed = expect.arrayContaining(["keep", "reply"]);
	expect(
		await scripts("later-spread", `<Records {...{ ${LATER}, reply: { options: ["Agree"] } }} />`),
	).toEqual(needed);
	expect(
		await scripts("later-prop", `<Records {...{ ${LATER} }} reply={{ options: ["Agree"] }} />`),
	).toEqual(needed);
	const plain = await scripts(
		"later-plain",
		`<Records id="r" idField="id" data={[{ id: "a", t: "A" }]} fields={{ id: { label: "Item", kind: "text" }, t: { label: "Title", kind: "text" } }} columns={["id", "t"]} />`,
	);
	expect(plain).not.toContain("reply");
	expect(plain).not.toContain("keep");
}, 60_000);

test("without a sum no row says Total", async () => {
	const html = readFileSync(await packedMdx(dir, "totals", THREE_VIEWS(reviewPage())), "utf8");
	expect(html).not.toContain('<div class="tree-row total"');
	await inPage(await packedMdx(dir, "totals-table", THREE_VIEWS(reviewPage())), async (cdp) => {
		await act(
			cdp,
			`document.querySelector("#decisions .toolbar .seg label:nth-child(2) input").click()`,
			"0",
		);
		expect(await cdp.evaluate(`document.querySelectorAll("#decisions tfoot").length`, true)).toBe(
			0,
		);
	});
}, 60_000);
