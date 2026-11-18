import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, scratch } from "./support.ts";

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
