import { afterAll, beforeAll, expect, test } from "bun:test";
import { inPage, packAndRun, pageContract, runCli, scratch, WIDTHS } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const HEAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="kit:theme.css"></head><body><main class="page">`;

test("unbroken prose wraps within its column without changing code or hyphenation", async () => {
	const word = `https://example.org/${"unbroken".repeat(24)}`;
	const page = `${HEAD}<p data-wrap><a href="https://example.org">${word}</a></p><p data-wrap>${word}</p><ul><li data-wrap>${word}</li></ul><table style="width:100%;table-layout:fixed"><tr><td data-wrap>${word}</td></tr></table><figure><figcaption data-wrap>${word}</figcaption></figure><aside class="note" data-wrap>${word}</aside><pre><code>${word}</code></pre></main><script>
${pageContract({
	"prose stays inside each box": `[...document.querySelectorAll("[data-wrap]")].every(el => { const range = document.createRange(); range.selectNodeContents(el); const box = el.getBoundingClientRect(); return [...range.getClientRects()].every(r => r.left >= box.left - 1 && r.right <= box.right + 1); })`,
	"the viewport does not scroll sideways": `document.documentElement.scrollWidth <= innerWidth`,
	"normal hyphenation stays manual": `getComputedStyle(document.querySelector("p")).hyphens === "manual"`,
	"desktop code still scrolls": `innerWidth <= 640 || (getComputedStyle(document.querySelector("pre")).whiteSpace === "pre" && document.querySelector("pre").scrollWidth > document.querySelector("pre").clientWidth)`,
})}</script></body></html>`;
	expect(
		await packAndRun(dir, "prose-wrap", page, {
			widths: [390, 700, 1000, 1440].map((width) => ({ width, height: 900, mobile: false })),
		}),
	).toEqual([]);
}, 30_000);

const figureLayout = dir.path("figure-layout.html");
beforeAll(async () => {
	const result = await runCli([
		"pack",
		`${import.meta.dir}/fixtures/figure-layout/page.mdx`,
		"-o",
		figureLayout,
	]);
	expect(result.stderr).toBe("");
	expect(result.code).toBe(0);
});

test("figure images fit their columns without stretching (#317)", async () => {
	for (const viewport of WIDTHS) {
		const { images, overflow, position } = await inPage(
			figureLayout,
			(cdp) =>
				cdp.evaluate<{
					images: { id: string; width: number; height: number; column: number }[];
					overflow: number;
					position: string;
				}>(`(() => ({
			images: [...document.querySelectorAll("#single, #sized, #prose-figure, #beside-figure")].map(figure => {
				const { width, height } = figure.querySelector("img").getBoundingClientRect();
				return { id: figure.id, width, height, column: figure.getBoundingClientRect().width };
			}),
			overflow: document.documentElement.scrollWidth - innerWidth,
			position: getComputedStyle(document.querySelector("#beside-figure")).position,
		}))()`),
			viewport,
		);
		expect(images).toHaveLength(4);
		for (const { id, width, height, column } of images) {
			expect(Math.abs(width - Math.min(540, column)), id).toBeLessThan(1);
			expect(width / height, id).toBeCloseTo(3);
		}
		expect(overflow).toBe(0);
		expect(position).toBe(viewport.mobile ? "static" : "sticky");
	}
}, 30_000);

test("plain figures leave only hairlines in a split and keep prose spacing (#320)", async () => {
	for (const viewport of WIDTHS) {
		const spacing = await inPage(
			figureLayout,
			(cdp) =>
				cdp.evaluate(`(() => {
			const split = document.querySelector("#pair");
			const style = getComputedStyle(split);
			const blockMargins = (el) => {
				const { marginBlockStart, marginBlockEnd } = getComputedStyle(el);
				return [marginBlockStart, marginBlockEnd];
			};
			return {
				columns: Array.from(split.children, blockMargins),
				hairlines: [style.borderBlockStartWidth, style.gap, style.borderBlockEndWidth],
				prose: blockMargins(document.querySelector("#prose-figure")),
			};
		})()`),
			viewport,
		);
		expect(spacing).toEqual({
			columns: [
				["0px", "0px"],
				["0px", "0px"],
			],
			hairlines: ["1px", "1px", "1px"],
			prose: ["32px", "32px"],
		});
	}
}, 30_000);
