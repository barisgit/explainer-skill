import { afterAll, expect, test } from "bun:test";
import { pageAssertion, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const assertLater = (name: string, body: string) => pageAssertion("steps contract", name, body);

const PAGE = (
	checks: string[],
) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Steps</h1>
<figure class="fig" id="s" data-stepper data-start="1" data-labels="Nazaj,Predvajaj,Premor,Naprej,,Korak">
<svg viewBox="0 0 90 20" width="270"><rect id="a" data-step="1" width="20" height="20"/><rect id="b" data-step="2 3" x="35" width="20" height="20"/><rect id="c" data-step="3" x="70" width="20" height="20"/></svg>
<ol data-captions><li>one</li><li>two</li><li>three</li></ol></figure>
<script src="kit:steps.js"></script>
<script>
const heard = [];
document.getElementById("s").addEventListener("stepchange", (e) => heard.push(e.detail.step));
document.addEventListener("DOMContentLoaded", () => document.getElementById("s").addEventListener("stepchange", (e) => heard.push(\`dcl\${e.detail.step}\`)));
${checks.join("\n")}</script></body></html>`;

const CHECKS = [
	assertLater(
		"the opening step reaches listeners the page adds in its scripts or in DOMContentLoaded handlers",
		'heard.join() === "1,dcl1"',
	),
	assertLater(
		"an SVG part appears at its first step and is lit on each listed one",
		`["a", "b", "c"].map((id) => document.getElementById(id).getAttribute("class") ?? "").join() === "is-on is-now,,"`,
	),
	assertLater(
		"data-labels renames the controls and keeps the defaults it leaves empty",
		`document.querySelector("[data-go='1']").textContent === "Naprej" && document.querySelector("[data-play]").textContent === "Predvajaj" && document.querySelector(".player input").ariaLabel === "Korak" && document.querySelector(".player").ariaLabel === "Step controls"`,
	),
	assertLater(
		"data-go buttons step",
		`(document.querySelector('[data-go="1"]').click(), heard.filter(Number).at(-1) === 2)`,
	),
];

test("a stepper over hand-built SVG parts", async () => {
	const input = dir.write("steps.html", PAGE(CHECKS));
	const output = dir.path("steps.out.html");

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
	expect(checked.stdout).not.toContain("steps contract");
	expect(checked.code).toBe(0);
}, 60_000);
