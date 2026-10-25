import { afterAll, expect, test } from "bun:test";
import { packAndRun, SETTLED, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The prose term and diagram most tests use: the cache node is linked, the api node and the edge are not. */
const DIAGRAM = `<p id="prose">The <span id="term" data-ref="cache">cache</span> answers most reads.</p>
<pre class="mermaid">flowchart LR
  api --> cache</pre>`;

/**
 * A page of `body` with the kit `scripts`; its own `script` runs once the page has settled, with helpers to hover, click and read
 * what is lit, and every ref event recorded in `events`.
 */
const PAGE = (
	script: string,
	body = DIAGRAM,
	scripts = ["link"],
) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
${body}</main>
${scripts.map((name) => `<script src="kit:${name}.js"></script>`).join("\n")}
<script>
${SETTLED}
const $ = (selector) => document.querySelector(selector);
const node = (ref) => $('svg [data-ref="' + ref + '"]');
const hover = (el) => el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const lit = () => [...document.querySelectorAll(".is-lit")].map((el) => el.id || el.dataset.ref).join();
const dimmed = () => $("svg").classList.contains("has-lit");
const inert = (el) => el.tabIndex < 0 && getComputedStyle(el).cursor !== "pointer";
const events = [];
document.addEventListener("ref", (e) => events.push(e.detail.refs.join()));
var contract = settled.then(async () => {
	const failures = [];
	const expect = (ok, name) => { if (!ok) failures.push(name); };
${script}
	return failures;
});
</script></body></html>`;

test("only a ref with a partner outside its own diagram lights, dims or takes focus", async () => {
	const script = `
	hover(node("api"));
	expect(lit() === "" && !dimmed(), "hovering a node nothing else shares lights and dims nothing");
	hover(node("L_api_cache_0"));
	expect(lit() === "" && !dimmed(), "an edge's parts in one diagram do not link each other");
	click(node("api"));
	expect(lit() === "", "a click on an unlinked node pins nothing");
	expect(inert(node("api")), "an unlinked node is neither focusable nor shows a pointer");
	expect(events.every((refs) => refs === ""), "no ref event names an unlinked ref");
	hover($("#term"));
	expect(lit() === "term,cache" && dimmed() && getComputedStyle(node("api")).opacity === "0.3", "the prose term lights its node and dims the rest");
	expect(events.at(-1) === "cache", "the ref event names the linked ref");
	hover(node("cache"));
	expect(lit() === "term,cache", "the linked node lights its term");
	expect($("#term").tabIndex === 0 && getComputedStyle($("#term")).cursor === "pointer", "a linked term is focusable and shows a pointer");
	hover($("main"));
	expect(lit() === "" && !dimmed(), "leaving the parts clears the highlight");`;
	expect(await packAndRun(dir, "partners", PAGE(script))).toEqual([]);
}, 30_000);

test("a partner a page script writes after load links its ref, and removing it unlinks the ref", async () => {
	const script = `
	$("#prose").insertAdjacentHTML("beforeend", ' Every read passes the <span id="late" data-ref="api">api</span>, <span id="lone" data-ref="db">not the db</span>.');
	await Promise.resolve();
	hover($("#lone"));
	expect(lit() === "" && inert($("#lone")) && getComputedStyle($("#lone")).textDecorationLine === "none", "a written term nothing shares stays plain text");
	hover(node("api"));
	expect(lit() === "late,api" && dimmed(), "the written term links the node it shares a ref with");
	expect($("#late").tabIndex === 0, "the written term is focusable");
	hover($("main"));
	$("#late").remove();
	await Promise.resolve();
	hover(node("api"));
	expect(lit() === "" && !dimmed(), "with its partner gone the node lights nothing");`;
	expect(await packAndRun(dir, "late", PAGE(script))).toEqual([]);
}, 30_000);

test("an unlinked part inside a linked one does not activate it", async () => {
	const body = `<p>The <span data-ref="cache">cache</span>.</p>
<svg viewBox="0 0 100 20"><g id="g" data-ref="cache"><rect id="box" width="40" height="20"/><text id="child" data-ref="lone" x="50" y="15">lone</text></g></svg>`;
	const script = `
	hover($("#child"));
	expect(lit() === "", "hovering an unlinked child lights nothing");
	click($("#child"));
	hover($("main"));
	expect(lit() === "", "clicking an unlinked child pins nothing");
	hover($("#box"));
	expect(lit() === "cache,g", "a child with no ref of its own still activates its linked part");`;
	expect(await packAndRun(dir, "child", PAGE(script, body))).toEqual([]);
}, 30_000);
