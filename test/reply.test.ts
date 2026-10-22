import { afterAll, expect, test } from "bun:test";
import { pageAssertion, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The page's own listeners are the only thing that updates #out, and it starts as "authored", so a restore that skips them shows. */
const PAGE = (
	script: string,
) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Keep</h1>
<p>Intro with <span data-ref="part">a part</span>.</p>
<fieldset><legend>Pick</legend><label><input type="radio" name="pick" value="a" checked> A</label> <label><input type="radio" name="pick" value="b" id="pick-b"> B</label></fieldset>
<label>Range <input type="range" id="r" min="0" max="10" value="3"></label>
<label>Name <input type="text" id="name"></label>
<label>Number <input type="number" id="num"></label>
<label>Note <textarea id="note"></textarea></label>
<label><input type="checkbox" id="cb"> Tick</label>
<select id="sel"><option value="x">X</option><option value="y">Y</option></select>
<button type="button" id="pick-y">Y by script</button> <output id="out">authored</output></main>
<script src="kit:reply.js"></script>
<script>
const $ = (id) => document.getElementById(id);
$("pick-y").addEventListener("click", () => { $("sel").value = "y"; });
const state = () => [document.querySelector('[name=pick]:checked').value, $("r").value, $("name").value, $("num").value, $("note").value, $("cb").checked, $("sel").value].join("|");
const show = () => { $("out").textContent = state(); };
document.addEventListener("input", show);
document.addEventListener("change", show);
const saved = () => Object.keys(localStorage).filter((k) => k.startsWith("explainer:")).length;
const clearButton = () => [...document.querySelectorAll(".reply-bar .btn")].find((b) => b.textContent === "Clear answers");
${script}
</script></body></html>`;

/** The reader's inputs, as check --do steps. */
const ENTER = [
	"click:#pick-b",
	"focus:#r",
	"key:ArrowRight",
	"key:ArrowRight",
	"focus:#name",
	"key:z",
	"focus:#num",
	"key:7",
	"focus:#note",
	"key:q",
	"click:#cb",
	"click:#pick-y",
	"click:[data-ref=part]",
	"click:.reply-hint",
	"key:n",
	"click:.reply-pop .btn.primary",
];
const ENTERED = "b|5|z|7|q|true|y";
const DEFAULTS = "a|3||||false|x";

const later = (name: string, body: string) => pageAssertion("keep contract", name, body);
const onLoad = (n: number, name: string, body: string) =>
	later(name, `sessionStorage.loads !== "${n}" || (${body})`);
const flow = (...extra: string[]) =>
	extra.flatMap((step) => (step === "reload" ? ["--do", "reload"] : ["--do", step]));
const run = (file: string, steps: string[]) =>
	runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
		...flow(...steps),
	]);

test("what the reader entered survives a reload, reaches the page's listeners, and one button clears it", async () => {
	const script = `
sessionStorage.loads = Number(sessionStorage.loads ?? 0) + 1;
${onLoad(1, "nothing is saved before the reader enters anything", "saved() === 0 && !clearButton() || clearButton()?.hidden")}
${onLoad(2, "the entered values are back and the page's own listener drew them", `$("out").textContent === "${ENTERED}" && state() === "${ENTERED}"`)}
${onLoad(2, "the Clear button and the note are back", `clearButton() && !clearButton().hidden && document.querySelector(".reply-bar .primary").textContent === "Reply (1)" && saved() === 1`)}
${onLoad(3, "after Clear and a reload the defaults stay and nothing is stored", `state() === "${DEFAULTS}" && saved() === 0 && clearButton().hidden`)}
document.addEventListener("click", (e) => {
	if (e.target === clearButton()) {
		setTimeout(() => { if (!(state() === "${DEFAULTS}" && $("out").textContent === "${DEFAULTS}" && saved() === 0 && clearButton().hidden && document.querySelector(".reply-bar .primary").hidden)) throw new Error("keep contract: Clear resets the controls, the display, the notes and the storage"); }, 150);
	}
});`;
	const input = dir.write("keep.html", PAGE(script));
	const output = dir.path("keep.out.html");

	const packed = await runCli(["pack", input, "-o", output]);
	const checked = await run(output, [
		...ENTER,
		"reload",
		"click:.reply-bar .btn:not(.primary)",
		"reload",
	]);

	expect(packed.code).toBe(0);
	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("a page without usable storage still works from memory", async () => {
	const blocked = `Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });`;
	const script = `
document.addEventListener("click", (e) => {
	if (e.target.id === "pick-b") setTimeout(() => { if (!(clearButton() && !clearButton().hidden)) throw new Error("keep contract: Clear is offered without storage"); }, 100);
	if (e.target === clearButton()) setTimeout(() => { if (state() !== "${DEFAULTS}") throw new Error("keep contract: Clear works without storage"); }, 100);
});`;
	const input = dir.write(
		"blocked.html",
		PAGE(script).replace("<script src", `<script>${blocked}</script><script src`),
	);
	const output = dir.path("blocked.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#pick-b", "click:.reply-bar .btn:not(.primary)"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);
