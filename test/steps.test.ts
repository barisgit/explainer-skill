import { afterAll, expect, test } from "bun:test";
import { runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Each contract is checked by its own delayed throw, so one failure does not hide the others; check reports them as page errors. */
const assertLater = (name: string, body: string) =>
	`setTimeout(() => { if (!(${body})) throw new Error("steps contract: ${name}"); }, 300);`;

const PAGE = (
	checks: string[],
) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><h1>Steps</h1>
<figure class="fig" id="s" data-stepper data-start="1">
<pre class="mermaid" data-steps="a:1 b:2 c:3">flowchart LR; a --> b; b --> c</pre>
<ol data-captions><li>one</li><li>two</li><li>three</li></ol></figure>
<script src="kit:steps.js"></script>
<script>${checks.join("\n")}</script></body></html>`;

const edgeSteps = (id: string) =>
	`[...document.querySelectorAll('[data-et="edge"][data-id="${id}"]')].map((e) => e.dataset.step).join()`;

const CHECKS = [
	assertLater(
		"an unmapped edge appears with its later endpoint",
		`${edgeSteps("L_a_b_0")} === "2,2" && ${edgeSteps("L_b_c_0")} === "3,3"`,
	),
];

test("a stepper in a Mermaid diagram", async () => {
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
