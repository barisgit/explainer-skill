import { afterAll, expect, test } from "bun:test";
import { pageAssertion, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

const HEAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body>`;

const contract = (name: string, body: string) => pageAssertion("nav contract", name, body);

const run = async (name: string, page: string, args: string[]) => {
	const output = dir.path(`${name}.out.html`);
	const packed = await runCli(["pack", dir.write(`${name}.html`, page), "-o", output]);
	const checked = await runCli(["check", output, "--quick", "--out", dir.path(name), ...args]);
	expect(packed.code).toBe(0);
	expect(checked.stdout).not.toContain("nav contract");
	expect(checked.code).toBe(0);
};

test("a section with two folds gets Expand all, which follows the folds the reader toggles", async () => {
	const page = `${HEAD}<main class="page"><div data-overview><h1>Folds</h1>
<section id="two"><h2>Two</h2><div><details><summary>A</summary><p>a</p></details><details><summary>B</summary><p>b</p></details></div></section>
<section id="one"><h2>One</h2><details><summary>C</summary><p>c</p></details></section></div></main>
<script src="kit:views.js"></script>
<script>
const button = () => document.querySelector("#two > .fold-all");
const folds = () => [...document.querySelectorAll("#two details")];
${contract("one button before the block holding the first fold, none for a single fold", `button()?.nextElementSibling === folds()[0].parentElement && button().textContent === "Expand all" && !document.querySelector("#one .fold-all")`)}
const queue = [
	["Expand all opens every fold of its section", () => folds().every((d) => d.open) && button().textContent === "Collapse all" && button().getAttribute("aria-expanded") === "true"],
	["closing one fold by hand turns it back into Expand all", () => !folds()[0].open && button().textContent === "Expand all"],
];
document.addEventListener("click", () => {
	const [name, ok] = queue.shift() ?? [];
	setTimeout(() => { if (ok && !ok()) throw new Error("nav contract: " + name); }, 100);
});
</script></body></html>`;
	await run("folds", page, [
		"--view",
		"none",
		"--do",
		"click:#two > .fold-all",
		"--do",
		"click:#two summary",
	]);
}, 30_000);
