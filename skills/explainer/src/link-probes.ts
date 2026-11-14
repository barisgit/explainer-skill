import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unescapeHtml } from "./escape.ts";
import { ELEMENT_NAME_JS, VIEW_ROUTES_JS } from "./page-js.ts";

const NON_PROSE = "code, pre, script, style, textarea, title";

/** Advisory only: literal link syntax can be deliberate; code markup makes that intent explicit. */
function literalLinks(text: string): string[] {
	return [...text.matchAll(/\[[^\]\n]+\]\([^()\n]+\)/g)].map(
		(match) =>
			`Markdown link stayed literal: ${match[0]}; use <target with spaces> or %20 in the destination, or code for literal syntax`,
	);
}

/** Reads complete rendered text nodes, not parser chunks; nested code and non-reader text are excluded. */
export async function literalLinkWarnings(html: string): Promise<string[]> {
	const warnings: string[] = [];
	const stack: boolean[] = [];
	let text = "";
	const flush = () => {
		if (!stack.at(-1)) {
			warnings.push(...literalLinks(unescapeHtml(text)));
		}
		text = "";
	};
	await new HTMLRewriter()
		.on("*", {
			element(el) {
				flush();
				if (!el.canHaveContent) {
					return;
				}
				stack.push(!!stack.at(-1) || NON_PROSE.split(", ").includes(el.tagName));
				el.onEndTag(() => {
					flush();
					stack.pop();
				});
			},
		})
		.onDocument({
			text(chunk) {
				text += chunk.text;
				if (chunk.lastInTextNode) {
					flush();
				}
			},
		})
		.transform(new Response(html))
		.text();
	return [...new Set(warnings)];
}

/** Navigation findings in the settled DOM, separate from layout probes so each owns its contract. */
export interface LinkReport {
	problems: string[];
	warnings: string[];
	files: { href: string; url: string; locator: string }[];
}

/** All document targets count, including closed details and inactive views; no link is followed. */
export const LINKS_JS = `(() => {
	const name = ${ELEMENT_NAME_JS};
	const literals = ${literalLinks.toString()};
	const route = (${VIEW_ROUTES_JS})([...document.querySelectorAll('[data-view]')].map(el => el.dataset.view));
	const problems = [], warnings = [], files = [];
	const decode = text => { try { return decodeURIComponent(text); } catch { return text; } };
	const records = hash => document.getElementById(decode(hash.split('?')[0]))?.hasAttribute('data-records');
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode, el = node.parentElement;
		if (!el || el.closest(${JSON.stringify(NON_PROSE)})) continue;
		for (const warning of literals(node.textContent)) warnings.push(name(el) + ': ' + warning);
	}
	for (const a of document.querySelectorAll('a[href]')) {
		const href = a.getAttribute('href');
		if (href.startsWith('#')) {
			const hash = href.slice(1);
			if (hash && decode(hash).toLowerCase() !== 'top' && !document.getElementById(decode(hash)) && ![...document.getElementsByName(decode(hash))].some(el => el.tagName === 'A') && !route(hash).name && !records(hash)) {
				problems.push(name(a) + ': missing in-page link target: href="' + href + '"');
			}
		} else if (href && !/^(?:[a-z][a-z0-9+.-]*:|\\/)/i.test(href)) {
			const url = new URL(href, document.baseURI);
			if (url.protocol === 'file:') files.push({href, url: url.href, locator: name(a)});
		}
	}
	return {problems, warnings, files};
})()`;

/** Relative navigation may be distributed beside the export later, so absent files are warnings, not load errors. */
export function missingLinkFiles(files: LinkReport["files"]): string[] {
	return files
		.filter(({ url }) => {
			try {
				return !existsSync(fileURLToPath(url));
			} catch (error) {
				// An invalid URL escape cannot name a readable local file either.
				if (!(error instanceof URIError || error instanceof TypeError)) {
					throw error;
				}
				return true;
			}
		})
		.map(
			({ href, locator }) =>
				`${locator}: relative link target not found beside the page: href="${href}"; distribute it beside the exported HTML or update the link`,
		);
}
