/**
 * Ids written on more than one element of a page. The browser, a script's getElementById, a label's `for`, a `#id` link and a
 * `check --do` step all take the first such element and never reach the others, so pack refuses the page and names where each
 * one is. Ids pack writes itself stay unique: Mermaid diagrams prefix theirs per diagram, and the dark copy of a themed SVG
 * image drops its id.
 */
import { unescapeHtml } from "./escape.ts";

/** One element carrying an id: its start tag, reduced to what tells it apart, and the heading it comes after. */
export interface IdUse {
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

/** Every non-empty id of `html`, with the elements that carry it in page order. */
export async function idUses(html: string): Promise<Map<string, IdUse[]>> {
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
	return uses;
}

/**
 * The line for the author about one repeated id: the id, each element with the heading it follows, and what to change. A
 * Question's option ids are its name and value, so a repeated id on a named input says so.
 */
function idProblem(id: string, uses: IdUse[]): string {
	const where = uses.map(({ tag, under }) => (under ? `${tag} under "${under}"` : tag));
	const question = uses.some(({ tag }) => /^<input [^>]*name="/.test(tag))
		? " (a Question's option ids are its name and value, so give each Question its own name)"
		: "";
	return `the id "${id}" is on ${uses.length} elements: ${where.join(", ")}. A script, a label's for, a #link and a check --do step find only the first: give each its own id${question}`;
}

/** One line per id on more than one element of `html`. */
export async function repeatedIdProblems(html: string): Promise<string[]> {
	return [...(await idUses(html))]
		.filter(([, uses]) => uses.length > 1)
		.map(([id, uses]) => idProblem(id, uses));
}

/**
 * One line per id that `record`, the markup a filled View draws for `place` (`#item/t1`), puts on more than one element of the
 * page while it is open: twice in itself, or once more beside an element of `page` (idUses of the page, which always holds
 * them). Records show one at a time, so one record's ids are never compared with another's.
 */
export async function recordIdProblems(
	page: Map<string, IdUse[]>,
	record: string,
	place: string,
): Promise<string[]> {
	return [...(await idUses(record))].flatMap(([id, uses]) => {
		const all = [...(page.get(id) ?? []), ...uses];
		return all.length > 1 ? [`${place}: ${idProblem(id, all)}`] : [];
	});
}
