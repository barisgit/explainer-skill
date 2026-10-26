import { SETTLED } from "./support.ts";

/** Every text the kit scripts and components add, by kitLabels key, as an English page shows it. */
export const ENGLISH = {
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
	showAnswer: "Show answer",
	recordsTree: "Tree",
	recordsTable: "Table",
	recordsBoard: "Board",
	recordsView: "View",
	recordsSearch: "Search",
	recordsTotal: "Total",
	recordsShown: "{shown} of {total}",
	recordsNoMatches: "No matches",
	recordsClear: "Clear filters",
};

export const SLOVENIAN: typeof ENGLISH = {
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
	showAnswer: "Pokaži odgovor",
	recordsTree: "Drevo",
	recordsTable: "Tabela",
	recordsBoard: "Tabla",
	recordsView: "Pogled",
	recordsSearch: "Iskanje",
	recordsTotal: "Skupaj",
	recordsShown: "{shown} od {total}",
	recordsNoMatches: "Ni zadetkov",
	recordsClear: "Počisti filtre",
};

/**
 * Page script that works each kit component with a label and resolves `contract` with the name of every text that is not
 * `expected`'s (see packAndRun). The page needs a stepper (#s), nested views p and i with no .back link (the overview's name is
 * the label), a section with two folds first, a radio question with a "b" option, and three note parts: data-ref "cache" in a
 * section headed Items, "db" in a figure named Scheme, and "loose" outside any section. Records with two tasks, three views and
 * a search are worked when the page has them (an .mdx page; an HTML page cannot write the component).
 */
export const labelsScript = (expected: typeof ENGLISH) => `const L = ${JSON.stringify(expected)};
const $ = (selector, root = document) => root.querySelector(selector);
const aria = (selector, root) => $(selector, root)?.getAttribute("aria-label");
const failures = [];
const expect = (name, ok) => ok || failures.push(name);
// Resolves once the router has shown the new hash: its hashchange listener was added first, so it has run.
const navigate = (hash) => new Promise((shown) => { addEventListener("hashchange", shown, { once: true }); location.hash = hash; });
const changed = (node) => new Promise((done) => new MutationObserver((_, seen) => { seen.disconnect(); done(); }).observe(node, { childList: true, subtree: true, characterData: true }));

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
	await navigate("#p/a");
	expect("trail", aria(".view.active .trail") === L.breadcrumb && $(".view.active .crumbs a").textContent === L.overview);
	await navigate("");
}

function clearing() {
	const reply = $(".reply-bar .primary");
	const clear = $(".reply-bar .btn:not(.primary)");
	expect("reply button", reply.textContent === L.reply);
	$("[data-reply] input[value=b]").click();
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
	const status = changed($("footer [role=status]", box));
	$("footer .primary", box).click();
	await status;
	expect("copy status", [L.copied, L.copyFailed].includes($("footer [role=status]", box).textContent));
	box.close();
}

${SETTLED}
var contract = settled.then(async () => {
	steps();
	await views();
	clearing();
	note();
	await dialog();
	return failures;
});
`;
