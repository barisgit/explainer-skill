import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageContract, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The class of each SVG part a, b and c, joined: "is-on" once it has appeared, "is-now" on a step it lists. */
const PART_CLASSES = `["a", "b", "c"].map((id) => document.getElementById(id).getAttribute("class") ?? "").join()`;

const PAGE = (
	checks: string,
) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Steps</h1>
<figure class="fig" id="s" data-stepper data-start="1">
<svg viewBox="0 0 90 20" width="270"><rect id="a" data-step="1" width="20" height="20"/><rect id="b" data-step="2 3" x="35" width="20" height="20"/><rect id="c" data-step="3" x="70" width="20" height="20"/></svg>
<ol data-captions><li>one</li><li>two</li><li>three</li></ol></figure>
<figure class="fig" data-stepper data-labels="Nazaj"><p data-step="1">x</p><p data-step="2">y</p></figure>
<script src="kit:steps.js"></script>
<script>
const heard = [];
document.getElementById("s").addEventListener("stepchange", (e) => heard.push(e.detail.step));
document.addEventListener("DOMContentLoaded", () => document.getElementById("s").addEventListener("stepchange", (e) => heard.push(\`dcl\${e.detail.step}\`)));
${checks}</script></body></html>`;

const CHECKS = pageContract({
	"the opening step reaches listeners the page adds in its scripts or in DOMContentLoaded handlers":
		'heard.join() === "1,dcl1"',
	"on the opening step only the part listing step 1 is shown and lit": `${PART_CLASSES} === "is-on is-now,,"`,
	"data-go buttons step: an earlier part stays shown, unlit, and a part listing steps 2 and 3 appears at 2": `(document.querySelector('[data-go="1"]').click(), heard.filter(Number).at(-1) === 2 && ${PART_CLASSES} === "is-on,is-on is-now,")`,
});

test("a stepper over hand-built SVG parts", async () => {
	expect(await packAndRun(dir, "steps", PAGE(CHECKS))).toEqual([]);
}, 30_000);

test("a stepper that still has v0.7.0's data-labels hears it through check", async () => {
	const input = dir.write("legacy.html", PAGE(""));
	const output = dir.path("legacy.out.html");

	const packed = await runCli(["pack", input, "-o", output]);
	const checked = await runCli([
		"check",
		output,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
	]);

	expect(packed.code).toBe(0);
	expect(checked.stdout).toContain("kit:steps.js: data-labels is no longer read");
	expect(checked.code).toBe(0);
}, 60_000);
