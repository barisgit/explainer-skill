import { afterAll, test } from "bun:test";
import { packAndCheck, scratch } from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** Every text the kit scripts add, by kitLabels key, as an English page shows it. */
const ENGLISH = {
	back: "Back",
	play: "Play",
	pause: "Pause",
	next: "Next",
	stepControls: "Step controls",
	step: "Step",
	stepper: "Step-through; use the arrow keys",
	contents: "Contents",
	breadcrumb: "Breadcrumb",
	expandAll: "Expand all",
	collapseAll: "Collapse all",
	overview: "Overview",
	reply: "Reply",
	clear: "Clear answers and notes",
	clearConfirm: "Clear everything?",
	clearPrompt: "Press again to clear all answers and notes.",
	clearCancelled: "Clear cancelled.",
	yourReply: "Your reply",
	close: "Close",
	copyReply: "Copy reply",
	copied: "Copied. Paste it to the agent.",
	copyFailed: "Copy failed: select the text above and copy it.",
	remove: "Remove",
	note: "Note",
	notePlaceholder: "Note for the agent",
	addNote: "Add note",
	noteOn: "Note on",
	part: "Part",
	cancel: "Cancel",
	saveNote: "Save note",
	figure: "figure",
	page: "page",
};

const SLOVENIAN: typeof ENGLISH = {
	back: "Nazaj",
	play: "Predvajaj",
	pause: "Premor",
	next: "Naprej",
	stepControls: "Upravljanje korakov",
	step: "Korak",
	stepper: "Po korakih; uporabite puščici",
	contents: "Vsebina",
	breadcrumb: "Drobtine",
	expandAll: "Razširi vse",
	collapseAll: "Strni vse",
	overview: "Pregled",
	reply: "Odgovor",
	clear: "Počisti odgovore in opombe",
	clearConfirm: "Počistim vse?",
	clearPrompt: "Pritisnite še enkrat, da počistite vse.",
	clearCancelled: "Čiščenje preklicano.",
	yourReply: "Vaš odgovor",
	close: "Zapri",
	copyReply: "Kopiraj odgovor",
	copied: "Kopirano. Prilepite agentu.",
	copyFailed: "Kopiranje ni uspelo: označite besedilo zgoraj.",
	remove: "Odstrani",
	note: "Opomba",
	notePlaceholder: "Opomba za agenta",
	addNote: "Dodaj opombo",
	noteOn: "Opomba k",
	part: "Del",
	cancel: "Prekliči",
	saveNote: "Shrani opombo",
	figure: "slika",
	page: "stran",
};

/**
 * A page with a stepper, nested views (rail and trail, no .back link, so the overview's name is the label), two folds, a reply
 * question and three note parts: in a headed section, in a named figure, and outside any section. Its script, after the kit scripts, sets `labels` as kitLabels when given. After load it works each
 * component and throws "labels contract: <name>" for every text that is not `expected`'s; a run that does not finish throws too.
 */
