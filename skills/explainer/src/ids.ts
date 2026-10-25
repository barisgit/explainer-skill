/**
 * Ids written on more than one element of a page. The browser, a script's getElementById, a label's `for`, a `#id` link and a
 * `check --do` step all take the first such element and never reach the others, so pack refuses the page and names where each
 * one is. Ids pack writes itself stay unique: Mermaid diagrams prefix theirs per diagram, and the dark copy of a themed SVG
 * image drops its id.
 */
import { unescapeHtml } from "./escape.ts";

/** One element carrying a repeated id: its start tag, reduced to what tells it apart, and the heading it comes after. */
interface IdUse {
	tag: string;
	under: string | undefined;
}

/** `<input type="radio" name="pick" value="a">`: the tag with the attributes that tell such elements apart. */
function describe(el: HTMLRewriterTypes.Element): string {
	const shown = ["type", "name", "value", "class"].flatMap((name) => {
		const value = el.getAttribute(name);
		return value === null ? [] : [` ${name}="${value}"`];
	});
	return `<${el.tagName}${shown.join("")}>`;
}

/** Every non-empty id on more than one element of `html`, with those elements in page order. */
async function repeatedIds(html: string): Promise<Map<string, IdUse[]>> {
	const uses = new Map<string, IdUse[]>();
	let heading: string | undefined;
	let text: string[] = [];
	await new HTMLRewriter()
		.on("h1, h2, h3, h4, h5, h6", {
			element(el) {
				const parts: string[] = [];
				text = parts;
				el.onEndTag(() => {
					heading = unescapeHtml(parts.join("")).replace(/\s+/g, " ").trim() || heading;
				});
			},
			// Text inside the heading's child elements arrives here too.
			text(chunk) {
				text.push(chunk.text);
			},
		})
		.on("[id]", {
			element(el) {
				const id = unescapeHtml(el.getAttribute("id") ?? "");
				if (id) {
					uses.set(id, [...(uses.get(id) ?? []), { tag: describe(el), under: heading }]);
				}
			},
		})
		.transform(new Response(html))
		.text();
	return new Map([...uses].filter(([, list]) => list.length > 1));
}

/**
 * One line per repeated id for the author: the id, each element with the heading it follows, and what to change. A Question's
 * option ids are its name and value, so a repeated id on a named input says so.
 */
export async function repeatedIdProblems(html: string): Promise<string[]> {
	return [...(await repeatedIds(html))].map(([id, uses]) => {
		const where = uses.map(({ tag, under }) => (under ? `${tag} under "${under}"` : tag));
		const question = uses.some(({ tag }) => /^<input [^>]*name="/.test(tag))
			? " (a Question's option ids are its name and value, so give each Question its own name)"
			: "";
		return `the id "${id}" is on ${uses.length} elements: ${where.join(", ")}. A script, a label's for, a #link and a check --do step find only the first: give each its own id${question}`;
	});
}
