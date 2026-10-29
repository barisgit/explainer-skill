/* Records' keyboard moves (see ../records.tsx): rows with roving focus. A row's head is the element a reader lands on, the
   row's summary, link, or the row itself; one head is in the Tab order and the arrow keys move between them, so Tab passes the
   whole list in one stop and goes on to the controls after it (the answers of a row come right after its head, a search box before
   the list). Native disclosures, links and tables keep their own semantics and Enter and Space their own meaning on them; the
   keys here add only the moves. */

/** The rows of the three views, as elements; the head of each is found by `headOf`. The total row is not a record. */
const ROWS = ".tree :is(summary, a, .tree-row:not(.total)), tbody tr, .lane li";

/** Text the reader types into: a key pressed there is theirs. */
const TEXT_ENTRY = "textarea, select, [contenteditable], input:not([type=radio], [type=checkbox])";

/** The one head each block keeps in the Tab order, remembered across renders. */
const current = new WeakMap<HTMLElement, HTMLElement>();

/** A table row's or card's head is the link or fold of its label, else the row; the tree's rows are their own heads. */
const headOf = (row: HTMLElement) =>
	row.matches("tr, li") ? (row.querySelector<HTMLElement>("a, summary") ?? row) : row;

/** Whether a closed fold hides `head`: its own fold's summary stays in sight when closed, anything inside it does not. */
function folded(head: HTMLElement): boolean {
	const own = head.tagName === "SUMMARY" ? head.parentElement : null;
	let fold = (own ?? head).parentElement?.closest("details");
	while (fold) {
		if (!fold.open) {
			return true;
		}
		fold = fold.parentElement?.closest("details");
	}
	return false;
}

/** Every row's head in `block`, in the order of the page. */
const allHeads = (block: HTMLElement) => [...block.querySelectorAll<HTMLElement>(ROWS)].map(headOf);

/** The heads a reader can reach in `block`: those not inside a closed fold or a hidden element. */
const headsOf = (block: HTMLElement) =>
	allHeads(block).filter((head) => !(folded(head) || head.closest("[hidden]")));

/**
 * Puts the block's current head in the Tab order and every other out of it, those a closed fold hides included (they would
 * be a second stop once it opens); run after every render, since rows come and go.
 */
export function rove(block: HTMLElement) {
	const heads = headsOf(block);
	const kept = current.get(block);
	const at = (kept && heads.includes(kept) ? kept : heads[0]) ?? null;
	for (const head of allHeads(block)) {
		head.tabIndex = head === at ? 0 : -1;
	}
	if (at) {
		current.set(block, at);
	}
}

/** The summary of the fold that holds `head`: the parent group of a row, or of a group. */
function parentHead(head: HTMLElement): HTMLElement | null {
	const own = head.tagName === "SUMMARY" ? head.parentElement : head;
	const parent = own?.parentElement?.closest("details");
	return parent?.querySelector<HTMLElement>(":scope > summary") ?? null;
}

/** The fold `head` opens, when it is a fold's summary. */
const foldOf = (head: HTMLElement) =>
	head.tagName === "SUMMARY" && head.parentElement instanceof HTMLDetailsElement
		? head.parentElement
		: null;

/** Focuses `to` and says whether there was somewhere to go. */
function focusOn(to: HTMLElement | null | undefined): boolean {
	to?.focus();
	return to != null;
}

/**
 * What `key` does on `head`, and whether it did anything (a key that did nothing keeps its meaning for the page, so the last row's
 * Down key still scrolls). Left and Right fold and unfold a group, and Right on an open one steps into it, Left on a row steps out
 * to its group, as the keys of a tree do.
 */
function act(key: string, head: HTMLElement, heads: HTMLElement[]): boolean {
	const at = heads.indexOf(head);
	const fold = foldOf(head);
	const next = heads[at + 1];
	switch (key) {
		case "ArrowDown":
			return focusOn(next);
		case "ArrowUp":
			return focusOn(heads[at - 1]);
		case "Home":
			return focusOn(heads[0]);
		case "End":
			return focusOn(heads.at(-1));
		case "ArrowRight":
			if (fold && !fold.open) {
				fold.open = true;
				return true;
			}
			return focusOn(fold && next && fold.contains(next) ? next : null);
		case "ArrowLeft":
			if (fold?.open) {
				fold.open = false;
				return true;
			}
			return focusOn(head.closest(".tree") ? parentHead(head) : null);
		default:
			return false;
	}
}

/** Keydown on a block: arrow keys, Home and End move between rows and groups, and / goes to the search box. */
export function onKeyDown(event: KeyboardEvent, block: HTMLElement) {
	const { key, target: from } = event;
	if (event.altKey || event.ctrlKey || event.metaKey || !(from instanceof HTMLElement)) {
		return;
	}
	if (key === "/" && !from.matches(TEXT_ENTRY)) {
		const search = block.querySelector<HTMLInputElement>("input[type=search]");
		if (search) {
			event.preventDefault();
			search.focus();
			search.select();
		}
		return;
	}
	const heads = headsOf(block);
	if (heads.includes(from) && act(key, from, heads)) {
		event.preventDefault();
	}
}

/** Focus moved onto a head, by key or pointer: it is now the one in the Tab order. */
export function onFocusIn(event: FocusEvent, block: HTMLElement) {
	const head = event.target instanceof HTMLElement ? event.target : null;
	if (head && headsOf(block).includes(head)) {
		current.set(block, head);
		rove(block);
	}
}