const PAGE = (
	lang: string,
	expected: typeof ENGLISH,
	labels?: typeof ENGLISH,
) => `<!doctype html><html lang="${lang}"><head>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="kit:theme.css"></head><body>
<main class="page"><div data-overview><h1>Labels</h1>
<p>A <span data-ref="loose">loose</span> part.</p>
<section><h2>People</h2><p><a href="#p/a">A</a> <a href="#p/b">B</a></p>
<details><summary>One</summary><p>1</p></details><details><summary>Two</summary><p>2</p></details></section>
<section><h2>Items</h2><p><a href="#i/1">One</a>, and the <span data-ref="cache">cache</span>.</p>
<figure aria-label="Scheme"><p>The <span data-ref="db">db</span>.</p></figure>
<fieldset data-reply><legend>Pick</legend><label><input type="radio" name="p" value="a" id="pa"> A</label> <label><input type="radio" name="p" value="b" id="pb"> B</label></fieldset>
<figure class="fig" id="s" data-stepper><svg viewBox="0 0 50 20" width="150"><rect data-step="1" width="20" height="20"/><rect data-step="2" x="30" width="20" height="20"/></svg>
<ol data-captions><li>one</li><li>two</li></ol></figure></section></div>
<section class="view" data-view="p"><h1>Person</h1></section>
<section class="view" data-view="i"><h1>Item</h1></section></main>
<script src="kit:steps.js"></script><script src="kit:views.js"></script><script src="kit:reply.js"></script>
<script>
${labels ? `var kitLabels = ${JSON.stringify(labels)};` : ""}
const L = ${JSON.stringify(expected)};
const $ = (selector, root = document) => root.querySelector(selector);
const aria = (selector, root) => $(selector, root)?.getAttribute("aria-label");
const expect = (name, ok) => ok || setTimeout(() => { throw new Error("labels contract: " + name); });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let done = false;

function steps() {
	const play = $("[data-play]");
	expect("stepper buttons", $("[data-go='-1']").textContent === L.back && play.textContent === L.play && $("[data-go='1']").textContent === L.next);
	expect("stepper accessible names", aria(".player") === L.stepControls && aria(".player input") === L.step && aria("#s") === L.stepper);
	play.click();
	expect("stepper pause", play.textContent === L.pause);
	play.click();
}

async function views() {
	const all = $(".fold-all");
	expect("expand all", all.textContent === L.expandAll);
	all.click();
	expect("collapse all", all.textContent === L.collapseAll);
	expect("contents rail", $(".toc-toggle").textContent === L.contents && aria(".toc") === L.contents && $("#toc-list > li > a").textContent === L.overview);
	location.hash = "#p/a";
	await wait(50);
	expect("trail", aria(".view.active .trail") === L.breadcrumb && $(".view.active .crumbs a").textContent === L.overview);
	location.hash = "";
	await wait(50);
}

function clearing() {
	const reply = $(".reply-bar .primary");
	const clear = $(".reply-bar .btn:not(.primary)");
	expect("reply button", reply.textContent === L.reply);
	$("#pb").click();
	expect("reply count and clear", reply.textContent === L.reply + " (1)" && clear.textContent === L.clear);
	clear.click();
	expect("clear asks", clear.textContent === L.clearConfirm && $(".reply-bar [role=status]").textContent === L.clearPrompt);
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	expect("clear cancelled", clear.textContent === L.clear && $(".reply-bar [role=status]").textContent === L.clearCancelled);
}

function note() {
	$("[data-ref=cache]").click();
	expect("note hint", $(".reply-hint").textContent === L.noteOn + " \u201ccache\u201d");
	$(".reply-hint").click();
	const pop = $(".reply-pop");
	const text = $("textarea", pop);
	expect("note editor", pop.getAttribute("aria-label") === L.addNote && text.getAttribute("aria-label") === L.note && text.placeholder === L.notePlaceholder && $(".meta", pop).textContent === L.part + ": cache");
	expect("note editor buttons", $(".btn:not(.primary)", pop).textContent === L.cancel && $(".primary", pop).textContent === L.saveNote);
	text.value = "x";
	$(".primary", pop).click();
	for (const ref of ["db", "loose"]) {
		$("[data-ref=" + ref + "]").click();
		$(".reply-hint").click();
		$(".reply-pop textarea").value = "x";
		$(".reply-pop .primary").click();
	}
}

async function dialog() {
	$(".reply-bar .primary").click();
	const box = $(".reply-dialog");
	expect("dialog", aria(".reply-dialog") === L.yourReply && $("h2", box).textContent === L.yourReply && $("header .btn", box).textContent === L.close);
	const captions = [...box.querySelectorAll(".reply-note .meta")].map((p) => p.textContent);
	expect("note captions", captions.join("|") === ["cache · § Items", "db · " + L.figure + " \u201cScheme\u201d", "loose · " + L.page].join("|"));
	const markdown = $(".reply-md", box).textContent;
	expect("the reply Markdown locates notes in English", markdown.includes('(figure "Scheme")') && markdown.includes("(page)"));
	expect("dialog note", aria(".reply-note textarea", box) === L.note && $(".reply-note .btn", box).textContent === L.remove && $("footer .primary", box).textContent === L.copyReply);
	$("footer .primary", box).click();
	await wait(50);
	expect("copy status", [L.copied, L.copyFailed].includes($("footer [role=status]", box).textContent));
	box.close();
}

// After reply.js's restore, which also waits for load.
addEventListener("load", () => setTimeout(async () => {
	steps();
	await views();
	clearing();
	note();
	await dialog();
	done = true;
}, 20));
addEventListener("load", () => setTimeout(() => expect("the run finished", done), 350));
</script></body></html>`;

test("kitLabels set after the kit scripts reach every text they add: stepper, views navigation, folds, reply and notes", async () => {
	await packAndCheck(dir, "sl", PAGE("sl", SLOVENIAN, SLOVENIAN), "labels contract", [
		"--view",
		"none",
	]);
}, 30_000);

test("without kitLabels the kit's texts are English", async () => {
	await packAndCheck(dir, "en", PAGE("en", ENGLISH), "labels contract", ["--view", "none"]);
}, 30_000);
