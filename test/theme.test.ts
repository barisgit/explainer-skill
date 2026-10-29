import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const HEAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main class="page">`;

/** One numeric column, so the same rows read as a stacked .compare and as a .compare.table. */
const ROWS = `<thead><tr><th>Store</th><th class="num">Latency</th></tr></thead>
<tbody><tr><th scope="row">Redis</th><td class="num" data-label="Latency">2 ms</td></tr></tbody>`;

test("a .num column ends with tabular digits, except as a line beside its label in a stacked .compare on phones (#54)", async () => {
	const page = `${HEAD}<table class="compare" id="stacked">${ROWS}</table>
<div class="scroll"><table class="compare table" id="grid">${ROWS}</table></div></main>
<script>
const style = (selector) => getComputedStyle(document.querySelector(selector));
const numeric = (selector, align) => style(selector).textAlign === align && style(selector).fontVariantNumeric === "tabular-nums";
${pageContract({
	"a .compare.table's numeric header ends": `numeric("#grid th.num", "end")`,
	"a .compare.table's numeric cell ends": `numeric("#grid td.num", "end")`,
	"a stacked .compare's numeric cell ends wide and starts on phones": `numeric("#stacked td.num", style("#stacked thead").display === "none" ? "start" : "end")`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "num", page)).toEqual([]);
}, 30_000);

test("a page's textarea is drawn like the kit's text inputs", async () => {
	const page = `${HEAD}<input type="text" id="line" aria-label="Line"><textarea id="free" aria-label="Free"></textarea></main>
<script>
const same = (property) => getComputedStyle(document.getElementById("free"))[property] === getComputedStyle(document.getElementById("line"))[property];
${pageContract({
	"its border": `same("borderTopColor") && same("borderTopWidth") && same("borderTopStyle") && same("borderTopLeftRadius")`,
	"its background": `same("backgroundColor")`,
	"its padding": `same("paddingLeft")`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "textarea", page)).toEqual([]);
}, 30_000);

test("a code block wraps on a phone, with its indentation, and scrolls on a wide screen", async () => {
	const line =
		"kit pack page.mdx --out out.html --flag --another-flag --and-one-more-flag --last-flag-of-the-command".repeat(
			2,
		);
	const page = `${HEAD}<pre id="cmd"><code>if ready:\n    ${line}</code></pre></main>
<script>
const pre = document.getElementById("cmd");
${pageContract({
	"the page does not scroll sideways": `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	"the block wraps on a phone only": `(innerWidth < 640) === (pre.scrollWidth <= pre.clientWidth)`,
	"the indentation stays": `getComputedStyle(pre).whiteSpace !== "normal"`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "pre", page)).toEqual([]);
}, 30_000);
