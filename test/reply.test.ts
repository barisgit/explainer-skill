import { afterAll, expect, test } from "bun:test";
import { packAndRun, pageAssertion, pageContract, runCli, SETTLED, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Helpers every test page carries: element lookup, saved-state count, the Clear and Reply buttons. */
const COMMON = `
const $ = (id) => document.getElementById(id);
const saved = () => Object.keys(localStorage).filter((k) => k.startsWith("explainer:")).length;
const clearButton = () => document.querySelector(".reply-bar .btn:not(.primary)");
const replyButton = () => document.querySelector(".reply-bar .primary");
const armed = () => clearButton().classList.contains("is-armed");
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

/** Clear asks for confirmation first, so the reader clicks it twice. */
const CLEAR = ["click:.reply-bar .btn:not(.primary)", "click:.reply-bar .btn:not(.primary)"];

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
	if (e.target === clearButton() && !armed()) {
		setTimeout(() => { if (!(state() === "${DEFAULTS}" && $("out").textContent === "${DEFAULTS}" && saved() === 0 && clearButton().hidden && replyButton().hidden)) throw new Error("keep contract: Clear resets the controls, the display, the notes and the storage"); }, 150);
	}
});`;
	const input = dir.write("keep.html", PAGE(script));
	const output = dir.path("keep.out.html");

	const packed = await runCli(["pack", input, "-o", output]);
	const checked = await run(output, [...ENTER, "reload", ...CLEAR, "reload"]);

	expect(packed.code).toBe(0);
	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

/** A page with one answered radio group; `script` gets `answer()`, the chosen value, and `probe(...checks)`. */
const CONFIRM_BODY = `<fieldset data-reply><legend>Pick</legend><label><input type="radio" name="p" value="a" checked> A</label> <label><input type="radio" name="p" value="b" id="b"> B</label></fieldset><input type="text" id="name" aria-label="Name">`;

/**
 * Runs the next check 100 ms after each Clear click, Escape press or other click, in order, so a --do sequence can assert after
 * every step. A failed check throws "confirm contract: <name>".
 */
const CONFIRM_PROBE = `
const answer = () => document.querySelector("[name=p]:checked").value;
let width = 0;
document.addEventListener("click", (e) => { if (e.target === clearButton()) width = clearButton().getBoundingClientRect().width; }, true);
const queue = [];
const probe = (...checks) => queue.push(...checks);
const next = () => { const [name, ok] = queue.shift() ?? []; setTimeout(() => { if (ok && !ok()) throw new Error("confirm contract: " + name); }, 100); };
document.addEventListener("click", next);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") next(); });
const asking = () => armed() && clearButton().textContent === "Clear everything?" && !clearButton().hidden;
const idle = () => !armed() && clearButton().textContent === "Clear answers and notes";
const kept = () => answer() === "b" && !clearButton().hidden;`;

test("Clear asks first: one click keeps the answers and turns red in place, a second clears", async () => {
	const script = `${CONFIRM_PROBE}
probe(["answering", () => answer() === "b"],
	["first click asks", () => asking() && kept() && clearButton().getBoundingClientRect().width === width && getComputedStyle(clearButton()).backgroundColor !== getComputedStyle(replyButton()).backgroundColor && document.querySelector(".reply-bar [role=status]").textContent !== ""],
	["second click clears", () => answer() === "a" && clearButton().hidden && saved() === 0]);`;
	const input = dir.write("confirm.html", SMALL(CONFIRM_BODY, script));
	const output = dir.path("confirm.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#b", ...CLEAR]);

	expect(checked.stdout).not.toContain("confirm contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("Clear confirms from the keyboard, and Escape or leaving the button cancels without clearing", async () => {
	const script = `${CONFIRM_PROBE}
probe(["answering", () => answer() === "b"],
	["Enter asks", () => asking() && kept()],
	["Escape cancels", () => idle() && kept()],
	["Enter asks again", () => asking() && kept()],
	["leaving the button cancels", () => idle() && kept()],
	["Enter asks once more", () => asking() && kept()],
	["Enter again clears", () => answer() === "a" && clearButton().hidden]);`;
	const input = dir.write("confirm-keys.html", SMALL(CONFIRM_BODY, script));
	const output = dir.path("confirm-keys.out.html");
	const button = ".reply-bar .btn:not(.primary)";

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, [
		"click:#b",
		`focus:${button}`,
		"key:Enter",
		"key:Escape",
		"key:Enter",
		"click:#name",
		`focus:${button}`,
		"key:Enter",
		"key:Enter",
	]);

	expect(checked.stdout).not.toContain("confirm contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("an unconfirmed Clear cancels itself after about four seconds", async () => {
	// The page holds back the kit's timer so the test neither sleeps nor races: it records the delay and fires the callback by hand.
	// The last step clicks the heading, which is not focusable, so only the timer can cancel.
	const hold = `<script>const waiting = []; const realSetTimeout = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => ms >= 3000 && ms <= 5000 ? waiting.push([fn, ms]) : realSetTimeout(fn, ms, ...rest);</script>`;
	const script = `${CONFIRM_PROBE}
probe(["answering", () => answer() === "b"],
	["the first click starts a timer of about four seconds", () => asking() && waiting.length === 1 && waiting[0][1] >= 3500 && waiting[0][1] <= 4500],
	["the timer cancels", () => { waiting[0][0](); return idle() && kept(); }]);`;
	const input = dir.write(
		"confirm-timeout.html",
		SMALL(CONFIRM_BODY, script).replace("<script src", `${hold}<script src`),
	);
	const output = dir.path("confirm-timeout.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#b", CLEAR[0] as string, "click:h1"]);

	expect(checked.stdout).not.toContain("confirm contract");
	expect(checked.code).toBe(0);
}, 60_000);

