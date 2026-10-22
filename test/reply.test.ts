import { afterAll, expect, test } from "bun:test";
import { pageAssertion, runCli, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Helpers every test page carries: element lookup, saved-state count, the Clear and Reply buttons. */
const COMMON = `
const $ = (id) => document.getElementById(id);
const saved = () => Object.keys(localStorage).filter((k) => k.startsWith("explainer:")).length;
const clearButton = () => document.querySelector(".reply-bar .btn:not(.primary)");
const replyButton = () => document.querySelector(".reply-bar .primary");
sessionStorage.loads = Number(sessionStorage.loads ?? 0) + 1;`;

/** A small page: \`body\` inside <main>, then reply.js, then the helpers and \`script\`. */
const SMALL = (body: string, script: string) =>
	`<!doctype html><html><head><link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Small</h1>${body}</main>
<script src="kit:reply.js"></script><script>${COMMON}
${script}</script></body></html>`;

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
${COMMON}
$("pick-y").addEventListener("click", () => { $("sel").value = "y"; });
const state = () => [document.querySelector('[name=pick]:checked').value, $("r").value, $("name").value, $("num").value, $("note").value, $("cb").checked, $("sel").value].join("|");
const show = () => { $("out").textContent = state(); };
document.addEventListener("input", show);
document.addEventListener("change", show);
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
const run = (file: string, steps: string[]) =>
	runCli([
		"check",
		file,
		"--quick",
		"--view",
		"none",
		"--out",
		dir.path("shots"),
		...steps.flatMap((step) => ["--do", step]),
	]);

test("what the reader entered survives a reload, reaches the page's listeners, and one button clears it", async () => {
	const script = `
${onLoad(1, "nothing is saved before the reader enters anything", "saved() === 0 && clearButton().hidden")}
${onLoad(2, "the entered values are back and the page's own listener drew them", `$("out").textContent === "${ENTERED}" && state() === "${ENTERED}"`)}
${onLoad(2, "the Clear button and the note are back", `clearButton() && !clearButton().hidden && clearButton().textContent === "Clear answers and notes" && replyButton().textContent === "Reply (1)" && saved() === 1`)}
${onLoad(3, "after Clear and a reload the defaults stay and nothing is stored", `state() === "${DEFAULTS}" && saved() === 0 && clearButton().hidden`)}
document.addEventListener("click", (e) => {
	if (e.target === clearButton()) {
		setTimeout(() => { if (!(state() === "${DEFAULTS}" && $("out").textContent === "${DEFAULTS}" && saved() === 0 && clearButton().hidden && replyButton().hidden)) throw new Error("keep contract: Clear resets the controls, the display, the notes and the storage"); }, 150);
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

test("a control the page rebuilds after load stops counting: nothing of it is kept and Clear is not offered for it", async () => {
	const script = `
document.querySelector("main").insertAdjacentHTML("beforeend", '<button type="button" id="rebuild">Rebuild</button>');
$("rebuild").addEventListener("click", () => { $("name").replaceWith(Object.assign(document.createElement("input"), { id: "name", type: "text" })); });
document.addEventListener("click", (e) => {
	if (e.target.id === "rebuild") setTimeout(() => { if (!(clearButton().hidden && saved() === 0)) throw new Error("keep contract: a rebuilt control leaves nothing kept"); }, 150);
});`;
	const input = dir.write("rebuilt.html", PAGE(script));
	const output = dir.path("rebuilt.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["focus:#name", "key:z", "click:#rebuild"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("saved values are dropped when the regenerated page has other controls, so none lands on a control that took the old one's position", async () => {
	const script = `
sessionStorage.loads = Number(sessionStorage.loads ?? 0) + 1;
if (sessionStorage.loads === "2") document.querySelector("main").insertAdjacentHTML("afterbegin", '<input type="text" aria-label="New">');`;
	const html = `<!doctype html><html><head><link rel="stylesheet" href="kit:theme.css"></head><body><main><h1>Layout</h1>
<input type="text" aria-label="Old"></main><script>${script}</script><script src="kit:reply.js"></script>
<script>${onLoad(2, "the control that now holds the old one's position stays empty", `document.querySelector("[aria-label=New]").value === ""`)}</script></body></html>`;
	const input = dir.write("layout.html", html);
	const output = dir.path("layout.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["focus:[aria-label=Old]", "key:z", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("a control the page adds after load is kept and restored when it appears again; one the page replaces keeps counting", async () => {
	const script = `
const main = document.querySelector("main");
main.insertAdjacentHTML("beforeend", '<button type="button" id="add">Add</button> <button type="button" id="carry">Carry</button>');
$("add").addEventListener("click", () => main.insertAdjacentHTML("beforeend", '<label>Late <input type="text" id="late"></label>'));
$("carry").addEventListener("click", () => { const v = $("name").value; $("name").replaceWith(Object.assign(document.createElement("input"), { id: "name", type: "text", value: v })); });
const fail = (what) => { throw new Error("keep contract: " + what); };
document.addEventListener("input", (e) => {
	if (e.target.id === "late" && sessionStorage.loads === "1") setTimeout(() => { if (clearButton().hidden || saved() !== 1) fail("a late control is kept"); }, 150);
});
document.addEventListener("click", (e) => {
	if (e.target.id === "carry") setTimeout(() => { if (clearButton().hidden || saved() !== 1) fail("a replaced control keeps its value"); }, 150);
	if (e.target.id === "add" && sessionStorage.loads === "2") setTimeout(() => { if ($("late").value !== "z" || clearButton().hidden) fail("a late control gets its saved value"); }, 150);
});
${onLoad(2, "a value waiting for a control that has not appeared is kept", "saved() === 1 && !clearButton().hidden")}`;
	const input = dir.write("late.html", PAGE(script));
	const output = dir.path("late.out.html");

	await runCli(["pack", input, "-o", output]);
	const added = await run(output, ["click:#add", "focus:#late", "key:z", "reload", "click:#add"]);
	const replaced = await run(output, ["focus:#name", "key:z", "click:#carry"]);

	expect(added.stdout).not.toContain("keep contract");
	expect(added.code).toBe(0);
	expect(replaced.stdout).not.toContain("keep contract");
	expect(replaced.code).toBe(0);
}, 90_000);

test("restore waits for the page's own load handlers, so an init that runs later does not overwrite it", async () => {
	const script = `
addEventListener("load", () => { $("name").value = ""; $("out").textContent = state(); });
${onLoad(2, "the saved value survives a later load handler and the page's listener drew it", `$("name").value === "z" && $("out").textContent.split("|")[2] === "z" && saved() === 1`)}`;
	const input = dir.write("late-init.html", PAGE(script));
	const output = dir.path("late-init.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["focus:#name", "key:z", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("reply.js started after the page has loaded still restores", async () => {
	const body = `<label>Name <input type="text" id="name"></label><script type="text/plain" src="kit:reply.js"></script>`;
	const script = `
addEventListener("load", () => { const s = document.createElement("script"); s.textContent = document.querySelector("script[type='text/plain']").textContent; document.body.append(s); });
${later("a value saved before is back", `sessionStorage.loads !== "2" || $("name").value === "z"`)}`;
	const html = SMALL(body, script).replace('<script src="kit:reply.js"></script>', "");
	const input = dir.write("started-late.html", html);
	const output = dir.path("started-late.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["focus:#name", "key:z", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("an answer equal to the default is still an answer after a reload", async () => {
	const body = `<fieldset data-reply><legend>Which?</legend><label><input type="radio" name="w" value="a" id="ra" checked> A</label> <label><input type="radio" name="w" value="b" id="rb"> B</label></fieldset>`;
	const script = onLoad(
		2,
		"the chosen default still counts",
		`replyButton().textContent === "Reply (1)" && !clearButton().hidden`,
	);
	const input = dir.write("explicit.html", SMALL(body, script));
	const output = dir.path("explicit.out.html");

	await runCli(["pack", input, "-o", output]);
	const preselected = await run(output, ["click:#ra", "reload"]);
	const changedBack = await run(output, ["click:#rb", "click:#ra", "reload"]);

	expect(preselected.stdout).not.toContain("keep contract");
	expect(preselected.code).toBe(0);
	expect(changedBack.stdout).not.toContain("keep contract");
	expect(changedBack.code).toBe(0);
}, 90_000);

test("two forms with the same radio names are kept apart", async () => {
	const form = (id: string, b: string) =>
		`<form id="${id}"><input type="radio" name="s" value="a" checked> <input type="radio" name="s" value="b"${b}></form>`;
	const script = onLoad(
		2,
		"each form has its own choice",
		`document.querySelector("#f1 :checked")?.value === "b" && document.querySelector("#f2 :checked")?.value === "a"`,
	);
	const input = dir.write("forms.html", SMALL(form("f1", ' id="b1"') + form("f2", ""), script));
	const output = dir.path("forms.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#b1", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("Clear on a radio group that starts with no choice tells the page nothing is chosen", async () => {
	const body = `<fieldset data-reply><legend>Which?</legend><label><input type="radio" name="w" value="p"> P</label> <label><input type="radio" name="w" value="q" id="q"> Q</label></fieldset><output id="out">none</output>`;
	const script = `
document.addEventListener("change", () => { $("out").textContent = document.querySelector(":checked")?.value ?? "none"; });
document.addEventListener("click", (e) => {
	if (e.target === clearButton()) setTimeout(() => { if ($("out").textContent !== "none") throw new Error("keep contract: Clear tells the page"); }, 150);
});`;
	const input = dir.write("none.html", SMALL(body, script));
	const output = dir.path("none.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#q", "click:.reply-bar .btn:not(.primary)"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("restoring one control that makes the page rebuild another does not lose the rebuilt one's answer", async () => {
	const body = `<fieldset><legend>Country</legend><label><input type="radio" name="c" value="us" id="us" checked> US</label> <label><input type="radio" name="c" value="si" id="si"> SI</label></fieldset>
<label>City <input type="text" id="city"></label>`;
	const script = `
document.addEventListener("change", (e) => {
	if (e.target.name === "c") $("city").replaceWith(Object.assign(document.createElement("input"), { id: "city", type: "text" }));
});
const keptKeys = () => Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("explainer:"))) ?? '{"controls":{}}').controls);
${onLoad(2, "the rebuilt city got its answer and it is still saved", `$("si").checked && $("city").value === "r" && keptKeys().includes("#city")`)}`;
	const input = dir.write("dependent.html", SMALL(body, script));
	const output = dir.path("dependent.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#si", "focus:#city", "key:r", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("a saved value is judged by the control's own label, not its fieldset's", async () => {
	const body = `<fieldset><legend>Contact</legend><label>Email <input type="text"></label></fieldset>`;
	const script = `
