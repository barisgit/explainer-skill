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
