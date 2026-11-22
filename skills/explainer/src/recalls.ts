/**
 * Recalls (kit Recall) as pack places them. A Recall renders its text inside `<explainer-recall data-id>`, and each Term a
 * `button[data-recall]` followed by an empty `span.recall[data-recall-text]`. This pass takes every Recall's text out of the
 * prerendered page and writes it into the box after each of its mentions (after the closing punctuation that follows the term),
 * so the page holds every reminder without scripts, marks the box of each Recall's first mention `data-first` (what a printout
 * shows), and names what the author must fix: a mention of no Recall, in a heading, inside a link or holding one, and a Recall
 * written twice, without an id, empty, or holding what cannot sit inside a sentence.
 */
import { unescapeHtml } from "./escape.ts";

/**
 * One Recall as written: its id (none when the author gave none) and its text. Read in one pass, so an id and its text come
 * from the same element.
 */
const DEFINITION = /<explainer-recall(?: data-id="([^"]*)")?>([\s\S]*?)<\/explainer-recall>/g;

/** A heading and its text, which a Recall's problems name it by. */
const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g;

/** The elements a reminder's text may hold: phrasing content, since its box sits inside a sentence (math is read whole). */
const PHRASING = new Set(
	"a abbr b bdi bdo br cite code data del dfn em i img ins kbd mark math q s samp small span strong sub sup time u var wbr".split(
		" ",
	),
);

/** Closing tags of phrasing elements (math and void ones aside) between a box and the punctuation that ends its term's phrase. */
const CLOSERS = `(?:<\\/(?:${[...PHRASING].filter((tag) => !["br", "img", "math", "wbr"].includes(tag)).join("|")})>)*`;

/** Script text and comments, where marker-shaped text is not markup. */
const OPAQUE = /<script\b[\s\S]*?<\/script>|<!--[\s\S]*?-->/g;

/**
 * An empty box with the closing punctuation of the phrase right after it: the punctuation goes before the box, beside its term,
 * so an open reminder never starts the next line with ", and so".
 */
const BOX_THEN_PUNCTUATION = new RegExp(
	`(<span class="recall" data-recall-text="[^"]*"></span>)(${CLOSERS})([,.;:!?)\\]}»”’…]+)`,
	"g",
);

/** Elements a Term's button must not sit in or hold: interactive content. */
const INTERACTIVE = "a, button, input, label, select, textarea";

