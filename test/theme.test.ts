import { afterAll, expect, test } from "bun:test";
import { runStep } from "../skills/explainer/src/steps.ts";
import {
	DESKTOP,
	FRAMES,
	inPage,
	packAndRun,
	packedMdx,
	packHtml,
	pageContract,
	scratch,
	WIDTHS,
} from "./support.ts";

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

test("ranking rows disclose by click, Enter and Space, with room for titles (#35)", async () => {
	const row = `<li><details><summary><span class="name">A long item title that needs more than seven rem</span><span class="bar"><i style="--w:100%"></i></span><span class="val">100%</span></summary><div class="more">Row detail</div></details></li>`;
	const output = dir.path("ranking.out.html");
	expect(
		(
			await packHtml(
				dir.write(
					"ranking.html",
					`${HEAD}<ol class="rank">${row}${row.replaceAll("100%", "99%")}</ol></main></body></html>`,
				),
				output,
			)
		).error,
	).toBe("");
	for (const viewport of WIDTHS) {
		await inPage(
			output,
			async (cdp) => {
				const state = `Array.from(document.querySelectorAll(".rank details"), (row) => row.open)`;
				expect(await cdp.evaluate(state)).toEqual([false, false]);
				expect(
					await cdp.evaluate(`(() => {
				const name = document.querySelector(".rank .name");
				const summary = name.parentElement;
				const tracks = Array.from(document.querySelectorAll(".rank .bar"), (bar) => bar.getBoundingClientRect());
				return tracks[0].width === tracks[1].width && tracks[0].left === tracks[1].left && getComputedStyle(summary).display === "grid" && name.clientWidth > 112 && name.scrollWidth <= name.clientWidth && document.documentElement.scrollWidth === innerWidth;
			})()`),
				).toBe(true);
				await cdp.evaluate(`document.querySelector(".rank summary").click()`);
				expect(await cdp.evaluate(state)).toEqual([true, false]);
				await cdp.evaluate(`document.querySelector(".rank summary").focus()`);
				for (const [key, open] of [
					["Enter", false],
					["Space", true],
				] as const) {
					await runStep(cdp, `key:${key}`, () => dir.path("ranking.png"));
					await cdp.evaluate(FRAMES, true);
					expect(await cdp.evaluate(state)).toEqual([open, false]);
				}
			},
			viewport,
		);
	}
}, 30_000);

for (const panel of ["explicit", "automatic"]) {
	test(`a ${panel} panel keeps its sections local, clips its contents and lets a row stick (#53)`, async () => {
		const page = `${HEAD}<section id="outer"><h2>Panel</h2>
<div class="fig ${panel === "explicit" ? "panel" : ""}" id="panel">
<div id="sticky" style="position:sticky;top:0;background:var(--surface)">Sticky row</div>
<section id="direct">Direct section</section><div><section id="nested">Nested section</section></div>
${panel === "automatic" ? '<input aria-label="Panel control">' : ""}<div id="wide" style="width:200vw;height:40px;background:var(--accent)"></div>
<div style="height:1600px"></div></div></section><div style="height:100vh"></div></main>
<script>
const panel = document.getElementById("panel");
const style = (id) => getComputedStyle(document.getElementById(id));
const local = (id) => ["marginTop", "marginBottom", "paddingTop", "borderTopWidth"].every((key) => style(id)[key] === "0px");
${pageContract({
	"page sections retain their rhythm": `parseFloat(style("outer").marginTop) >= 56 && style("outer").borderTopWidth === "1px"`,
	"direct panel sections have no page rhythm": `local("direct")`,
	"nested panel sections have no page rhythm": `local("nested")`,
	"wide contents stay clipped": `document.documentElement.scrollWidth === document.documentElement.clientWidth && document.elementFromPoint(panel.getBoundingClientRect().right + 2, document.getElementById("wide").getBoundingClientRect().top + 10)?.id !== "wide"`,
	"the rounded corner clips its children": `style("panel").borderTopLeftRadius !== "0px" && document.elementFromPoint(panel.getBoundingClientRect().left + 2, panel.getBoundingClientRect().top + 2)?.id !== "sticky"`,
	"scroll the page into the panel": `(scrollTo(0, panel.getBoundingClientRect().top + scrollY + 200), scrollY > 0)`,
	"the row sticks to the viewport": `Math.abs(document.getElementById("sticky").getBoundingClientRect().top) <= 1`,
})}</script></body></html>`;

		expect(await packAndRun(dir, `panel-${panel}`, page)).toEqual([]);
	}, 30_000);
}

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

