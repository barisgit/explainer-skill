/* views nav: the trail, previous/next and contents rail of kit:views.js, not referenced from pages: pack joins it in front of
   views.js, which calls it once and then show(view, hash) after every route change, once the view's handler has drawn it.
   All of it is derived from markup the page already has:
     siblings  every #name/param the page links to (and static data-view="name/x" views), in document order. A link's text names
               its view; text that is empty or names two different views ("Open", "→") is passed over for the view's heading,
               else its param.
     trail     the views the reader came through, one step per view name: opening a view whose name is in the trail replaces
               that step (next person, next item). Each step keeps its label and the sibling list it walks: the links of the
               view it was opened from, when that view links to it (an item opened from a person walks that person's items), else
               every sibling. Steps live in history.state next to the hash, so Back, Forward and reload keep them; a link opened
               fresh starts a new trail.
     .trail    in a view, breadcrumbs that start with its own .back link (whose text names the overview, and which keeps any
               listener or selector the page gave it), with previous and next on the right.
     .toc      on a page with two or more view names, a contents rail: the overview, its sections by their h2 (ids added when
               missing), and under the section that first links to a view name, each trail step's siblings (only the step itself
               past 12). Fixed beside the column from 64rem, a closed Contents disclosure below; the current section follows
               scrolling. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ViewsNav = ({ views, decode }) => {
	/** One trail step: the view's hash, its name as the reader saw it, and the sibling hashes it walks (absent: every sibling). */
	interface Step {
		hash: string;
		label: string;
		list?: string[];
	}
	type Labels = Map<string, string>;

	const KEY = "viewTrail";
	const RAIL_LIST_MAX = 12;
	const OWN = ".trail, .toc";
	const overview = document.querySelector<HTMLElement>("[data-overview]");
	const home = clean(document.querySelector(".back")?.textContent) || "Overview";
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

	/** The page's own links to views of one name (never the kit's), in document order, inside `scope`. */
	function linksTo(name: string, scope: ParentNode = document) {
		const selector = `a[href^=${JSON.stringify(`#${name}/`)}]`;
		return [...scope.querySelectorAll<HTMLAnchorElement>(selector)].filter((a) => !a.closest(OWN));
	}

	const hashOf = (a: HTMLAnchorElement) => (a.getAttribute("href") ?? "").slice(1);
	const unique = (hashes: string[]) => [...new Set(hashes)];

	/** Every sibling hash of one view name: the links, then static views nothing links to. */
	function siblings(name: string) {
		const statics = views
			.map((v) => v.dataset.view ?? "")
			.filter((claim) => claim.startsWith(`${name}/`));
		return unique([...linksTo(name).map(hashOf), ...statics]);
	}

	/** A name for each linked hash: the first link text that names only that view. */
	function labels(name: string): Labels {
		const texts = new Map<string, Set<string>>();
		const links = linksTo(name).map((a) => ({ hash: hashOf(a), text: clean(a.textContent) }));
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
	function label(hash: string, known: Labels = labels(nameOf(hash))) {
		const view = [...drawn].find(([, h]) => h === hash)?.[0];
		return (
			known.get(hash) ||
			clean(view?.querySelector("h1, h2")?.textContent) ||
			decode(hash.split("/").slice(1).join("/"))
		);
	}

	function saved(): Step[] | null {
		const state: unknown = history.state;
		const trail =
			state && typeof state === "object" && KEY in state
				? (state as Record<string, unknown>)[KEY]
				: null;
		return Array.isArray(trail)
			? trail.filter((s): s is Step => typeof s?.hash === "string")
			: null;
	}

	/** The sibling list a new step walks: kept while moving within it, else the parent view's links when they reach it. */
	function listFor(hash: string, parent: Step | undefined, replaced: Step | undefined) {
		if (replaced?.list?.includes(hash)) {
			return replaced.list;
		}
		const view = parent && [...drawn].find(([, h]) => h === parent.hash)?.[0];
		const list = view ? unique(linksTo(nameOf(hash), view).map(hashOf)) : [];
		return list.includes(hash) ? list : undefined;
	}

	/** The trail with `hash` put in: it replaces the step of the same view name and everything after it. */
	function extended(hash: string): Step[] {
		const cut = steps.findIndex((s) => nameOf(s.hash) === nameOf(hash));
		const before = cut < 0 ? steps : steps.slice(0, cut);
		const list = listFor(hash, before.at(-1), steps[cut]);
		return [...before, { hash, label: label(hash), ...(list ? { list } : {}) }];
	}

	/** This history entry's trail: the saved one on Back, Forward and reload, else the previous one with this view put in. */
	function stamp(hash: string) {
		const kept = saved();
		if (kept?.at(-1)?.hash === hash) {
			steps = kept;
		} else {
			steps = hash ? extended(hash) : [];
		}
		const state: unknown = history.state;
		history.replaceState(
			{ ...(state && typeof state === "object" ? state : {}), [KEY]: steps },
			"",
		);
	}

	const listOf = (step: Step) => step.list ?? siblings(nameOf(step.hash));

	function crumbs(here: Step, back: Element | null) {
		const list = make("ol", { class: "crumbs" });
		list.append(item(back ?? make("a", { href: "#" }, home)));
		for (const step of steps.slice(0, -1)) {
			list.append(item(make("a", { href: `#${step.hash}`, title: step.label }, step.label)));
		}
		list.append(item(make("span", { "aria-current": "page", title: here.label }, here.label)));
		return list;
	}

	/** Previous, position and next within the step's list; nothing when it has no siblings. */
	function neighbours(here: Step) {
		const list = listOf(here);
		const at = list.indexOf(here.hash);
		if (at < 0 || list.length < 2) {
			return [];
		}
		const known = labels(nameOf(here.hash));
		// The name sits in a span: an ellipsis needs a block of its own, and the link is a flex row with its arrow.
		const link = (hash: string | undefined, rel: string) => {
			if (!hash) {
				return make("span");
			}
			const text = label(hash, known);
			const a = make("a", { href: `#${hash}`, rel, title: text });
			a.append(make("span", {}, text));
			return a;
		};
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
			bar = make("nav", { class: "trail", "aria-label": "Breadcrumb" });
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
	interface Entry {
		section: HTMLElement;
		li: HTMLLIElement;
		link: HTMLAnchorElement;
		owns: string[];
	}
	const entries: Entry[] = [];
	let rail: HTMLElement | null = null;
	let homeLink: HTMLAnchorElement | null = null;

	function sectionId(section: HTMLElement, heading: HTMLElement) {
		if (!section.id) {
			const slug = clean(heading.textContent)
				.toLowerCase()
				.replace(/[^\p{L}\p{N}]+/gu, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 48);
			section.id =
				slug && !names.has(slug) && !document.getElementById(slug)
					? slug
					: `section-${entries.length + 1}`;
		}
		return section.id;
	}

	/** One entry per overview section with an h2: the heading clamped in a span, so the link's padding shows no cut-off line. */
	function entry(section: HTMLElement, heading: HTMLElement, claimed: Set<string>): Entry {
		const text = clean(heading.textContent);
		const link = make("a", { href: `#${sectionId(section, heading)}`, title: text });
		link.append(make("span", {}, text));
		const owns = [...names].filter((n) => !claimed.has(n) && linksTo(n, section).length);
		for (const n of owns) {
			claimed.add(n);
		}
		return { section, li: item(link), link, owns };
	}

	function buildRail(page: HTMLElement, sections: HTMLElement[]) {
		const list = make("ol", { id: "toc-list" });
		homeLink = make("a", { href: "#" }, home);
		list.append(item(homeLink));
		const claimed = new Set<string>();
		for (const section of sections) {
			const heading = section.querySelector<HTMLElement>(":scope > h2");
			if (heading) {
				entries.push(entry(section, heading, claimed));
			}
		}
		list.append(...entries.map((e) => e.li));
		const toggle = make(
			"button",
			{ type: "button", class: "toc-toggle", "aria-expanded": "false", "aria-controls": list.id },
			"Contents",
		);
		toggle.addEventListener("click", () => open(toggle.getAttribute("aria-expanded") !== "true"));
		list.addEventListener(
			"click",
			(e) => e.target instanceof Element && e.target.closest("a") && open(false),
		);
		rail = make("nav", { class: "toc", "aria-label": "Contents" });
		rail.append(toggle, list);
		page.prepend(rail);
		addEventListener("scroll", spySoon, { passive: true });
	}

	function open(on: boolean) {
		rail?.classList.toggle("is-open", on);
		rail?.querySelector(".toc-toggle")?.setAttribute("aria-expanded", String(on));
	}

	/** A trail step's siblings under its section: the open view is the current page, an earlier step is marked as passed. */
	function stepList(step: Step, hash: string) {
		const all = listOf(step);
		const shown = all.length > RAIL_LIST_MAX ? [step.hash] : all;
		const known = labels(nameOf(step.hash));
		const sub = make("ol");
		for (const h of shown) {
			const text = h === step.hash ? step.label : label(h, known);
			const a = make("a", { href: `#${h}`, title: text }, text);
			a.classList.toggle("is-trail", h === step.hash && h !== hash);
			if (h === hash) {
				a.setAttribute("aria-current", "page");
			}
			sub.append(item(a));
		}
		return sub;
	}

	function updateRail(hash: string) {
		if (!rail) {
			return;
		}
		for (const { li, owns } of entries) {
			for (const old of li.querySelectorAll("ol")) {
				old.remove();
			}
			li.append(
				...steps.filter((s) => owns.includes(nameOf(s.hash))).map((s) => stepList(s, hash)),
			);
		}
		const current = rail.querySelector<HTMLElement>('[aria-current="page"]');
		if (current && rail.scrollHeight > rail.clientHeight) {
			rail.scrollTop = current.offsetTop - rail.clientHeight / 3;
		}
		spy();
	}

	let spyQueued = false;
	function spySoon() {
		if (!spyQueued) {
			spyQueued = true;
			requestAnimationFrame(spy);
		}
	}

	/** In the overview: the last section whose top has passed a third of the window, or the overview link above them all. */
	function spy() {
		spyQueued = false;
		const inView = document.documentElement.classList.contains("in-view");
		const passed = entries
			.filter((e) => e.section.getBoundingClientRect().top < innerHeight / 3)
			.at(-1);
		const here = inView ? null : (passed?.link ?? homeLink);
		for (const a of [homeLink, ...entries.map((e) => e.link)]) {
			a?.removeAttribute("aria-current");
		}
		here?.setAttribute("aria-current", "location");
	}

	const page = overview?.parentElement;
	const hasRail = Boolean(page && overview) && names.size > 1;
	// Set now, before the first paint: the page takes its rail-side width at once.
	document.documentElement.classList.toggle("has-toc", hasRail);
	let started = false;

	return {
		show(view: HTMLElement | null, hash: string) {
			if (!started && hasRail && page && overview) {
				buildRail(page, [...overview.querySelectorAll<HTMLElement>(":scope > section")]);
			}
			started = true;
			if (view) {
				drawn.set(view, hash);
			}
			stamp(view ? hash : "");
			const here = steps.at(-1);
			if (view && here) {
				// Found before the bar is redrawn: the .back link sits beside the new bar, or in the crumbs it is about to replace.
				const back = view.querySelector(".back");
				trailBar(view).replaceChildren(crumbs(here, back), ...neighbours(here));
			}
			updateRail(view ? hash : "");
		},
	};
};
