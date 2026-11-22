/* views: hash router for drill-down views inside one file (#name/param, Back works, returning to the link the reader left from), with breadcrumbs, previous/next, a contents rail, Expand all, and .tree lists of hierarchical records.
   `#name/param` shows <section class="view" data-view="name"> and hides [data-overview];
   no hash shows the overview. A plain #anchor (a hash no view claims) whose element is in the open view keeps that view, also
   on Back and reload; any other shows the overview. Either way the folds around the element open and it is scrolled to.
   A static view may claim one param exactly: data-view="option/block-sort". Views.on(name, (el, param) => ...) fills a view for
   its param; it also runs on hashchange and on Back, so a view is a pure function of the URL.
   What follows a route's first ? is the state of something inside the view, and changing it leaves the view drawn as it is:
   #team?crew?view=table is the view #team with "crew?view=table" for what it holds. Routes compare decoded, so a link escapes a ?
   in a param as %3F (#s/a%3Fb opens data-view="s/a?b", which the View component writes as "s/a%3Fb"), and previous, next
   and the crumbs treat #v/a?panel?x=1 as #v/a while following each link with its state.
   Views.local(el) reads that part for an element (the whole hash on the overview; null while the element's view is hidden),
   and Views.setLocal(el, text) writes it in place with history.replaceState, keeping the view's trail.
   Load order: a page opened on a hash shows its view at once, but handlers run only after the page's scripts have all run
   (DOMContentLoaded), so state declared anywhere in them is ready, whatever order Views.on is called in. Views.on called after that
   (an async callback) runs its handler at once if the current hash is its view.
   Navigation needs no markup of its own. Link every view from the overview with a table or list whose link text names it briefly
   ("Blaž", "1.6.3 Login form"): an aria-label names a link explicitly; otherwise tree links use their first cell, other links their
   text, and a shared generic text ("Open") gives way to the view's heading. Start each view with <a class="back" href="#">Overview</a>, its text naming the overview. Then a view shows
   breadcrumbs of the views the reader came through, with previous and next among the views of its kind (the ones the view it
   was opened from links to, else all of them); a page with views inside views (two or more view names) gets a contents rail of
   its sections, beside the column on wide screens and a Contents disclosure on phones. A section is listed by its heading, or by
   data-nav="Price" on the section or its h2 (the section wins) when a short name finds it faster; the crumbs and previous/next keep the
   link texts. Any other page gets the rail only when it asks: <main data-contents>, which contents: true in the frontmatter
   writes. Names in the navigation wrap and are never cut off. A section with two or more <details>
   gets Expand all, which opens them at every level, at the end of the section's .toolbar when one comes before them. A
   <details class="answer"> (a question's model answer) is not counted or opened: the reader opens each answer after writing
   their own.
   Trees: one complete list of hierarchical records (phases > groups > items) on the page, opened level by level. Nest <details>
   in a .tree; a row is a <summary>, or a link to the item's view in place of a fold, and its children are cells: the label, then
   its numbers, which line up in columns across rows and levels. --tree-cols on the .tree gives one width per number column
   (unset, each is 5rem, narrower where a deep row on a phone has no room); a .tree-head first in the tree names the label and
   each column over the rows. On phones a row with two or more numbers puts them on a line under its label, in the same columns:
   at the third level a 360-pixel phone leaves about 16rem for them and their 0.5rem gaps, and a width written as minmax(0, 4rem)
   gives way where they do not fit. A leaf opens to its full text. Give every row the same cells in the same order, units
   included; an empty <span></span> keeps a column:
     <div class="tree" style="--tree-cols: 4rem 4rem">
       <div class="tree-head"><span>Task</span><span>Hours</span><span>Owner</span></div>
       <details id="spike"><summary><span>1.1 Spike boards</span><span>70 h</span><span></span></summary>
         <details><summary><span>1.1.1 Schematic review</span><span>12 h</span><span>Ana</span></summary><p>Full text.</p></details>
         <a href="#task/1.1.2"><span>1.1.2 Power stage</span><span>24 h</span><span>Ana</span></a>
       </details>
     </div>
   A link to an id inside it (<a href="#spike">Spike boards: 4 tasks, 70 h</a>) opens that branch. A row link's label names its view
   in the navigation. With kit:link.js, data-ref on a row lights it, and a closed fold that holds a lit row is tinted too. Trees
   print fully open.
   Labels: the texts the navigation adds are English. A page in another language sets them, with those of the other kit scripts, in
   the page's frontmatter labels, one key: text per line (contents: Vsebina). Keys here: contents "Contents" (the rail's name and
   its phone disclosure), breadcrumb "Breadcrumb" (the trail's accessible name), expandAll "Expand all", collapseAll "Collapse
   all", overview "Overview" (the overview's name in crumbs and rail, used only when no .back link names it). A key left out stays
   English. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const root = document.documentElement;
	const views = [...document.querySelectorAll<HTMLElement>("[data-view]")];
	const handlers: Record<string, ViewHandler> = {};
	let started = false;
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
	const nav = window.ViewsNav({ views, canonical, key, decode, kitText });
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

	/** Where the page is: the view shown (none on the overview), its name, decoded param and canonical hash ("" on the overview). */
	interface Route {
		name: string;
		view: HTMLElement | undefined;
		param: string;
		hash: string;
	}
	const OVERVIEW: Route = { name: "", view: undefined, param: "", hash: "" };
	/** The route last drawn, once routing has started. */
	let shown = OVERVIEW;

	/** Where the reader was in a route when they left it: the scroll, and the element they left from with its top in the window. */
	interface Place {
		y: number;
		from: HTMLElement | null;
		top: number;
	}
	/** The place each route was last left at, by its canonical hash ("" for the overview). */
	const places = new Map<string, Place>();
	/** The link the reader last followed, which the route they leave is left from. */
	let followed: Element | null = null;
	/**
	 * The place taken as the next navigation starts (the Navigation API's navigate event), before Back or Forward restores the
	 * scroll of the entry they go to; without the API, the place is taken at hashchange.
	 */
	let leaving: Place | null = null;

	/** A canonical hash split at its first ?: the route, and the local state after it ("" when there is no ?). */
	function split(hash: string) {
		const query = hash.indexOf("?");
		return query < 0
			? { path: hash, local: "" }
			: { path: hash.slice(0, query), local: hash.slice(query + 1) };
	}

	/**
	 * A hash's route as one string to compare: the part before its first ?, decoded, so #s/a%3Fb, #s/100%25 and #kdo/blaž name
	 * the views data-view="s/a%3Fb" (or "s/a?b"), "s/100%" and "kdo/blaž". Routing, sibling lists and labels all compare these.
	 */
	function key(hash: string) {
		return decode(split(canonical(hash)).path);
	}

	/** A static view's route as key() gives it: its data-view is a route, never followed by local state, so a ? in it is its own. */
	const viewKey = (view: HTMLElement) => key((view.dataset.view ?? "").replace(/\?/g, "%3F"));

	/** The view a canonical hash claims by its route: `name/param` wins over `name`; param is decoded. */
	function claim(hash: string): Route {
		const { path } = split(hash);
		const [name = "", ...rest] = path.split("/");
		const wanted = key(path);
		const view =
			(rest.length ? views.find((v) => viewKey(v) === wanted) : undefined) ??
			views.find((v) => v.dataset.view === name);
		return view ? { name, view, param: decode(rest.join("/")), hash: path } : OVERVIEW;
	}

	/** Whether two routes show one view for one route, whatever local state follows it and however it is escaped. */
	const sameRoute = (a: Route, b: Route) => a.view === b.view && key(a.hash) === key(b.hash);

	/** The element a hash names by id, if any. */
	const targetOf = (hash: string) => (hash ? document.getElementById(decode(hash)) : null);

	/**
	 * The route for the current hash: the view it claims; else, for a plain #anchor, on Back, Forward and reload the route this
	 * history entry showed when the reader left it (the navigation keeps it in the entry's Navigation API state), and on a link
	 * just followed the open view when the anchor's element is in it; else the overview. The open view is handed back as `shown`
	 * itself, so show() knows it is already drawn: also when only the local state after the route changed.
	 */
	function route(): Route {
		const hash = canonical(location.hash.slice(1));
		const claimed = claim(hash);
		if (claimed.view) {
			return sameRoute(claimed, shown) ? shown : claimed;
		}
		// The saved route first: every param of a view may draw the same anchor, so the open view is no evidence on Back.
		if (nav.revisited()) {
			const saved = claim(nav.savedHash() ?? "");
			return sameRoute(saved, shown) ? shown : saved;
		}
		return shown.view?.contains(targetOf(hash)) ? shown : OVERVIEW;
	}

	/** Opens every <details> that holds `target`, and `target` itself when it is one, so following a link to it shows it. */
	function reveal(target: Element) {
		for (let d = target.closest("details"); d; d = d.parentElement?.closest("details") ?? null) {
			d.open = true;
		}
	}

	/**
	 * The element a plain #anchor names, when it is in the part of the page `at` shows: its view, or outside every view. None for
	 * a hash that is the route itself, though a view's section may carry it as its id.
	 */
	function shownTarget(at: Route) {
		const hash = canonical(location.hash.slice(1));
		const target = hash === at.hash ? null : targetOf(hash);
		const inView = target?.closest("[data-view]");
		return target && (at.view ? at.view.contains(target) : !inView) ? target : null;
	}

	/**
	 * Runs the view's handler, then the navigation, which reads the labels and folds the handler drew. A handler registered late
	 * redraws the current view through here too, without a route change's scroll to the top and focus. `again`: the view is already
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

	/** Shows the view for the hash, or the overview, and the element a plain #anchor names. Handlers run once routing started. */
	function show() {
		// Read before draw() saves this entry's trail, which makes every entry revisited.
		const revisited = nav.revisited();
		const at = route();
		const { view } = at;
		// route() hands back `shown` itself for an anchor inside the open view; the overview is a shared constant, so it needs a view.
		const again = started && at === shown && Boolean(view);
		const wasInView = root.classList.contains("in-view");
		if (started && at !== shown) {
			places.set(shown.hash, leaving ?? placeIn(shown, location.hash));
		}
		followed = null;
		leaving = null;
		for (const v of views) {
			v.classList.toggle("active", v === view);
		}
		root.classList.toggle("in-view", Boolean(view));
		if (!started) {
			return;
		}
		draw(at, again);
		land(at, { wasInView, again, revisited });
	}

	/** Whether an element is in the part of the page `at` shows: its view, or outside every view on the overview. */
	const inPart = (at: Route, el: Element) =>
		at.view ? at.view.contains(el) : !el.closest("[data-view]");

	/**
	 * Where the reader is in the route being left: the link they just followed to the new hash, else the element focused, when it
	 * is in that route's part of the page.
	 */
	function placeIn(at: Route, hash: string): Place {
		const link = followed?.getAttribute("href");
		const to = link !== undefined && link !== null && key(link.slice(1)) === key(hash.slice(1));
		const from = to ? followed : document.activeElement;
		const own =
			from instanceof HTMLElement && from !== document.body && inPart(at, from) ? from : null;
		return { y: scrollY, from: own, top: own?.getBoundingClientRect().top ?? 0 };
	}

	/**
	 * Returns to a place: the element left from back at its height in the window and focused (it moved if the page above it
	 * changed), else the scroll left at; the top when the route was never left.
	 */
	function restore(place: Place | undefined) {
		const from = place?.from;
		const box =
			from?.isConnected && from.getClientRects().length ? from.getBoundingClientRect() : null;
		scrollTo(0, box && place ? scrollY + box.top - place.top : (place?.y ?? 0));
		if (box) {
			from?.focus({ preventScroll: true });
		}
	}

	/**
	 * Scrolls for a route just drawn. The folds around the element a plain #anchor names open. It is scrolled to in a view, and on
	 * the overview when a link was just followed to it; else the overview returns to where the reader left it, focus on the link
	 * they left from, as does a view on Back and Forward; a view opened by a link starts at its top, its heading focused.
	 */
	function land(
		at: Route,
		{ wasInView, again, revisited }: { wasInView: boolean; again: boolean; revisited: boolean },
	) {
		const target = shownTarget(at);
		if (target) {
			reveal(target);
		}
		if (target && (at.view || !revisited)) {
			target.scrollIntoView();
		} else if (at.view && !again) {
			openView(at.view, revisited ? places.get(at.hash) : undefined);
		} else if (!at.view && wasInView) {
			restore(places.get(at.hash));
		}
	}

	/** A view just opened: back at the place the reader left it on Back and Forward, else at its top, its heading focused. */
	function openView(view: HTMLElement, place: Place | undefined) {
		if (place) {
			restore(place);
			return;
		}
		scrollTo(0, 0);
		const heading = view.querySelector<HTMLElement>("h1, h2");
		heading?.setAttribute("tabindex", "-1");
		heading?.focus({ preventScroll: true });
	}

	/** The shown route an element's local state follows: `shown` when the element is in its view, OVERVIEW outside every view. */
	function routeOf(el: Element) {
		const view = el.closest("[data-view]");
		if (view) {
			return view === shown.view ? shown : null;
		}
		return shown.view ? null : OVERVIEW;
	}

	window.Views = {
		record(el) {
			const at = routeOf(el);
			return at?.view?.hasAttribute("data-fill") ? at.param : null;
		},
		local(el) {
			const hash = canonical(location.hash.slice(1));
			const view = el.closest("[data-view]");
			if (!view) {
				return root.classList.contains("in-view") ? null : hash;
			}
			// Read from the hash and the view shown, not from `shown`: a component may read before routing starts.
			if (!view.classList.contains("active")) {
				return null;
			}
			return claim(hash).view === view ? split(hash).local : hash;
		},
		setLocal(el, text) {
			const at = started ? routeOf(el) : null;
			if (at) {
				nav.replace(at.view ? `${at.hash}${text ? `?${text}` : ""}` : text);
			}
		},
		on(name, fn) {
			handlers[name] = fn;
			if (!started) {
				return;
			}
			const at = route();
			if (at.view && at.name === name) {
				draw(at);
				// The #anchor the reader is at may be in what the handler just drew (a reload, before this handler existed).
				const target = shownTarget(at);
				if (target) {
					reveal(target);
					target.scrollIntoView();
				}
			}
		},
	};
	root.classList.add("js-views");
	if ("navigation" in window) {
		navigation.addEventListener("navigate", (e) => {
			leaving = started ? placeIn(shown, new URL(e.destination.url).hash) : null;
		});
	}
	addEventListener("hashchange", show);
	// The link followed is the place the route it leaves returns to. A link to the current hash fires no hashchange, so the folds
	// its element is in (closed again since) open here; the browser then scrolls to it as it does for any link to the current hash.
	document.addEventListener("click", (e) => {
		const link = e.target instanceof Element ? e.target.closest("a[href^='#']") : null;
		followed = link;
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
