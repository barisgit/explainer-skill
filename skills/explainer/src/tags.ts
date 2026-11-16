/**
 * Mentions of a diagram's number tags. A phrasing element (a span, b, a, ...) outside every SVG that carries one tagged ref and
 * says that part's number (`<span data-ref="inv">2</span>` for `tag:inv=2`) is drawn as the tag: pack writes data-tag on it,
 * which theme.css rings. One that says another number of 1 to 3 digits is a warning, since a renumbered drawing leaves its
 * mentions behind. A cell, row or other block keeps its layout and is never ringed: a linked number in a table is data unless
 * the author puts the span inside the cell.
 */

/** The elements a mention may be: inline text, never a box whose layout a ring would change. */
const PHRASING = new Set(
	"a abbr b bdi bdo cite code data dfn em i kbd mark q s samp small span strong sub sup time u var".split(
		" ",
	),
);

/** One `[data-ref]` element outside every SVG, in document order: its refs and the text in it. */
interface Mention {
	refs: string[];
	text: string;
}

/** A rewriter that calls `visit` for each `[data-ref]` element outside every SVG, in document order. */
function refsOutsideSvg(visit: (el: HTMLRewriterTypes.Element) => void): HTMLRewriter {
	let svgDepth = 0;
	return new HTMLRewriter()
		.on("svg", {
			element(el) {
				svgDepth++;
				el.onEndTag(() => {
					svgDepth--;
				});
			},
		})
		.on("[data-ref]", {
			element(el) {
				if (!svgDepth) {
					visit(el);
				}
			},
		});
}

/** The `[data-ref]` elements of `html` outside every SVG, in document order, with their text. */
async function mentionsIn(html: string): Promise<Mention[]> {
	const mentions: Mention[] = [];
	const open = new Set<Mention>();
	await refsOutsideSvg((el) => {
		const mention = {
			refs: PHRASING.has(el.tagName) ? (el.getAttribute("data-ref") ?? "").split(/\s+/) : [],
			text: "",
		};
		mentions.push(mention);
		if (el.canHaveContent) {
			open.add(mention);
			el.onEndTag(() => {
				open.delete(mention);
			});
		}
	})
		.onDocument({
			text(chunk) {
				for (const mention of open) {
					mention.text += chunk.text;
				}
			},
		})
		.transform(new Response(html))
		.text();
	return mentions;
}

/**
 * `html` with data-tag on each mention that says its part's tag (`tags`, by ref), and a warning for each that says another
 * number.
 */
export async function markTagMentions(
	html: string,
	tags: Map<string, string>,
): Promise<{ html: string; warnings: string[] }> {
	if (!tags.size) {
		return { html, warnings: [] };
	}
	const warnings: string[] = [];
	const marked = (await mentionsIn(html)).map(({ refs, text }) => {
		const [ref = ""] = refs;
		const tag = refs.length === 1 ? tags.get(ref) : undefined;
		const said = text.trim();
		if (tag && /^\d{1,3}$/.test(said) && said !== tag) {
			warnings.push(`data-ref="${ref}" says ${said}, but its drawing tags it ${tag}`);
		}
		return said === tag;
	});
	let n = 0;
	const out = await refsOutsideSvg((el) => {
		if (marked[n++]) {
			el.setAttribute("data-tag", "");
		}
	})
		.transform(new Response(html))
		.text();
	return { html: out, warnings };
}
