/* views nav: the trail, previous/next and contents rail of kit:views.js, not referenced from pages: pack joins it in front of
   views.js, which calls it once (with its kitText(key) for overview, contents and breadcrumb) and then show(view, hash) after
   every route change, once the view's handler has drawn it; revisited() and savedHash() tell it which view a history entry
   was left from, and replace(hash) rewrites the entry's hash without losing its trail.
   All of it is derived from markup the page already has:
     siblings  every #name/param the page links to (and static data-view="name/x" views), in document order. A link's text names
               its view (a .tree row link's first cell, without its numbers); text that is empty or names two different views
               ("Open", "→") is passed over for the view's heading, else its param.
     trail     the views the reader came through, one step per view name: opening a view whose name is in the trail replaces
               that step (next person, next item). Each step keeps its label and the sibling list it walks: the links of the
               view it was opened from, when that view links to it (an item opened from a person walks that person's items), else
               every sibling. Steps live in the history entry (its Navigation API state; history.state stays the page's), so Back,
               Forward and reload keep them; a link opened fresh starts a new trail.
     .trail    in a view, breadcrumbs that start with its own .back link (whose text names the overview, and which keeps any
               listener or selector the page gave it), with previous and next on the right.
     .toc      on a page with two or more view names, a contents rail: the overview, its sections by their data-nav or else
               their h2 (ids added when missing), and under the section that first links to a view name, each trail step's
               siblings (only the step itself past 12). The current section follows scrolling; 07-nav.css places the rail. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ViewsNav = ({ views, decode, canonical, kitText }) => {
	/** One trail step: the view's hash, its name as the reader saw it, and the sibling hashes it walks (absent: every sibling). */
	interface Step {
		hash: string;
		label: string;
		list?: string[];
	}
	/** Link text by hash, for the hashes whose text names only them. */
	type Labels = Map<string, string>;

	const STATE_KEY = "viewTrail";
	/** The location hash the trail was saved for: a fragment navigation copies the state into its new entry, where it is not yet its own. */
	const AT_KEY = "viewTrailAt";
	const RAIL_LIST_MAX = 12;
	/** The navigation this part builds: its links are never the page's own. */
	const KIT_NAV = ".trail, .toc";
	const overview = document.querySelector<HTMLElement>("[data-overview]");
	/** The overview as the page names it (its .back link), read when the navigation draws. */
	const overviewName = () =>
		clean(document.querySelector(".back")?.textContent) || kitText("overview");
	const nameOf = (hash: string) => hash.split("/")[0] ?? "";
	const names = new Set(views.map((v) => nameOf(v.dataset.view ?? "")));
	/** The hash each view element was last drawn for: its heading and links belong to that hash. */
	const drawn = new Map<HTMLElement, string>();
	let steps: Step[] = [];

	function clean(text: string | null | undefined) {
		return (text ?? "").replace(/\s+/g, " ").trim();
	}

	/** An element with attributes and text, set as text and never parsed. */
	function make<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		attrs: Record<string, string> = {},
		text = "",
	) {
		const el = document.createElement(tag);
		for (const [key, value] of Object.entries(attrs)) {
			el.setAttribute(key, value);
		}
		el.textContent = text;
		return el;
	}

	function item(child: Node) {
		const li = make("li");
		li.append(child);
		return li;
	}

	/* ---- Siblings and labels ---- */

	/** The page's own links to views of one name, in document order, inside `scope`. */
	function linksTo(name: string, scope: ParentNode = document) {
		const selector = `a[href^=${JSON.stringify(`#${name}/`)}]`;
		return [...scope.querySelectorAll<HTMLAnchorElement>(selector)].filter(
			(a) => !a.closest(KIT_NAV),
		);
	}

	// Links, static claims, saved lists and the current hash are all compared in views.js's canonical form.
	const hashOf = (a: HTMLAnchorElement) => canonical((a.getAttribute("href") ?? "").slice(1));
	const unique = (hashes: string[]) => [...new Set(hashes)];
	const viewDrawnFor = (hash: string) => [...drawn].find(([, h]) => h === hash)?.[0];

	/** Every sibling hash of one view name: the links, then static views nothing links to. */
	function allSiblings(name: string) {
		const statics = views
			.map((v) => v.dataset.view ?? "")
			.filter((claim) => claim.startsWith(`${name}/`))
			.map(canonical);
		return unique([...linksTo(name).map(hashOf), ...statics]);
	}

	const siblingsOf = (step: Step) => step.list ?? allSiblings(nameOf(step.hash));

	/** A link's text; a link that stands as a .tree row is named by its first cell, its label, without the numbers after it. */
	const linkText = (a: HTMLAnchorElement) => {
		const row = a.parentElement?.matches(".tree, .tree details");
		return clean(((row && a.firstElementChild) || a).textContent);
	};

	/** The first link text of each hash of one view name, kept only when no other hash shares it. */
	function linkLabels(name: string): Labels {
		const texts = new Map<string, Set<string>>();
		const links = linksTo(name).map((a) => ({ hash: hashOf(a), text: linkText(a) }));
		for (const { hash, text } of links) {
			texts.set(text, (texts.get(text) ?? new Set()).add(hash));
		}
		const found: Labels = new Map();
		for (const { hash, text } of links) {
			if (text && texts.get(text)?.size === 1 && !found.has(hash)) {
				found.set(hash, text);
			}
		}
		return found;
	}

	/** The linked name, else the heading of the view drawn for the hash, else its param. */
	function label(hash: string, known: Labels = linkLabels(nameOf(hash))) {
		return (
			known.get(hash) ||
			clean(viewDrawnFor(hash)?.querySelector("h1, h2")?.textContent) ||
			decode(hash.split("/").slice(1).join("/"))
		);
	}

	/* ---- Trail ---- */

	/**
	 * The trail saved with this history entry, in its Navigation API state, which is separate from history.state: the page's own
	 * state is never read or written. Without the API, in a frame that disables it, or after the page's own replaceState clears it,
	 * the entry has none and the trail in memory is extended instead.
	 */
	function savedTrail(): Step[] | null {
		const trail = entryState()[STATE_KEY];
		return Array.isArray(trail)
			? trail.filter((s): s is Step => typeof s?.hash === "string")
			: null;
	}

	/** This history entry's Navigation API state, {} when it has none. */
	function entryState(): Record<string, unknown> {
		const state: unknown = "navigation" in window ? navigation.currentEntry?.getState() : undefined;
		return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
	}

	/** The location hash, canonical: the one the trail is saved for. */
	const locationHash = () => canonical(location.hash.slice(1));

	/** The list a new step walks: the replaced step's while moving within it, else the parent view's links when they reach it. */
	function inheritedList(hash: string, parent: Step | undefined, replaced: Step | undefined) {
		if (replaced?.list?.includes(hash)) {
			return replaced.list;
		}
		const view = parent && viewDrawnFor(parent.hash);
		const list = view ? unique(linksTo(nameOf(hash), view).map(hashOf)) : [];
		return list.includes(hash) ? list : undefined;
	}

	/** The trail with `hash` put in: it replaces the step of the same view name and everything after it. */
	function extended(hash: string): Step[] {
		const cut = steps.findIndex((s) => nameOf(s.hash) === nameOf(hash));
		const before = cut < 0 ? steps : steps.slice(0, cut);
		const list = inheritedList(hash, before.at(-1), steps[cut]);
		return [...before, { hash, label: label(hash), ...(list ? { list } : {}) }];
	}

	/**
	 * This history entry's trail: the saved one on Back, Forward and reload, else the previous one with this view put in.
	 * `redrawn`: the view was drawn again for the same hash, so its step keeps its sibling list and is named from what it shows now.
	 */
	function stamp(hash: string, redrawn: boolean) {
		const kept = savedTrail();
		const last = kept?.at(-1);
		if (kept && last?.hash === hash) {
			steps = redrawn ? [...kept.slice(0, -1), { ...last, label: label(hash) }] : kept;
		} else {
			steps = hash ? extended(hash) : [];
		}
		try {
			navigation.updateCurrentEntry({ state: { [STATE_KEY]: steps, [AT_KEY]: locationHash() } });
		} catch {
			// No Navigation API, or a document whose entries it disables (a sandboxed frame): the trail stays in memory.
		}
	}

	function crumbs(here: Step, back: Element | null) {
		const list = make("ol", { class: "crumbs" });
		list.append(item(back ?? make("a", { href: "#" }, overviewName())));
		for (const step of steps.slice(0, -1)) {
			list.append(item(make("a", { href: `#${step.hash}` }, step.label)));
		}
		list.append(item(make("span", { "aria-current": "page" }, here.label)));
		return list;
	}

	/** Previous, position and next within the step's list; nothing when it has no siblings. */
	function neighbours(here: Step) {
		const list = siblingsOf(here);
		const at = list.indexOf(here.hash);
		if (at < 0 || list.length < 2) {
			return [];
		}
		const known = linkLabels(nameOf(here.hash));
		const link = (hash: string | undefined, rel: string) =>
			hash ? make("a", { href: `#${hash}`, rel }, label(hash, known)) : make("span");
		const box = make("div", { class: "sibs" });
		box.append(
			link(list[at - 1], "prev"),
			make("span", { class: "count" }, `${at + 1} / ${list.length}`),
			link(list[at + 1], "next"),
		);
		return [box];
	}

	/** The view's trail bar, made once where its .back link is (which the crumbs then take in), or first in its head. */
	function trailBar(view: HTMLElement) {
		let bar = view.querySelector<HTMLElement>(".trail");
		if (!bar) {
			bar = make("nav", { class: "trail", "aria-label": kitText("breadcrumb") });
			const back = view.querySelector(".back");
			if (back) {
				back.before(bar);
			} else {
				(view.querySelector(".view-head") ?? view).prepend(bar);
			}
		}
		return bar;
	}

	/* ---- Contents rail ---- */

	/** One overview section in the rail; `owns` lists the view names whose trail steps it shows. */
	interface Entry {
		section: HTMLElement;
		li: HTMLLIElement;
		link: HTMLAnchorElement;
		owns: string[];
	}
	interface Rail {
		nav: HTMLElement;
		home: HTMLAnchorElement;
		entries: Entry[];
	}

	/** An id no element has and no view name takes, so the rail's #id link scrolls to its section rather than opening a view. */
	const freeId = (id: string) => id !== "" && !names.has(id) && !document.getElementById(id);

	/** The section's id, given one from its rail label when it has none, else section-n, section-n+1, ... until one is free. */
	function sectionId(section: HTMLElement, text: string, n: number) {
		if (!section.id) {
			let id = text
				.toLowerCase()
				.replace(/[^\p{L}\p{N}]+/gu, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 48);
			for (let k = n; !freeId(id); k++) {
				id = `section-${k}`;
			}
			section.id = id;
		}
		return section.id;
	}

	/**
	 * A section's entry, named by its data-nav (a short label for a heading that states an answer) or else its heading; it owns the
	 * view names the section is the first to link to.
	 */
	function entry(section: HTMLElement, heading: HTMLElement, n: number, claimed: Set<string>) {
		const text = clean(section.dataset.nav) || clean(heading.textContent);
		const link = make("a", { href: `#${sectionId(section, text, n)}` }, text);
		const owns = [...names].filter((name) => !claimed.has(name) && linksTo(name, section).length);
		for (const name of owns) {
			claimed.add(name);
		}
		return { section, li: item(link), link, owns };
	}

	/** The rail, first in `page`: the overview link, then one entry per overview section with an h2. */
	function buildRail(page: HTMLElement, overview: HTMLElement): Rail {
		const sections = [...overview.querySelectorAll<HTMLElement>(":scope > section")];
		const headed = sections.flatMap((section) => {
			const heading = section.querySelector<HTMLElement>(":scope > h2");
			return heading ? [{ section, heading }] : [];
		});
		const claimed = new Set<string>();
		const entries = headed.map(({ section, heading }, i) =>
			entry(section, heading, i + 1, claimed),
		);
		const home = make("a", { href: "#" }, overviewName());
		const list = make("ol", { id: "toc-list" });
		list.append(item(home), ...entries.map((e) => e.li));

		const nav = make("nav", { class: "toc", "aria-label": kitText("contents") });
		const toggle = make(
			"button",
			{ type: "button", class: "toc-toggle", "aria-expanded": "false", "aria-controls": list.id },
			kitText("contents"),
		);
		const setOpen = (on: boolean) => {
			nav.classList.toggle("is-open", on);
			toggle.setAttribute("aria-expanded", String(on));
		};
		toggle.addEventListener("click", () =>
			setOpen(toggle.getAttribute("aria-expanded") !== "true"),
		);
		list.addEventListener("click", (e) => {
			if (e.target instanceof Element && e.target.closest("a")) {
				setOpen(false);
			}
		});
		nav.append(toggle, list);
		page.prepend(nav);

		const rail = { nav, home, entries };
		addEventListener("scroll", () => spySoon(rail), { passive: true });
		return rail;
	}

	/** A trail step's siblings under its section: the open view is the current page, an earlier step is marked as passed. */
	function stepList(step: Step, hash: string) {
		const all = siblingsOf(step);
		const shown = all.length > RAIL_LIST_MAX ? [step.hash] : all;
		const known = linkLabels(nameOf(step.hash));
		const sub = make("ol");
		for (const h of shown) {
			const text = h === step.hash ? step.label : label(h, known);
			const a = make("a", { href: `#${h}` }, text);
			a.classList.toggle("is-trail", h === step.hash && h !== hash);
			if (h === hash) {
				a.setAttribute("aria-current", "page");
			}
			sub.append(item(a));
		}
		return sub;
	}

	function updateRail(rail: Rail, hash: string) {
		for (const { li, owns } of rail.entries) {
			for (const old of li.querySelectorAll("ol")) {
				old.remove();
			}
			li.append(
				...steps.filter((s) => owns.includes(nameOf(s.hash))).map((s) => stepList(s, hash)),
			);
		}
		const current = rail.nav.querySelector<HTMLElement>('[aria-current="page"]');
		if (current && rail.nav.scrollHeight > rail.nav.clientHeight) {
			rail.nav.scrollTop = current.offsetTop - rail.nav.clientHeight / 3;
		}
		spy(rail);
	}

	let spyQueued = false;
	function spySoon(rail: Rail) {
		if (!spyQueued) {
			spyQueued = true;
			requestAnimationFrame(() => spy(rail));
		}
	}

	/** In the overview: the last section whose top has passed a third of the window, or the overview link above them all. */
	function spy(rail: Rail) {
		spyQueued = false;
		const inView = document.documentElement.classList.contains("in-view");
		const passed = rail.entries
			.filter((e) => e.section.getBoundingClientRect().top < innerHeight / 3)
			.at(-1);
		const here = inView ? null : (passed?.link ?? rail.home);
		for (const a of [rail.home, ...rail.entries.map((e) => e.link)]) {
			a.removeAttribute("aria-current");
		}
		here?.setAttribute("aria-current", "location");
	}

	const page = overview?.parentElement;
	const railHost = page && overview && names.size > 1 ? { page, overview } : null;
	// Set now, before the first paint: the page takes its rail-side width at once.
	document.documentElement.classList.toggle("has-toc", Boolean(railHost));
	let toc: Rail | null = null;
	let shownHash: string | null = null;

	/** Whether this history entry was shown before (Back, Forward, reload) rather than just made by following a link. */
	const revisited = () => entryState()[AT_KEY] === locationHash();

	return {
		revisited,
		/**
		 * Puts `hash` ("" for none) in place of this history entry's, keeping the trail saved with it, which history.replaceState
		 * alone clears. A trail copied from the entry before (not yet this entry's own) is left for show() to stamp.
		 */
		replace(hash: string) {
			const state = entryState();
			const own = state[AT_KEY] === locationHash();
			history.replaceState(
				history.state,
				"",
				hash ? `#${hash}` : location.pathname + location.search,
			);
			if (own) {
				try {
					navigation.updateCurrentEntry({ state: { ...state, [AT_KEY]: locationHash() } });
				} catch {
					// No Navigation API, or a document whose entries it disables: the trail stays in memory, as in stamp().
				}
			}
		},
		/** The view hash this history entry showed when it was left, from the trail saved with it; null for the overview or none. */
		savedHash: () => (revisited() ? (savedTrail()?.at(-1)?.hash ?? null) : null),
		show(view: HTMLElement | null, routeHash: string) {
			const hash = canonical(routeHash);
			// Shown again with no route change in between: a handler registered late has just drawn the view.
			const redrawn = hash === shownHash;
			shownHash = hash;
			// Built at the first route, which runs after the page's scripts, so the sections and links they write are listed.
			if (railHost && !toc) {
				toc = buildRail(railHost.page, railHost.overview);
			}
			// Recorded first: the new step's label may be the heading the handler just drew.
			if (view) {
				drawn.set(view, hash);
			}
			const current = view ? hash : "";
			stamp(current, redrawn);
			const here = steps.at(-1);
			if (view && here) {
				// Found before the bar is redrawn: the .back link sits beside the new bar, or in the crumbs it is about to replace.
				const back = view.querySelector(".back");
				trailBar(view).replaceChildren(crumbs(here, back), ...neighbours(here));
			}
			if (toc) {
				updateRail(toc, current);
			}
		},
	};
};