test("a page without usable storage still works from memory", async () => {
	const blocked = `Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });`;
	const script = `
document.addEventListener("click", (e) => {
	if (e.target.id === "pick-b") setTimeout(() => { if (!(clearButton() && !clearButton().hidden)) throw new Error("keep contract: Clear is offered without storage"); }, 100);
	if (e.target === clearButton() && !armed()) setTimeout(() => { if (state() !== "${DEFAULTS}") throw new Error("keep contract: Clear works without storage"); }, 100);
});`;
	const input = dir.write(
		"blocked.html",
		PAGE(script).replace("<script src", `<script>${blocked}</script><script src`),
	);
	const output = dir.path("blocked.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#pick-b", ...CLEAR]);

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
	if (e.target === clearButton() && !armed()) setTimeout(() => { if ($("out").textContent !== "none") throw new Error("keep contract: Clear tells the page"); }, 150);
});`;
	const input = dir.write("none.html", SMALL(body, script));
	const output = dir.path("none.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["click:#q", ...CLEAR]);

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

test("an input with the multiple attribute is kept like any text field", async () => {
	const body = `<label>Emails <input type="email" id="em" multiple></label>`;
	const script = onLoad(2, "the typed address is back", `$("em").value === "a"`);
	const input = dir.write("multiple.html", SMALL(body, script));
	const output = dir.path("multiple.out.html");

	await runCli(["pack", input, "-o", output]);
	const checked = await run(output, ["focus:#em", "key:a", "reload"]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.stdout).not.toContain("page error");
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
		...CLEAR,
		"click:#add",
	]);

	expect(checked.stdout).not.toContain("keep contract");
	expect(checked.code).toBe(0);
}, 60_000);

/** Rows of a table filling the column, so a control in a corner of the window would sit on them. */
const ROWS = Array.from(
	{ length: 12 },
	(_, i) =>
		`<tr><th>Option ${i + 1}</th><td style="text-align: right">${(i + 1) * 125} ms</td></tr>`,
).join("");
const PROSE = Array.from(
	{ length: 8 },
	(_, i) =>
		`<p>Paragraph ${i + 1} runs the full measure of the column, so it reaches the right edge on a phone and on a desktop.</p>`,
).join("");

/**
 * Geometry of the reply bar, in page script. `ownsRow`: every point across the bar's middle row hits the bar, so content can pass only
 * under all of it, as under the window's edge, never beside a control that hides part of it. `coversNothing`: no content box meets it.
 */
const BAR_GEOMETRY = `
const bar = () => document.querySelector(".reply-bar");
const box = () => bar().getBoundingClientRect();
const at = (top) => (scrollTo({ top, behavior: "instant" }), true);
const inView = () => box().top >= 0 && box().bottom <= innerHeight + 0.5 && box().height > 0;
const opaque = () => /^rgb\\(/.test(getComputedStyle(bar()).backgroundColor);
const ownsRow = () => {
	const y = (box().top + box().bottom) / 2;
	for (let x = 1; x < document.documentElement.clientWidth; x += 8) {
		if (!bar().contains(document.elementFromPoint(x, y))) return false;
	}
	return true;
};
const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const coversNothing = () => [...document.querySelectorAll("main *")].every((el) => !meets(el.getBoundingClientRect(), box()));
const end = () => document.documentElement.scrollHeight - innerHeight;`;

/** A tall page whose first box is a full-width table; `question` adds a data-reply question, so the Reply button shows from the start. */
const BAR_PAGE = (question: boolean, script: string) =>
	`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main><table class="compare">${ROWS}</table><h1>Bar</h1>${PROSE}
${question ? `<fieldset data-reply><legend>Pick</legend><label><input type="radio" name="p" value="a" checked> A</label> <label><input type="radio" name="p" value="b" id="b"> B</label></fieldset>` : ""}
<input id="late" aria-label="Late">${PROSE}<table class="compare">${ROWS}</table></main>
<script src="kit:reply.js"></script><script>${BAR_GEOMETRY}
${script}</script></body></html>`;

test("the reply bar never covers content: at the top nothing is under it, and scrolled it stays in view with the count and content passes only under all of it", async () => {
	const contract = pageContract({
		"an answer shows the count and Clear": `(document.getElementById("b").click(), bar().textContent.includes("Reply (1)") && bar().querySelectorAll(".btn:not([hidden])").length === 2)`,
		"at the top the bar is in view, opaque and covers nothing":
			"at(0) && inView() && opaque() && ownsRow() && coversNothing()",
		"half way down the bar is in view and owns its row": "at(end() / 2) && inView() && ownsRow()",
		"a control focused under the bar scrolls clear of it": `(() => {
			const late = document.getElementById("late");
			at(late.getBoundingClientRect().top + scrollY - box().top - 4);
			late.focus();
			return late.getBoundingClientRect().top >= box().bottom;
		})()`,
		"at the end the bar is in view and owns its row": "at(end()) && inView() && ownsRow()",
	});
	expect(await packAndRun(dir, "bar", BAR_PAGE(true, contract))).toEqual([]);
}, 60_000);

test("the reply bar appearing on a reader's first input does not move the page under the reader", async () => {
	const contract = `${SETTLED}
var contract = settled.then(async () => {
	const late = document.getElementById("late");
	const before = late.getBoundingClientRect().top;
	const hidden = bar().hidden;
	late.value = "typed";
	late.dispatchEvent(new Event("input", { bubbles: true }));
	await new Promise((tick) => setTimeout(tick));
	await new Promise(requestAnimationFrame);
	return hidden && !bar().hidden && late.getBoundingClientRect().top === before ? [] : ["the page moved as the bar appeared"];
});`;
	expect(await packAndRun(dir, "bar-keep", BAR_PAGE(false, contract))).toEqual([]);
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