/** A script's source that renders a Term or Recall: its markup as compiled code writes it. */
const IN_CODE = /["'`](?:data-recall|explainer-recall)["'`]/;

/** A heading's text chunks as one line. */
const spoken = (parts: string[]) => unescapeHtml(parts.join("")).replace(/\s+/g, " ").trim();

const under = (heading: string | undefined) => (heading ? ` under "${heading}"` : "");

/** The first element `text` holds that cannot sit inside a sentence, or the problem that it is not text at all. */
function notPhrasing(id: string, text: string): string | undefined {
	if (text.includes("<explainer-recall")) {
		return `<Recall id="${id}"> holds another <Recall>: write each Recall on its own`;
	}
	if (/data-recall=/.test(text)) {
		return `<Recall id="${id}"> mentions a <Term>: a reminder opens inside a sentence and cannot open another; write that term as plain text`;
	}
	if (text.includes("<!--island:")) {
		return `<Recall id="${id}"> holds a client component: its text is copied to every mention, so write it as text`;
	}
	const outsideMath = text.replace(/<math\b[\s\S]*?<\/math>/g, "<math>");
	const block = [...outsideMath.matchAll(/<([a-zA-Z][\w-]*)/g)]
		.map((m) => (m[1] ?? "").toLowerCase())
		.find((tag) => !PHRASING.has(tag));
	return block
		? `<Recall id="${id}"> holds a <${block}>, but it opens inside a sentence: write it as one short paragraph (inline math and links are fine)`
		: undefined;
}

/** What one Recall's text is, or the problem with it. */
function definitionText(id: string, raw: string): { text: string } | { problem: string } {
	const trimmed = raw.trim();
	const lone = /^<p>([\s\S]*)<\/p>$/.exec(trimmed);
	const text = lone && !lone[1]?.includes("<p>") ? (lone[1] ?? "") : trimmed;
	const problem = notPhrasing(id, text);
	if (problem) {
		return { problem };
	}
	const words = unescapeHtml(text.replace(/<[^>]*>/g, "")).trim();
	return words || /<(?:img|math)\b/.test(text)
		? { text }
		: { problem: `<Recall id="${id}"> is empty: write the reminder inside it` };
}

/** Follows the headings `rewriter` reads: the last heading ended, and whether one is open now. */
function headings(rewriter: HTMLRewriter) {
	const state: { last: string | undefined; open: string[] | undefined } = {
		last: undefined,
		open: undefined,
	};
	rewriter.on("h1, h2, h3, h4, h5, h6", {
		element(el) {
			const parts: string[] = [];
			state.open = parts;
			el.onEndTag(() => {
				state.last = spoken(parts) || state.last;
				state.open = undefined;
			});
		},
		text(chunk) {
			state.open?.push(chunk.text);
		},
	});
	return state;
}

/** Every Recall with the heading it is under, in page order, and the page without them. */
function takeDefinitions(html: string): { out: string; found: Written[] } {
	const headingEnds = [...html.matchAll(HEADING)].map((m) => ({
		end: m.index + m[0].length,
		text: spoken([(m[2] ?? "").replace(/<[^>]*>/g, "")]),
	}));
	const opaque = [...html.matchAll(OPAQUE)].map((m) => [m.index, m.index + m[0].length]);
	const elements = [...html.matchAll(DEFINITION)].filter(
		(m) => !opaque.some(([from = 0, to = 0]) => m.index >= from && m.index < to),
	);
	const found = elements.map(
		(m): Written => ({
			id: unescapeHtml(m[1] ?? ""),
			raw: m[2] ?? "",
			under: headingEnds.findLast(({ end }) => end <= m.index)?.text || undefined,
		}),
	);
	let out = "";
	let from = 0;
	for (const m of elements) {
		out += html.slice(from, m.index);
		from = m.index + m[0].length;
	}
	return { out: out + html.slice(from), found };
}

/** A Recall as written: its id, the heading it is under, and its text as rendered. */
interface Written {
	id: string;
	under: string | undefined;
	raw: string;
}

/** The problems with the Recalls' ids: one without an id, and one written twice. */
function idProblems(found: Written[]): string[] {
	const places = new Map<string, (string | undefined)[]>();
	for (const { id, under: at } of found) {
		places.set(id, [...(places.get(id) ?? []), at]);
	}
	return [...places].flatMap(([id, at]) => {
		if (!id) {
			return [`a <Recall>${under(at[0])} has no id: give it id="..." for its Terms to name`];
		}
		const where = at.map((h) => (h ? `under "${h}"` : "before the first heading"));
		return at.length > 1
			? [
					`<Recall id="${id}"> is written ${at.length} times (${where.join(", ")}): write it once; every <Term recall="${id}"> opens the same text`,
				]
			: [];
	});
}

/** The Recalls of `found`, by id, and the problems with them: no id, written twice, or a text a sentence cannot hold. */
function readDefinitions(found: Written[]) {
	const texts = new Map<string, string>();
	const problems = idProblems(found);
	for (const { id, raw } of found) {
		const read = id && !texts.has(id) ? definitionText(id, raw) : undefined;
		if (read && "text" in read) {
			texts.set(id, read.text);
		} else if (read) {
			problems.push(read.problem);
		}
	}
	return { texts, problems, ids: [...new Set(found.map(({ id }) => id))].filter(Boolean) };
}

/**
 * Reads each Term's button as `rewriter` passes it: a mention of no Recall, in a heading, inside interactive content or holding
 * some go into `problems`; each heading mention is reported once its heading's text is whole, by `headingProblems`.
 */
function readTerms(rewriter: HTMLRewriter, ids: string[], problems: string[]) {
	const heading = headings(rewriter);
	const inHeadings: { id: string; text: string[] }[] = [];
	const around = { interactive: 0, term: undefined as string | undefined };
	const term = (el: HTMLRewriterTypes.Element, id: string) => {
		const at = under(heading.last);
		if (heading.open) {
			inHeadings.push({ id, text: heading.open });
		} else if (!ids.includes(id)) {
			const known = ids.length
				? `the page's recalls are ${ids.join(", ")}`
				: "the page has no Recall";
			problems.push(
				`<Term recall="${id}">${at} names no Recall (${known}): write <Recall id="${id}">...</Recall> once in the page, or correct the name`,
			);
		}
		if (around.interactive || around.term !== undefined) {
			problems.push(
				`<Term recall="${id}">${at} is inside a link, another control or another Term: a Term is a button of its own, so write it beside the link`,
			);
		}
		const outer = around.term;
		around.term = id;
		el.onEndTag(() => {
			around.term = outer;
		});
	};
	rewriter.on(INTERACTIVE, {
		element(el) {
			const id = el.tagName === "button" ? el.getAttribute("data-recall") : null;
			if (id !== null) {
				term(el, unescapeHtml(id));
				return;
			}
			if (around.term !== undefined) {
				problems.push(
					`<Term recall="${around.term}">${under(heading.last)} holds a <${el.tagName}>: a Term is a button, so write its words as text and the link beside it`,
				);
			}
			if (el.canHaveContent) {
				around.interactive += 1;
				el.onEndTag(() => {
					around.interactive -= 1;
				});
			}
		},
	});
	return () =>
		inHeadings.map(
			({ id, text }) =>
				`<Term recall="${id}"> is in the heading "${spoken(text)}": a heading names its section in the contents rail, so mention the term in the text under it`,
		);
}

/**
 * `html` with every Recall's text moved into the boxes of its mentions (the first one per Recall marked data-first), the
 * problems that fail the pack, and a warning for each Recall no Term mentions.
 */
export async function placeRecalls(
	html: string,
): Promise<{ html: string; problems: string[]; warnings: string[] }> {
	if (!html.includes("<explainer-recall") && !html.includes("data-recall-text")) {
		return { html, problems: [], warnings: [] };
	}
	const { out, found } = takeDefinitions(html);
	const { texts, problems, ids } = readDefinitions(found);
	const mentioned = new Set<string>();
	const rewriter = new HTMLRewriter();
	const headingProblems = readTerms(rewriter, ids, problems);
	const filled = await rewriter
		.on("span.recall[data-recall-text]", {
			element(el) {
				const id = unescapeHtml(el.getAttribute("data-recall-text") ?? "");
				el.removeAttribute("data-recall-text");
				el.setInnerContent(texts.get(id) ?? "", { html: true });
				if (!mentioned.has(id)) {
					mentioned.add(id);
					el.setAttribute("data-first", "");
				}
			},
		})
		.transform(new Response(out.replace(BOX_THEN_PUNCTUATION, "$3$1$2")))
		.text();
	problems.push(...headingProblems());
	const warnings = found
		.filter(({ id }, i) => id && !mentioned.has(id) && found.findIndex((f) => f.id === id) === i)
		.map(
			({ id, under: at }) =>
				`<Recall id="${id}">${under(at)} is never mentioned: mark a mention with <Term recall="${id}">...</Term>, or remove it`,
		);
	return { html: filled, problems, warnings };
}

/** The problem with client code (bundle.ts's clientScan) that renders a Term or Recall, whose text pack must place. */
export const clientRecallProblems = (scan: string): string[] =>
	IN_CODE.test(scan)
		? [
				`a "use client" component renders a <Term> or <Recall>, but pack places a reminder's text when it packs: write them in the page's Markdown (an island's children included)`,
			]
		: [];