if (sessionStorage.loads === "2") document.querySelector("fieldset").insertAdjacentHTML("afterbegin", '<label>Name <input type="text"></label>');
${onLoad(2, "the saved email is not put into the new Name field", `document.querySelector("fieldset input").value === ""`)}`;
	const input = dir.write("contact.html", SMALL(body, script));
	const output = dir.path("contact.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["focus:input", "key:z", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("answers waiting for a panel that is not shown yet can be cleared, and stay cleared when it appears", async () => {
	const body = `<button type="button" id="add">Add</button>`;
	const script = `
document.getElementById("add").addEventListener("click", () => document.querySelector("main").insertAdjacentHTML("beforeend", '<label>Late <input type="text" id="late"></label>'));
document.addEventListener("click", (e) => {
	if (e.target.id === "add" && sessionStorage.loads === "2") setTimeout(() => { if ($("late").value !== "" || saved() !== 0) throw new Error("keep contract: cleared answers stay cleared"); }, 150);
});
${onLoad(2, "Clear is offered for answers that wait for their panel", `!clearButton().hidden`)}`;
	const input = dir.write("waiting.html", SMALL(body, script));
	const output = dir.path("waiting.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, [
		"click:#add",
		"focus:#late",
		"key:z",
		"reload",
		"click:.reply-bar .btn:not(.primary)",
		"click:#add",
	]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("a field the page rebuilds under the same id as a different field does not receive the old field's answer", async () => {
	const body = `<fieldset><legend>Country</legend><label><input type="radio" name="c" value="us" id="us" checked> US</label> <label><input type="radio" name="c" value="si" id="si"> SI</label></fieldset>
<label>City <input type="text" id="city"></label>`;
	const script = `
document.addEventListener("change", (e) => {
	if (e.target.name === "c" && sessionStorage.loads !== "1") $("city").closest("label").outerHTML = '<label>Postal code <input type="text" id="city"></label>';
});
${onLoad(2, "the postal code field starts empty and no city answer waits for it", `$("city").closest("label").textContent.includes("Postal") && $("city").value === "" && saved() === 1 && !localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("explainer:"))).includes("#city")`)}`;
	const input = dir.write("renamed.html", SMALL(body, script));
	const output = dir.path("renamed.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["focus:#city", "key:r", "click:#si", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);