test("a masthead paragraph that starts with a bold label is the next action, set as body text in ink rather than as meta (#141)", async () => {
	const output = await packedMdx(
		dir,
		"next",
		"# Flip one bit\n\nThe lede.\n\n**Start:** change one bit (2 minutes)\n\nIllustrative data\n",
	);
	const style = await inPage(output, (cdp) =>
		cdp.evaluate(`(() => {
			const masthead = [...document.querySelectorAll(".masthead > p")].map((p) => p.className);
			const next = getComputedStyle(document.querySelector(".masthead .next"));
			const body = getComputedStyle(document.body);
			return { masthead, mono: next.fontFamily.includes("Mono"), ink: next.color === body.color, size: parseFloat(next.fontSize) >= parseFloat(body.fontSize) };
		})()`),
	);
	expect(style).toEqual({ masthead: ["lede", "next", "meta"], mono: false, ink: true, size: true });
}, 30_000);

test("a .beside figure stays in view while its text scrolls at .wide's width on a desktop, and stacks after the text on a phone and in print (#159)", async () => {
	const text =
		"<p>Prose that explains the figure beside it, long enough to scroll past it.</p>".repeat(40);
	const page = (
		checks: Record<string, string>,
	) => `${HEAD}<div class="wide" id="wide">Wide</div><div class="beside"><div id="text">${text}</div>
<figure class="fig" id="figure"><svg viewBox="0 0 360 200"><rect width="360" height="200" /></svg></figure></div>
${text}</main><script>
const box = (id) => document.getElementById(id).getBoundingClientRect();
const scrolled = (y) => { scrollTo({ top: y, behavior: "instant" }); return box("figure"); };
const mid = () => { const t = box("text"); return scrollY + t.top + t.height / 2; };
${pageContract(checks)}</script></body></html>`;
	const screen = page({
		"side by side at .wide's edges on a desktop": `innerWidth < 900 || (box("figure").left > box("text").right && Math.abs(box("text").left - box("wide").left) < 1 && Math.abs(box("figure").right - box("wide").right) < 1)`,
		"the desktop figure stays in view halfway down the text": `innerWidth < 900 || (() => { const f = scrolled(mid()); return f.top >= 0 && f.bottom <= innerHeight; })()`,
		"the phone figure follows the text": `innerWidth >= 900 || box("figure").top >= box("text").bottom`,
		"the figure scrolls away with the end of its text": `(() => { const end = scrollY + box("text").bottom; return scrolled(end + innerHeight).bottom < 0; })()`,
	});
	const print = page({
		"in flow after the text in print": `getComputedStyle(document.getElementById("figure")).position === "static" && box("figure").top >= box("text").bottom`,
	});

	expect(await packAndRun(dir, "beside", screen)).toEqual([]);
	expect(
		await packAndRun(dir, "beside-print", print, { media: "print", widths: [DESKTOP] }),
	).toEqual([]);
}, 60_000);

test("a .beside code block pins below the Reply bar, so its first line shows and its last fits the window (#159)", async () => {
	const text = "Prose about the code beside it, long enough to scroll past it.\n\n".repeat(120);
	const code = Array.from({ length: 60 }, (_, i) => `const line${i} = ${i};`).join("\n");
	const output = await packedMdx(
		dir,
		"beside-reply",
		`import { Question } from "kit";\n\n# Beside a reply\n\nThe lede.\n\n<Question name="pick" legend="Which?" options={["One", "Two"]} />\n\n<div class="beside">\n<div>\n\n${text}</div>\n\n\`\`\`ts\n${code}\n\`\`\`\n\n</div>\n\n${text}`,
	);
	const placed = await inPage(output, (cdp) =>
		cdp.evaluate(`(() => {
			const pre = document.querySelector(".beside > pre");
			const text = document.querySelector(".beside > div").getBoundingClientRect();
			scrollTo({ top: scrollY + text.top + text.height / 2, behavior: "instant" });
			const bar = document.querySelector(".reply-bar").getBoundingClientRect();
			const box = pre.getBoundingClientRect();
			return { belowBar: box.top >= bar.bottom, fits: box.bottom <= innerHeight };
		})()`),
	);
	expect(placed).toEqual({ belowBar: true, fits: true });
}, 30_000);
