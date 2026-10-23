/* views: hash router for drill-down views inside one file (#name/param, Back works, scroll restored), with breadcrumbs, previous/next, a contents rail, Expand all, and .tree lists of hierarchical records.
   `#name/param` shows <section class="view" data-view="name"> and hides [data-overview];
   no hash shows the overview. A plain #anchor (a hash no view claims) whose element is in the open view keeps that view, also
   on Back and reload; any other shows the overview. Either way the folds around the element open and it is scrolled to. A static view may claim one
   param exactly: data-view="option/block-sort". Views.on(name, (el, param) => ...) fills a view for its
   param; it also runs on hashchange and on Back, so a view is a pure function of the URL.
   Load order: a page opened on a hash shows its view at once, but handlers run only after the page's scripts have all run
   (DOMContentLoaded), so state declared anywhere in them is ready, whatever order Views.on is called in. Views.on called after that
   (an async callback) runs its handler at once if the current hash is its view.
   Navigation needs no markup of its own. Link every view from the overview with a table or list whose link text names it briefly
   ("Blaž", "1.6.3 Login form"): the crumbs and previous/next show that text, and a generic one ("Open") gives way to the view's
   heading. Start each view with <a class="back" href="#">Overview</a>, its text naming the overview. Then a view shows
   breadcrumbs of the views the reader came through, with previous and next among the views of its kind (the ones the view it
   was opened from links to, else all of them); a page with views inside views (two or more view names) gets a contents rail of
   its sections, beside the column on wide screens and a Contents disclosure on phones; a section with two or more <details>
   gets Expand all, which opens them at every level.
   Trees: one complete list of hierarchical records (phases > groups > items) on the page, opened level by level. Nest <details>
   in a .tree; a row is a <summary>, or a link to the item's view in place of a fold, and its children are cells: the label, then
   its numbers, which line up in columns across rows and levels (--tree-cell on the .tree sets their width, 5rem). A leaf opens to
   its full text. Give every row the same cells in the same order, units included; an empty <span></span> keeps a column:
     <div class="tree">
       <details id="spike"><summary><span>1.1 Spike boards</span><span>70 h</span><span></span></summary>
         <details><summary><span>1.1.1 Schematic review</span><span>12 h</span><span>Ana</span></summary><p>Full text.</p></details>
         <a href="#task/1.1.2"><span>1.1.2 Power stage</span><span>24 h</span><span>Ana</span></a>
       </details>
     </div>
   A link to an id inside it (<a href="#spike">Spike boards: 4 tasks, 70 h</a>) opens that branch. A row link's label names its view
   in the navigation. With kit:link.js, data-ref on a row lights it, and a closed fold that holds a lit row is tinted too; a page
   filter may mark its matches with class is-lit for the same effect. Trees print fully open.
   Labels: the texts the navigation adds are English. A page in another language sets them, with those of the other kit scripts, in
   one object at the top level of any of its scripts, before or after the kit scripts: var kitLabels = { contents: "Vsebina", ... }.
   Keys here: contents "Contents" (the rail's name and its phone disclosure), breadcrumb "Breadcrumb" (the trail's accessible name),
   expandAll "Expand all", collapseAll "Collapse all", overview "Overview" (the overview's name in crumbs and rail, used only when no
   .back link names it). A key left out stays English. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const root = document.documentElement;
	const views = [...document.querySelectorAll<HTMLElement>("[data-view]")];
	const handlers: Record<string, ViewHandler> = {};
	let started = false;
	let overviewY = 0;
	/** The English texts of the navigation parts, by kitLabels key. */
	const LABELS = {
		contents: "Contents",
		breadcrumb: "Breadcrumb",
		expandAll: "Expand all",
		collapseAll: "Collapse all",
		overview: "Overview",
	};
	/** The page's text for `key`, else the English one. Read when the parts draw, which starts once the page's scripts have run. */
	const kitText = (key: keyof typeof LABELS) => window.kitLabels?.[key] || LABELS[key];
	const nav = window.ViewsNav({ views, decode, canonical, kitText });
	const refreshFolds = window.ViewsFolds(kitText);

	/** A hash is typed by hand or copied from prose, so a malformed escape such as "100%" stays as written. */
	function decode(text: string) {
		try {
			return decodeURIComponent(text);
		} catch {
			return text;
		}
	}

	/**
	 * A hash in the form location.hash reports it: spaces and non-ASCII percent-encoded, escapes already written (%2F among them)
	 * kept. A page writes href="#kdo/blaž" and data-view="kdo/blaž" where location.hash reads "#kdo/bla%C5%BE"; hashes are
	 * compared in this form.
	 */
	function canonical(hash: string) {
		return new URL(`#${hash}`, "file:///").hash.slice(1);
	}

	/** Where the page is: the view shown (none for the overview), its name, decoded param and canonical hash ("" for the overview). */
	interface Route {
		name: string;
		view: HTMLElement | undefined;
		param: string;
		hash: string;
	}
	const OVERVIEW: Route = { name: "", view: undefined, param: "", hash: "" };
	/** The route last drawn, once routing has started. */
	let shown = OVERVIEW;

	/** The view a canonical hash claims: `name/param` wins over `name`; param is decoded. */
	function claim(hash: string): Route {
		const [name = "", ...rest] = hash.split("/");
		const view =
			views.find((v) => canonical(v.dataset.view ?? "") === `${name}/${rest.join("/")}`) ??
			views.find((v) => v.dataset.view === name);
		return view ? { name, view, param: decode(rest.join("/")), hash } : OVERVIEW;
	}

	/** The element a hash names by id, if any. */
	const targetOf = (hash: string) => (hash ? document.getElementById(decode(hash)) : null);

	/**
	 * The route for the current hash: the view it claims; else, for a plain #anchor, the open view when the anchor's element is in
	 * it, or the view this history entry was showing when the reader left it (Back, Forward and reload onto an anchor followed in a
	 * view; the navigation keeps it in the entry's Navigation API state); else the overview.
	 */
	function route(): Route {
		const hash = canonical(location.hash.slice(1));
		const claimed = claim(hash);
		if (claimed.view) {
			return claimed;
		}
		if (shown.view?.contains(targetOf(hash))) {
			return shown;
		}
		const saved = nav.savedHash();
		return saved ? claim(saved) : OVERVIEW;
	}

	/** Opens every <details> that holds `target`, and `target` itself when it is one, so following a link to it shows it. */
	function reveal(target: Element) {
		for (let d = target.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
			d.open = true;
		}
	}

	/** The element the current hash names, when it is in the part of the page `at` shows: its view, or outside every view. */
	function shownTarget(at: Route) {
		const target = targetOf(canonical(location.hash.slice(1)));
		const inView = target?.closest("[data-view]");
		return target && (at.view ? at.view.contains(target) : !inView) ? target : null;
	}

	/**
	 * Runs the view's handler, then the navigation, which reads the labels and folds the handler drew. A handler registered late
	 * redraws the current view through here too, without the scroll and focus of a route change. `again`: the view is already
	 * drawn for this hash (an anchor inside it was followed), so the handler does not run and the reader's folds and inputs stay.
	 */
	function draw(at: Route, again = false) {
		if (at.view && !again) {
			handlers[at.name]?.(at.view, at.param);
		}
		shown = at;
		nav.show(at.view ?? null, at.hash);
		refreshFolds();
	}

	/** Shows the view for the hash, or the overview, and the element a plain #anchor names. Handlers run once routing has started. */
	function show() {
		const at = route();
		const { view } = at;
		const again = started && at === shown && Boolean(view);
		const wasInView = root.classList.contains("in-view");
		if (view && !wasInView) {
			overviewY = scrollY;
		}
		for (const v of views) {
			v.classList.toggle("active", v === view);
		}
		root.classList.toggle("in-view", Boolean(view));
		if (!started) {
			return;
		}
		draw(at, again);
		land(at, wasInView, again);
	}

	/**
	 * Scrolls for a route just drawn: to the element a plain #anchor names, else back to where the reader left the overview, else to
	 * the top of a newly opened view, whose heading takes focus.
	 */
	function land(at: Route, wasInView: boolean, again: boolean) {
		const target = shownTarget(at);
		if (target) {
			reveal(target);
			target.scrollIntoView();
		} else if (!at.view) {
			if (wasInView) {
				scrollTo(0, overviewY);
			}
		} else if (!again) {
			scrollTo(0, 0);
			const heading = at.view.querySelector<HTMLElement>("h1, h2");
			heading?.setAttribute("tabindex", "-1");
			heading?.focus({ preventScroll: true });
		}
	}

	window.Views = {
		on(name, fn) {
			handlers[name] = fn;
			if (!started) {
				return;
			}
			const at = route();
			if (at.view && at.name === name) {
				draw(at);
			}
		},
	};
	root.classList.add("js-views");
	addEventListener("hashchange", show);
	// A link to the current hash fires no hashchange, so the folds its element is in (closed again since) open here; the browser
	// then scrolls to it as it does for any link to the current hash.
	document.addEventListener("click", (e) => {
		const link = e.target instanceof Element ? e.target.closest("a[href^='#']") : null;
		const hash = canonical((link?.getAttribute("href") ?? "").slice(1));
		const target = hash === canonical(location.hash.slice(1)) && shownTarget(shown);
		if (target) {
			reveal(target);
		}
	});
	show(); // layout only: the right view is visible before the first paint
	const start = () => {
		started = true;
		show();
	};
	if (document.readyState === "loading") {
		addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
