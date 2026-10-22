/** What a check run forces on every load: the colour scheme and whether the reader asked for reduced motion. */
export interface Settings {
	scheme: "light" | "dark";
	reduceMotion: boolean;
}

/** One thing the probe saw in the page; `take()` hands them to the host. */
export type Seen =
	| { kind: "error" | "rejection"; text: string; stack: string; line: number; col: number }
	| { kind: "resource"; tag: string; url: string }
	| { kind: "network"; url: string };

/**
 * `query` with its prefers-color-scheme and prefers-reduced-motion features answered for `settings`: each becomes a width test that is
 * true or false everywhere. It runs on the host for the page's inline stylesheets and in the page for `matchMedia` (it is plain
 * JavaScript apart from the annotations, which Bun strips, so the probe embeds its source).
 */
function forceMedia(query: string, settings: Settings): string {
	const answer = (yes: boolean) => (yes ? "(min-width: 0px)" : "(min-width: 100000px)");
	return query
		.replace(/\(prefers-color-scheme:\s*(light|dark)\)/g, (_, scheme) =>
			answer(scheme === settings.scheme),
		)
		.replace(/\(prefers-reduced-motion:\s*(reduce|no-preference)\)/g, (_, motion) =>
			answer((motion === "reduce") === settings.reduceMotion),
		);
}

/**
 * Page-side script, injected as the first thing in `<head>` so it runs before any page code. It uses no engine-specific API,
 * so it behaves the same in WebKit and Blink:
 * - records window errors, unhandled rejections, failed resource loads and CSP violations for `window.__explainer.take()`;
 * - empties local and session storage on every load except a reload;
 * - forces the colour scheme and reduced motion for `matchMedia` and sets `data-scheme` on <html> unless the page set one (the media
 *   rules of inline stylesheets are rewritten by `instrument`: changing them from the page makes WebKit drop the first chart mount);
 * - hides scrollbars, so layout at 1440 px is 1440 px wide.
 * Statements end in semicolons: `instrument` joins the lines, because the injection must not add a line to the page.
 */
const PROBE_JS = (settings: Settings) => `(() => {
	const S = ${JSON.stringify(settings)};
	const seen = [];
	const add = (r) => seen.push(r);
	window.__explainer = { take: () => seen.splice(0) };
	try { if (performance.getEntriesByType("navigation")[0]?.type !== "reload") { localStorage.clear(); sessionStorage.clear(); } } catch (e) {}
	addEventListener("error", (e) => {
		const t = e.target;
		if (t && t !== window) add({ kind: "resource", tag: t.localName, url: t.currentSrc || t.src || t.href || "" });
		else add({ kind: "error", text: e.error ? String(e.error) : e.message, stack: (e.error && e.error.stack) || "", line: e.lineno, col: e.colno });
	}, true);
	addEventListener("unhandledrejection", (e) => add({ kind: "rejection", text: "Uncaught (in promise) " + String(e.reason), stack: (e.reason && e.reason.stack) || "", line: 0, col: 0 }));
	document.addEventListener("securitypolicyviolation", (e) => add({ kind: "network", url: e.blockedURI }));
	document.documentElement.dataset.scheme ||= S.scheme;
	const force = ${forceMedia.toString()};
	const matchMedia = window.matchMedia.bind(window);
	window.matchMedia = (q) => matchMedia(force(q, S));
	const hide = document.createElement("style");
	hide.textContent = "html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }";
	document.head.append(hide);
})();`;

/**
 * Blocks every request except inline content, `data:` and `blob:` (the page is a single file, so there is nothing else to load),
 * and reports each one as a `securitypolicyviolation`. This is how a page with a network dependency fails the check.
 */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src data: blob: 'unsafe-inline' 'unsafe-eval'">`;

/** The page with the probe in it, and where the injection went so the page's own positions can be mapped back. */
export interface Instrumented {
	html: string;
	/** 1-based line and column in the original where the injected text starts, and its length (it contains no newline). */
	line: number;
	col: number;
	length: number;
}

/**
 * Answers the media queries of inline stylesheets for `settings`, and puts the CSP and the probe on one line right after `<head>` (else after the doctype, else first), so every page line number is the
 * original's and only columns after the insertion point on that one line move.
 */
export function instrument(source: string, settings: Settings): Instrumented {
	const html = source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (style) =>
		forceMedia(style, settings),
	);
	const injected = `${CSP}<script>${PROBE_JS(settings).replace(/\n\s*/g, " ")}</script>`;
	const anchor = /<head(\s[^>]*)?>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
	const at = anchor ? anchor.index + anchor[0].length : 0;
	const lines = html.slice(0, at).split("\n");
	return {
		html: html.slice(0, at) + injected + html.slice(at),
		line: lines.length,
		col: (lines.at(-1)?.length ?? 0) + 1,
		length: injected.length,
	};
}
