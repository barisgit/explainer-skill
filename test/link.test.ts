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

test("HTML in one SVG is one place, and a nested SVG dims as part of the outermost", async () => {
	const body = `<p>The <span data-ref="nest">nested part</span>.</p>
<svg id="outer" viewBox="0 0 200 40"><foreignObject width="100" height="40"><span id="fa" data-ref="fo">a</span> <span id="fb" data-ref="fo">b</span></foreignObject>
<svg id="inner" x="120" width="40" height="40"><rect data-ref="nest" width="40" height="40"/></svg></svg>`;
	const script = `
	hover($("#fa"));
	expect(lit() === "" && !$("#fa").classList.contains("is-linked"), "two labels in one SVG's foreignObject do not link");
	hover($("main span"));
	expect($("#outer").classList.contains("has-lit") && !$("#inner").classList.contains("has-lit"), "the outermost SVG holds the dimming");
	expect(getComputedStyle($("#fa")).opacity === "0.3", "the rest of the outermost SVG dims");`;
	expect(await packAndRun(dir, "foreign", PAGE(script, body))).toEqual([]);
}, 30_000);

test("a pin ends when its ref stops linking and does not come back with the partner", async () => {
	const body = `<p><span id="p1" data-ref="pair">one</span> and <span id="p2" data-ref="pair">two</span>.</p>`;
	const script = `
	click($("#p1"));
	hover($("main"));
	expect(lit() === "p1,p2", "a click pins the pair");
	const partner = $("#p2");
	partner.remove();
	await Promise.resolve();
	expect(lit() === "", "with the partner gone nothing is lit");
	$("p").append(partner);
	await Promise.resolve();
	expect(lit() === "", "the partner's return does not bring back the pin");
	click($("#p1"));
	expect(lit() === "p1,p2", "a new click pins again");`;
	expect(await packAndRun(dir, "pin", PAGE(script, body))).toEqual([]);
}, 30_000);

test("the light and dark copies of an SVG file are one place", async () => {
	dir.write(
		"twin.svg",
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
	);
	const body = `<img src="twin.svg" alt="alone" data-ref="alone" width="40"> <img src="twin.svg" alt="named" data-ref="named" width="40">
<p>The <span id="name" data-ref="named">named drawing</span>.</p>`;
	const script = `
	const copies = (ref) => [...document.querySelectorAll('img[data-ref="' + ref + '"]')];
	expect(copies("alone").length === 2 && copies("alone").every((img) => !img.classList.contains("is-linked")), "an image's two copies do not link each other");
	hover($("#name"));
	expect(copies("named").every((img) => img.classList.contains("is-lit")), "a term lights both copies of its image");`;
	expect(await packAndRun(dir, "twin", PAGE(script, body))).toEqual([]);
}, 30_000);

/** Focuses `el` and presses Enter on it, as a keyboard reader asks for a note; true when the note editor opened. */
const NOTE_BY_KEY = `const noteByKey = (el) => {
		el.focus();
		const focused = document.activeElement === el;
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		const opened = $(".reply-pop") !== null;
		$(".reply-pop .btn:not(.primary)")?.click();
		return focused && opened;
	};
	const underlined = (el) => getComputedStyle(el).textDecorationLine === "underline";`;

test("with kit:reply.js an unlinked ref stays a note target without becoming a link", async () => {
	const body = `${DIAGRAM}<p>Only the <span id="lone" data-ref="lone">lone part</span> takes a note.</p>`;
	const script = `${NOTE_BY_KEY}
	expect(noteByKey($("#lone")), "Enter on the focused unlinked ref opens its note");
	expect(noteByKey($("#term")), "Enter on a linked term opens its note too");
	hover($("#lone"));
	click($("#lone"));
	hover($("main"));
	expect(lit() === "", "the unlinked ref lights and pins nothing");
	expect(underlined($("#lone")) && getComputedStyle($("#lone")).cursor !== "pointer" && !$("#lone").classList.contains("is-linked"), "the unlinked ref shows it takes notes, not the link cue");
	expect(getComputedStyle($("#lone")).textDecorationColor !== getComputedStyle($("#term")).textDecorationColor, "a note target looks unlike a link");`;
	expect(await packAndRun(dir, "reply-link", PAGE(script, body, ["link", "reply"]))).toEqual([]);
}, 30_000);

test("on a page with kit:reply.js alone its note targets are reachable and marked", async () => {
	const body = `<p>The <span id="a" data-ref="pair">first</span> and <span id="b" data-ref="pair">second</span> part.</p>`;
	const script = `${NOTE_BY_KEY}
	expect(noteByKey($("#a")), "Enter on a focused ref opens its note");
	expect(underlined($("#a")), "the ref shows it takes notes");
	$("p").insertAdjacentHTML("beforeend", ' <span id="late" data-ref="late">late</span>');
	await Promise.resolve();
	expect(noteByKey($("#late")), "a ref written after load takes notes by keyboard too");
	hover($("#a"));
	expect(lit() === "", "without kit:link.js nothing lights");`;
	expect(await packAndRun(dir, "reply-only", PAGE(script, body, ["reply"]))).toEqual([]);
}, 30_000);

test.each([
	["link", "linked part stops linking"],
	["reply", "note target stops taking notes"],
])(
	"with kit:%s.js the kit removes only the tabindex it set when a %s",
	async (kit) => {
		const body = `<p><span id="a" data-ref="pair">one</span> and <span id="b" data-ref="pair">two</span>.</p>`;
		const script = `
	const tab = (id) => $("#" + id).getAttribute("tabindex");
	expect(tab("a") === "0" && tab("b") === "0", "the kit makes the parts focusable");
	$("#a").tabIndex = -1;
	for (const id of ["a", "b"]) $("#" + id).removeAttribute("data-ref");
	await Promise.resolve();
	expect(tab("a") === "-1", "a tabindex the page wrote over the kit's stays");
	expect(tab("b") === null, "the tabindex the kit set goes");`;
		expect(await packAndRun(dir, `tabindex-${kit}`, PAGE(script, body, [kit]))).toEqual([]);
	},
	30_000,
);

test("a note target moved out of the text loses its mark, and one moved within keeps it", async () => {
	const body = `<p id="from"><span id="out" data-ref="out">leaves</span> <span id="stay" data-ref="stay">moves</span></p><p id="to"></p>`;
	const script = `
	const footer = document.body.appendChild(document.createElement("footer"));
	footer.append($("#out"));
	$("#to").append($("#stay"));
	await Promise.resolve();
	expect(!$("#out").classList.contains("is-annotatable") && !$("#out").hasAttribute("tabindex"), "a target moved outside main is plain text again");
	expect($("#stay").classList.contains("is-annotatable") && $("#stay").tabIndex === 0, "a target moved within main stays one");`;
	expect(await packAndRun(dir, "moved", PAGE(script, body, ["reply"]))).toEqual([]);
}, 30_000);
