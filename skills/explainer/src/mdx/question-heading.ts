import { unescapeHtml } from "../escape.ts";

/** The Question a legendless fieldset's marker names, for a message. */
const MARKER = /<fieldset\b[^>]*\bdata-legend-from-heading="([^"]*)"/g;

/**
 * The problems with legendless Questions in a record drawn for a filled View: the browser draws a record again, where no
 * heading can be found, so such a Question needs its legend.
 */
export const recordHeadingProblems = (record: string, place: string): string[] =>
	[...record.matchAll(MARKER)].map(
		([, name]) =>
			`${place}: <Question name="${name}"> has no legend, and a record is drawn in the browser where no heading can be found: write legend="..."`,
	);

/**
 * Names each `<fieldset data-legend-from-heading="name">` a Question drew without a legend after the nearest heading (`h2` to
 * `h6`, never the page's `h1`) before it in its own section (`aria-label`, which the reply reads as it reads a legend), and
 * its note field after it too, then drops the marker. A section neither lends its heading to the sections inside it nor takes
 * one from them. Returns the HTML, and a message for each such question with no heading to take.
 */
export async function nameFromHeadings(
	html: string,
): Promise<{ html: string; problems: string[] }> {
	const problems: string[] = [];
	/** The heading of each open section, innermost last; the first entry is the part of the page outside any section. */
	const headings: (string | undefined)[] = [undefined];
	let reading: string | undefined;
	let named: string | undefined;
	const out = await new HTMLRewriter()
		.on("section", {
			element(el) {
				headings.push(undefined);
				el.onEndTag(() => void headings.pop());
			},
		})
		.on("h2, h3, h4, h5, h6", {
			element(el) {
				reading = "";
				el.onEndTag(() => {
					headings[headings.length - 1] = reading?.trim() || undefined;
					reading = undefined;
				});
			},
			text(chunk) {
				reading = reading === undefined ? reading : reading + unescapeHtml(chunk.text);
			},
		})
		.on("fieldset[data-legend-from-heading]", {
			element(el) {
				const name = el.getAttribute("data-legend-from-heading") ?? "";
				const heading = headings[headings.length - 1];
				el.removeAttribute("data-legend-from-heading");
				if (heading === undefined) {
					problems.push(
						`<Question name="${name}"> has no legend and no heading before it: write legend="...", or put it under the heading that asks the question`,
					);
					return;
				}
				el.setAttribute("aria-label", heading);
				named = heading;
				el.onEndTag(() => {
					named = undefined;
				});
			},
		})
		.on("fieldset input[data-note]", {
			element(el) {
				if (named !== undefined) {
					el.setAttribute("aria-label", `${el.getAttribute("aria-label") ?? ""}: ${named}`);
				}
			},
		})
		.transform(new Response(html))
		.text();
	return { html: out, problems };
}
