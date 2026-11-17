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

/** One numeric column, as a .compare and as a .compare.table in .scroll. */
const ROWS = `<thead><tr><th>Store</th><th class="num">Latency</th></tr></thead>
<tbody><tr><th scope="row">Redis</th><td class="num" data-label="Latency">2 ms</td></tr></tbody>`;

test("a .num column ends with tabular digits on every screen (#54)", async () => {
	const page = `${HEAD}<table class="compare" id="plain">${ROWS}</table>
<div class="scroll"><table class="compare table" id="grid">${ROWS}</table></div></main>
<script>
const style = (selector) => getComputedStyle(document.querySelector(selector));
const numeric = (selector) => style(selector).textAlign === "end" && style(selector).fontVariantNumeric === "tabular-nums";
${pageContract({
	"a .compare.table's numeric header ends": `numeric("#grid th.num")`,
	"a .compare.table's numeric cell ends": `numeric("#grid td.num")`,
	"a .compare's numeric cell ends": `numeric("#plain td.num")`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "num", page)).toEqual([]);
}, 30_000);

/** A table as a Markdown truth table packs it, and one too wide for a phone. */
const SMALL = `<thead><tr><th>A</th><th>B</th><th>Out</th></tr></thead><tbody>
${["00", "01", "10", "11"].map(([a, b]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${Number(a) & Number(b)}</td></tr>`).join("")}</tbody>`;
const WIDE = `<thead><tr><th>Option</th>${["Cost", "Delay", "Risk", "Effort", "Owner"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${["Ship now", "One more spin"].map((name) => `<tr><th scope="row">${name}</th>${["Two spare boards per site", "Three weeks after review", "Low, with a fallback plan", "One engineer for a week", "Hardware team lead"].map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody>`;

test("on a phone a .compare stays a table: a small one as it is, a wide one scrolling sideways with its row names in view (#183)", async () => {
	const page = `${HEAD}<table class="compare" id="small">${SMALL}</table><table class="compare" id="wide">${WIDE}</table></main>
<script>
const box = (selector) => document.querySelector(selector).getBoundingClientRect();
const phone = innerWidth < 768;
${pageContract({
	"every cell is a table cell": `[...document.querySelectorAll(".compare :is(th, td)")].every((cell) => getComputedStyle(cell).display === "table-cell")`,
	"the column heads show": `[...document.querySelectorAll(".compare thead")].every((head) => head.checkVisibility() && head.getBoundingClientRect().height > 0)`,
	"the page itself never scrolls sideways": `document.documentElement.scrollWidth <= innerWidth`,
	"the small table needs no scrolling": `document.getElementById("small").scrollWidth <= document.getElementById("small").clientWidth`,
	"on a phone the wide table scrolls sideways inside its box": `!phone || document.getElementById("wide").scrollWidth > document.getElementById("wide").clientWidth + 100`,
	"scrolled, its row names stay at its start": `!phone || (document.getElementById("wide").scrollLeft = 200, Math.abs(box("#wide tbody th").left - box("#wide").left) < 1 && Math.abs(box("#wide thead th").left - box("#wide").left) < 1)`,
	"a row name covers the cells that pass under it": `!phone || getComputedStyle(document.querySelector("#wide tbody th")).backgroundColor === getComputedStyle(document.body).backgroundColor`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "phone-table", page)).toEqual([]);
}, 30_000);

test("on a phone a table too wide scrolls further rather than crush its columns: rows one to three lines, a table that fits unchanged (#210)", async () => {
	const sizes = `[{ size: "5 kWh", price: 4200, back: 10, covers: "The evening peak for a small flat with one person" }, { size: "10 kWh", price: 7900, back: 17, covers: "A family's evening and night use through the winter" }, { size: "15 kWh", price: 11200, back: 23, covers: "Two days of cloud" }]`;
	const cols = `[{ head: "Size", value: "size" }, { head: "Price", value: "price", format: { currency: "EUR" } }, { head: "Paid back in", value: "back", format: { unit: "years" } }, { head: "What it covers", value: "covers" }]`;
	const output = await packedMdx(
		dir,
		"phone-measure",
		`import { Question } from "kit";\n\n# Sizes\n\n## Pick one\n\n<Question name="size" legend="Which size?" rows={${sizes}} cols={${cols}} recommended="10 kWh" />\n\n| Size | Price | Paid back in | What it covers |\n|---|---:|---:|---|\n| 5 kWh | €4,200 | 10 years | The evening peak for a small flat with one person |\n| 10 kWh | €7,900 | 17 years | A family's evening and night use through the winter |\n\n| A | B | Out |\n|---|---|---|\n| 00 | 0 | 0 |\n`,
	);
	const seen = await inPage(
		output,
		(cdp) =>
			cdp.evaluate<{
				questionLines: number;
				markdownLines: number;
				scrolls: boolean[];
				pageScrolls: boolean;
				numbersOnOneLine: boolean;
				smallFits: boolean;
			}>(`(() => {
		const [question, markdown, small] = document.querySelectorAll("table.compare");
		// Lines a row takes: its height less its cells' padding, in lines of its cells' text.
		const lines = (table) => [...table.tBodies[0].rows].map((row) => { const cell = getComputedStyle(row.cells[1]); return Math.round((row.getBoundingClientRect().height - parseFloat(cell.paddingTop) - parseFloat(cell.paddingBottom)) / parseFloat(cell.lineHeight) * 10) / 10; });
		const textLines = (el) => { const range = document.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size; };
		const box = (table) => table.parentElement.matches(".scroll") ? table.parentElement : table;
		return {
			questionLines: Math.max(...lines(question)),
			markdownLines: Math.max(...lines(markdown)),
			scrolls: [question, markdown].map((t) => box(t).scrollWidth > box(t).clientWidth),
			pageScrolls: document.documentElement.scrollWidth > innerWidth,
			numbersOnOneLine: [...markdown.querySelectorAll("td.num")].every((td) => textLines(td) === 1),
			smallFits: box(small).scrollWidth <= box(small).clientWidth && Math.abs(small.getBoundingClientRect().width - document.querySelector("h2").getBoundingClientRect().width) < 1,
		};
	})()`),
		WIDTHS[1],
	);
	expect(seen).toEqual({
		questionLines: expect.any(Number),
		markdownLines: expect.any(Number),
		scrolls: [true, true],
		pageScrolls: false,
		numbersOnOneLine: true,
		smallFits: true,
	});
	expect(seen.questionLines).toBeLessThanOrEqual(3.2);
	expect(seen.markdownLines).toBeLessThanOrEqual(3.2);
}, 30_000);

test("printed, a wide .compare keeps every column on the paper, with no scroller to hide the last (#183)", async () => {
	const heads = Array.from({ length: 12 }, (_, i) => `<th>Month ${i + 1}</th>`).join("");
	const cells = Array.from({ length: 12 }, (_, i) => `<td>Reading ${i + 1}</td>`).join("");
	const page = `${HEAD}<table class="compare" id="twelve"><thead><tr><th>Site</th>${heads}</tr></thead>
<tbody><tr><th scope="row">North</th>${cells}</tr></tbody></table></main>
<script>
const last = (selector) => document.querySelector(selector).getBoundingClientRect();
${pageContract({
	"the table is no scroller": `["visible", "clip"].includes(getComputedStyle(document.getElementById("twelve")).overflowX)`,
	"the last column's head ends on the paper": `last("#twelve thead th:last-child").right <= document.documentElement.clientWidth`,
	"the last column's cell ends on the paper": `last("#twelve td:last-child").right <= document.documentElement.clientWidth`,
	"its text is whole": `[...document.querySelectorAll("#twelve :is(th, td)")].every((cell) => cell.scrollWidth <= cell.clientWidth + 1)`,
})}</script></body></html>`;

	// A5 and A4 portrait with the printer's margins, in CSS pixels.
	const paper = [
		{ width: 480, height: 720, mobile: false },
		{ width: 718, height: 1047, mobile: false },
	];
	expect(await packAndRun(dir, "print-table", page, { media: "print", widths: paper })).toEqual([]);
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
	test(`a ${panel} panel keeps its sections local, clips its contents without a frame and lets a row stick (#53)`, async () => {
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
	"page sections are set apart by space alone": `parseFloat(style("outer").marginTop) >= 56 && style("outer").borderTopWidth === "0px"`,
	"direct panel sections have no page rhythm": `local("direct")`,
	"nested panel sections have no page rhythm": `local("nested")`,
	// Clipped 0.375rem out (overflow-clip-margin), so the focus ring of a control at the figure's edge shows.
	"wide contents stay clipped": `document.documentElement.scrollWidth === document.documentElement.clientWidth && document.elementFromPoint(panel.getBoundingClientRect().right + 8, document.getElementById("wide").getBoundingClientRect().top + 10)?.id !== "wide"`,
	"the figure has no frame or fill": `style("panel").borderTopWidth === "0px" && style("panel").backgroundColor === "rgba(0, 0, 0, 0)"`,
	"scroll the page into the panel": `(scrollTo(0, panel.getBoundingClientRect().top + scrollY + 200), scrollY > 0)`,
	"the row sticks to the viewport": `Math.abs(document.getElementById("sticky").getBoundingClientRect().top) <= 1`,
})}</script></body></html>`;

		expect(await packAndRun(dir, `panel-${panel}`, page)).toEqual([]);
	}, 30_000);
}

/** Page functions: the WCAG contrast of two computed rgb() colours, and an element's computed colour by id. */
const CONTRAST = `const luminance = (rgb) => rgb.match(/[\\d.]+/g).slice(0, 3).map(Number).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const colour = (id, property) => getComputedStyle(document.getElementById(id))[property];`;

test("a checked series toggle keeps an edge at 3:1 on every tone in both schemes, whatever its swatch", async () => {
	const page = `${HEAD}<label class="toggle" style="--swatch: var(--c4)"><input type="checkbox" id="on" checked><span>Series</span></label>
<label class="toggle" style="--swatch: var(--c4)"><input type="checkbox" id="off"><span>Series</span></label>
<div id="bg" style="background: var(--bg)">.</div><div id="surface" style="background: var(--surface)">.</div><div id="sunken" style="background: var(--sunken)">.</div></main>
<script>${CONTRAST}
const least = (id) => Math.min(...["bg", "surface", "sunken"].map((tone) => contrast(colour(id, "borderTopColor"), colour(tone, "backgroundColor"))));
const inScheme = (scheme, check) => { document.documentElement.dataset.scheme = scheme; return check(); };
${pageContract({
	"light: the checked box's edge": `inScheme("light", () => least("on") >= 3)`,
	"light: the empty box's edge": `inScheme("light", () => least("off") >= 3)`,
	"dark: the checked box's edge": `inScheme("dark", () => least("on") >= 3)`,
	"dark: the empty box's edge": `inScheme("dark", () => least("off") >= 3)`,
	"the checked box still shows its series colour": `colour("on", "backgroundColor") !== colour("off", "backgroundColor")`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "toggle-contrast", page, { widths: [DESKTOP] })).toEqual([]);
}, 30_000);

test("series colours are muted inks told apart by lightness, each 3:1 on the page, and chips mark the accent's three states (#190)", async () => {
	const swatches = [1, 2, 3, 4, 5, 6]
		.map((i) => `<i id="c${i}" style="background: var(--c${i})">.</i>`)
		.join("");
	const page = `${HEAD}${swatches}<div id="bg" style="background: var(--bg)">.</div>
<p class="legend"><span class="chip" style="--swatch: var(--accent)"><i id="solid"></i>Done</span><span class="chip"><i id="hollow" class="hollow"></i>Planned</span><span class="chip"><i id="hatch" class="hatch"></i>Estimated</span></p></main>
<script>${CONTRAST}
const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
// A computed colour as rgb(), whatever space the browser writes it in (color-mix gives oklab).
const rgb = (css) => { pixel.clearRect(0, 0, 1, 1); pixel.fillStyle = css; pixel.fillRect(0, 0, 1, 1); return "rgb(" + [...pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(", ") + ")"; };
const series = () => [1, 2, 3, 4, 5, 6].map((i) => rgb(colour("c" + i, "backgroundColor")));
const inScheme = (scheme, check) => { document.documentElement.dataset.scheme = scheme; return check(); };
const onPage = () => series().every((c) => contrast(c, rgb(colour("bg", "backgroundColor"))) >= 3);
// No more hue than the ink's and the page's own warmth.
const spread = (c) => { const [r, g, b] = c.match(/\\d+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b); };
const grey = () => series().every((c) => spread(c) <= Math.max(spread(rgb(getComputedStyle(document.body).color)), spread(rgb(colour("bg", "backgroundColor")))));
const apart = () => series().every((c, i, all) => all.every((d, j) => i === j || contrast(c, d) >= 1.2));
// Neighbours in order, the last beside the first as in a pie, differ most: they touch in stacks and pies.
const neighbours = () => series().every((c, i, all) => contrast(c, all[(i + 1) % all.length]) >= 1.6);
const marker = (id) => getComputedStyle(document.getElementById(id));
${pageContract({
	"light: every series colour is 3:1 on the page": `inScheme("light", onPage)`,
	"light: series colours are as grey as the ink and page": `inScheme("light", grey)`,
	"light: no two series colours are close in lightness": `inScheme("light", apart)`,
	"light: neighbouring series colours are well apart": `inScheme("light", neighbours)`,
	"dark: every series colour is 3:1 on the page": `inScheme("dark", onPage)`,
	"dark: series colours are as grey as the ink and page": `inScheme("dark", grey)`,
	"dark: no two series colours are close in lightness": `inScheme("dark", apart)`,
	"dark: neighbouring series colours are well apart": `inScheme("dark", neighbours)`,
	"a solid marker is the accent": `rgb(marker("solid").backgroundColor) === rgb(getComputedStyle(document.body).getPropertyValue("--accent"))`,
	"a hollow marker is the accent's tint in an accent outline": `marker("hollow").boxShadow.includes("inset") && rgb(marker("hollow").backgroundColor) !== rgb(marker("solid").backgroundColor)`,
	"a hatch marker is stripes in a grey outline": `marker("hatch").backgroundImage.startsWith("repeating-linear-gradient") && marker("hatch").boxShadow.includes("inset")`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "series-greys", page, { widths: [DESKTOP] })).toEqual([]);
}, 30_000);

test("text keeps to the text and label sizes, the label 13 px on every screen: code takes the size of the text around it, and a code block is a label", async () => {
	const output = await packedMdx(
		dir,
		"code-sizes",
		`# Sizes

Prose with \`inline\` code.

\`\`\`ts
const answer = 42;
\`\`\`

<figure className="fig"><figcaption>A caption with <code>code</code> in it.</figcaption></figure>

<pre id="hand">hand-written</pre>
`,
	);
	const sizesAt = (viewport: (typeof WIDTHS)[number]) =>
		inPage(
			output,
			(cdp) =>
				cdp.evaluate<Record<string, string | boolean>>(`(() => {
			const size = (selector) => getComputedStyle(document.querySelector(selector)).fontSize;
			const text = size("body");
			const label = size("figcaption");
			const own = [...document.querySelectorAll("main *:not(h1, h2, h1 *, h2 *)")]
				.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
				.map((el) => getComputedStyle(el).fontSize);
			return {
				label,
				levels: [...new Set(own)].sort().join(" ") === [text, label].sort().join(" "),
				inline: size("p > code") === text,
				caption: size("figcaption > code") === label,
				fence: size("pre > code") === label,
				hand: size("#hand") === label,
				mono: getComputedStyle(document.querySelector("pre > code")).fontFamily.includes("Mono"),
			};
		})()`),
			viewport,
		);
	for (const viewport of WIDTHS) {
		expect(await sizesAt(viewport)).toEqual({
			label: "13px",
			levels: true,
			inline: true,
			caption: true,
			fence: true,
			hand: true,
			mono: true,
		});
	}
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

test("a finding-length headline takes two lines on a desktop", async () => {
	const output = await packedMdx(
		dir,
		"headline",
		"# The first 5 kWh pays for itself in *10 years*. The second would take 62.\n\nA lede.\n",
	);
	const lines = await inPage(output, (cdp) =>
		cdp.evaluate<number>(
			`(() => { const h1 = document.querySelector("h1"); return Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)); })()`,
		),
	);
	expect(lines).toBe(2);
}, 30_000);

test("a masthead paragraph that starts with a bold label is the next action, set as body text in ink like the lede, the rest as labels (#141)", async () => {
	const output = await packedMdx(
		dir,
		"next",
		"# Flip one bit\n\nThe lede.\n\n**Start:** change one bit (2 minutes)\n\nIllustrative data\n",
	);
	const style = await inPage(output, (cdp) =>
		cdp.evaluate(`(() => {
			const masthead = [...document.querySelectorAll(".masthead > p")].map((p) => p.className);
			const next = getComputedStyle(document.querySelector(".masthead .next"));
			const lede = getComputedStyle(document.querySelector(".masthead .lede"));
			const meta = getComputedStyle(document.querySelector(".masthead .meta"));
			const body = getComputedStyle(document.body);
			return {
				masthead,
				mono: [next, meta].some((p) => p.fontFamily.includes("Mono")),
				ink: next.color === body.color && lede.color === body.color,
				text: next.fontSize === body.fontSize && lede.fontSize === body.fontSize,
				label: parseFloat(meta.fontSize) < parseFloat(body.fontSize),
			};
		})()`),
	);
	// Headline, then text, then labels: the lede and the next action share the text's size, so neither adds a level (#190).
	expect(style).toEqual({
		masthead: ["lede", "next", "meta"],
		mono: false,
		ink: true,
		text: true,
		label: true,
	});
}, 30_000);

test("a .beside figure stays in view while its text scrolls, from the column's start to .wide's end on a desktop, and stacks after the text on a phone and in print (#159, #179)", async () => {
	const text =
		"<p>Prose that explains the figure beside it, long enough to scroll past it.</p>".repeat(40);
	const page = (
		checks: Record<string, string>,
	) => `${HEAD}<p id="prose">The column.</p><div class="wide" id="wide">Wide</div><div class="beside"><div id="text">${text}</div>
<figure class="fig" id="figure"><svg viewBox="0 0 360 200"><rect width="360" height="200" /></svg></figure></div>
<div class="beside"><div>${text}</div><figure class="fig" id="narrow"><div class="mermaid">flowchart TD
	a["A"] --> b["B"]</div></figure></div>
${text}</main><script>
const box = (id) => document.getElementById(id).getBoundingClientRect();
const scrolled = (y) => { scrollTo({ top: y, behavior: "instant" }); return box("figure"); };
const mid = () => { const t = box("text"); return scrollY + t.top + t.height / 2; };
${pageContract(checks)}</script></body></html>`;
	const screen = page({
		"side by side from the column's start to .wide's end on a desktop": `innerWidth < 900 || (box("figure").left > box("text").right && Math.abs(box("text").left - box("prose").left) < 1 && Math.abs(box("figure").right - box("wide").right) < 1)`,
		"a narrow drawing starts beside its text, not centred in its share": `innerWidth < 900 || document.querySelector("#narrow svg").getBoundingClientRect().left - box("narrow").left < 20`,
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

test("on a page with a Reply bar a .beside code block still pins near the window's top, its first line shown and its last in the window (#159)", async () => {
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
			const box = pre.getBoundingClientRect();
			return { pinned: Math.round(box.top), fits: box.bottom <= innerHeight };
		})()`),
	);
	expect(placed).toEqual({ pinned: 24, fits: true });
}, 30_000);

test("links are ink with a quiet underline until a page sets --link, and faded code stays readable in both schemes", async () => {
	const page = `${HEAD}<p><a id="plain" href="#x">link</a> <a id="branded" href="#x" style="--link: var(--accent)">brand</a></p>
<pre id="pre" style="background: var(--sunken)"><code><span id="faded" data-kit-state data-state="not-yet">old line</span></code></pre>
<div id="bg" style="background: var(--sunken)">.</div></main>
<script>${CONTRAST}
const inScheme = (scheme, check) => { document.documentElement.dataset.scheme = scheme; return check(); };
// The faded text as the eye gets it: ink blended into the block's tone by the span's opacity.
const blend = () => { const [r, g, b] = colour("faded", "color").match(/[\\d.]+/g).map(Number); const [br, bg, bb] = colour("bg", "backgroundColor").match(/[\\d.]+/g).map(Number); const o = Number(colour("faded", "opacity")); return "rgb(" + [[r, br], [g, bg], [b, bb]].map(([c, d]) => c * o + d * (1 - o)).join(", ") + ")"; };
${pageContract({
	"a link is the ink colour": `colour("plain", "color") === getComputedStyle(document.body).color`,
	"a link's underline is quiet": `colour("plain", "textDecorationColor") !== colour("plain", "color") && colour("plain", "textDecorationLine") === "underline"`,
	"--link brings the accent back": `colour("branded", "color") !== colour("plain", "color")`,
	"light: faded code is readable": `inScheme("light", () => contrast(blend(), colour("bg", "backgroundColor")) >= 4.5)`,
	"dark: faded code is readable": `inScheme("dark", () => contrast(blend(), colour("bg", "backgroundColor")) >= 4.5)`,
})}</script></body></html>`;

	expect(await packAndRun(dir, "links-fade", page, { widths: [DESKTOP] })).toEqual([]);
}, 30_000);
