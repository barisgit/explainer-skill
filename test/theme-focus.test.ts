import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);
const HEAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="kit:theme.css"></head><body><main class="page">`;

test("contents links keep their focus outline inside the rail's scroll clips", async () => {
	const page = `${HEAD}<nav class="toc is-open"><button class="toc-toggle" aria-expanded="true">Contents</button><ol>${Array.from({ length: 40 }, (_, i) => `<li><a href="#s${i}">Section ${i}</a></li>`).join("")}</ol></nav></main><script>
${pageContract({
	"keyboard focus is visible and not clipped": `(() => {
			const links = document.querySelectorAll(".toc a");
			return [links[0], links[links.length - 1]].every(link => {
				link.focus();
				const style = getComputedStyle(link);
				if (!link.matches(":focus-visible") || style.outlineStyle === "none") return false;
				const edge = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
				const box = link.getBoundingClientRect();
				for (let parent = link.parentElement; parent; parent = parent.parentElement) {
					const clip = getComputedStyle(parent);
					const bounds = parent.getBoundingClientRect();
					if (clip.overflowX !== "visible" && (box.left - edge < bounds.left - 1 || box.right + edge > bounds.right + 1)) return false;
					if (clip.overflowY !== "visible" && (box.top - edge < bounds.top - 1 || box.bottom + edge > bounds.bottom + 1)) return false;
				}
				return true;
			});
		})()`,
})}</script></body></html>`;
	expect(await packAndRun(dir, "rail-focus", page)).toEqual([]);
}, 30_000);
