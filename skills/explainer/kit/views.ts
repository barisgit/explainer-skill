/* views: hash router for drill-down views inside one file (#name/param, Back works, scroll restored).
   `#name/param` shows <section class="view" data-view="name"> and hides [data-overview];
   no hash, or a hash no view claims (plain #anchors), shows the overview. A static view may claim one
   param exactly: data-view="option/block-sort". Views.on(name, (el, param) => ...) fills a view for its
   param; it also runs on hashchange and on Back, so a view is a pure function of the URL.
   Load order: a page opened on a hash shows its view at once, but handlers run only after the page's scripts have all run
   (DOMContentLoaded), so state declared anywhere in them is ready, whatever order Views.on is called in. Views.on called after that
   (an async callback) runs its handler at once if the current hash is its view. */
(() => {
	const root = document.documentElement;
	const views = [...document.querySelectorAll<HTMLElement>("[data-view]")];
	const handlers: Record<string, ViewHandler> = {};
	let started = false;
	let overviewY = 0;

	/** A hash is typed by hand or copied from prose, so a malformed escape such as "100%" stays as written. */
	function decode(text: string) {
		try {
			return decodeURIComponent(text);
		} catch {
			return text;
		}
	}

	/** The view claimed by the current hash: `name/param` wins over `name`; param is decoded. */
	function route() {
		const [name = "", ...rest] = location.hash.slice(1).split("/");
		const view =
			views.find((v) => v.dataset.view === `${name}/${rest.join("/")}`) ??
			views.find((v) => v.dataset.view === name);
		return { name, view, param: decode(rest.join("/")) };
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
		if (!view) {
			return wasInView ? scrollTo(0, overviewY) : undefined;
		}
		if (started) {
			handlers[name]?.(view, param);
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
				fn(view, param);
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
