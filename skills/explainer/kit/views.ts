/* views: hash router for drill-down views inside one file (#name/param, Back works, scroll restored), with breadcrumbs, previous/next, a contents rail and Expand all.
   `#name/param` shows <section class="view" data-view="name"> and hides [data-overview];
   no hash, or a hash no view claims (plain #anchors), shows the overview. A static view may claim one
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
   gets Expand all.
   Labels: the texts the navigation adds are English. A page in another language sets them, with those of the other kit scripts, in
   one object at the top level of any of its scripts, before or after the kit scripts: var kitLabels = { contents: "Vsebina", ... }.
   Keys here: contents "Contents" (the rail's name and its phone disclosure), breadcrumb "Breadcrumb" (the trail's accessible name),
   expandAll "Expand all", collapseAll "Collapse all", overview "Overview" (the overview's name in crumbs and rail, used only when no
   .back link names it). A key left out stays English. */
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

	/** The view claimed by the current hash: `name/param` wins over `name`; param is decoded. */
	function route() {
		const [name = "", ...rest] = canonical(location.hash.slice(1)).split("/");
		const view =
			views.find((v) => canonical(v.dataset.view ?? "") === `${name}/${rest.join("/")}`) ??
			views.find((v) => v.dataset.view === name);
		return { name, view, param: decode(rest.join("/")) };
	}

	/**
	 * Runs the view's handler, then the navigation, which reads the labels and folds the handler drew. A handler registered late
	 * redraws the current view through here too, without the scroll and focus of a route change.
	 */
	function draw(name: string, view: HTMLElement | undefined, param: string) {
		if (view) {
			handlers[name]?.(view, param);
		}
		nav.show(view ?? null, location.hash.slice(1));
		refreshFolds();
	}

	/** Shows the view for the hash, or the overview. Handlers run only once routing has started. */
	function show() {
		const { name, view, param } = route();
		const wasInView = root.classList.contains("in-view");
		if (view && !wasInView) {
			overviewY = scrollY;
		}
		for (const v of views) {
			v.classList.toggle("active", v === view);
		}
		root.classList.toggle("in-view", Boolean(view));
		if (started) {
			draw(name, view, param);
		}
		if (!view) {
			return wasInView ? scrollTo(0, overviewY) : undefined;
		}
		scrollTo(0, 0);
		const heading = view.querySelector<HTMLElement>("h1, h2");
		heading?.setAttribute("tabindex", "-1");
		heading?.focus({ preventScroll: true });
	}

	window.Views = {
		on(name, fn) {
			handlers[name] = fn;
			if (!started) {
				return;
			}
			const { name: current, view, param } = route();
			if (view && current === name) {
				draw(name, view, param);
			}
		},
	};
	root.classList.add("js-views");
	addEventListener("hashchange", show);
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
