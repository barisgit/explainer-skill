import { renderMermaidSVG, UnreadInputError } from "../vendor/beautiful-mermaid.js";

/**
 * A rendered diagram: its SVG, which follows light and dark through the kit's tokens; for a wide flowchart or state diagram the
 * copy phones show instead (svg[data-phone], placed right after it: see phoneLayout); and the data-ref ids of its parts, which
 * both copies carry.
 */
export interface Diagram {
	svg: string;
	phone?: string | undefined;
	refs: string[];
}

/** The renderer sets node labels at 13 px; drawn 1.2 times larger they read like the page's 16 px text and Mermaid's labels. */
const SCALE = 1.2;
/** A diagram shrinks with its column until its smallest text is this size in px; in a narrower column it scrolls sideways. */
export const READABLE_PX = 10;
/** The width a diagram block gives its SVG on a 390 px phone: the viewport less the page's and the block's 16 px insets. */
const PHONE_COLUMN_PX = 326;

/** What pack does with a supported type beyond drawing it: misrender checks for flowcharts and sequences, and see `flows`. */
type Family = "flowchart" | "state" | "sequence" | "other";

/** Flowcharts and state diagrams: Mermaid reads `;` in them as a line break, and they can be laid out across their direction. */
const flows = (family: Family) => family === "flowchart" || family === "state";

/** The header keywords pack draws, with their family. */
const SUPPORTED = new Map<string, Family>([
	["flowchart", "flowchart"],
	["graph", "flowchart"],
	["stateDiagram", "state"],
	["stateDiagram-v2", "state"],
	["sequenceDiagram", "sequence"],
	["classDiagram", "other"],
	["erDiagram", "other"],
	["xychart", "other"],
	["xychart-beta", "other"],
]);

/** SUPPORTED as the author is told it: the older stateDiagram and xychart headers still draw but are not advertised. */
const SUPPORTED_LIST =
	"flowchart (graph), stateDiagram-v2, sequenceDiagram, classDiagram, erDiagram, xychart-beta";

/**
 * What to draw instead, per Mermaid type pack cannot render. The kit names are the components `kit <Name>` documents. A Map, unlike
 * an object literal, finds nothing for a header such as `constructor`.
 */
const INSTEAD = new Map([
	["pie", "a pie or, better for comparing, a bar chart with the kit's Chart (ECharts)"],
	["gantt", "a horizontal bar chart on a time axis with the kit's Chart, or a table of dates"],
	["timeline", "an ordered list or a table, or a flowchart LR with one node per period"],
	["journey", "a line chart of the scores per step with the kit's Plot or Chart"],
	["quadrantChart", "a scatter chart with the kit's Chart, with markLine at the two midpoints"],
	["gitGraph", "a flowchart LR with one node per commit and a subgraph per branch"],
	["sankey-beta", "a sankey chart with the kit's Chart"],
	["sankey", "a sankey chart with the kit's Chart"],
	["architecture-beta", "a flowchart with a subgraph per group"],
	["packet-beta", "a table with one column per bit range"],
	["packet", "a table with one column per bit range"],
	["mindmap", "a flowchart LR or a nested list"],
	["block-beta", "a flowchart with a subgraph per block group, or a CSS grid of boxes"],
	["block", "a flowchart with a subgraph per block group, or a CSS grid of boxes"],
]);
/** What to draw instead of a type INSTEAD does not name. */
const INSTEAD_OTHERWISE = "a flowchart for parts and links, or the kit's Chart for numbers";

/** The family of the source's header keyword; throws, saying what to draw instead, for a type pack cannot draw. */
function familyOf(body: string): Family {
	const type = /^\S+/.exec(body)?.[0] ?? "";
	const family = SUPPORTED.get(type);
	if (!family) {
		throw new Error(
			`"${type}" diagrams are not supported (pack draws ${SUPPORTED_LIST}); draw it as ${INSTEAD.get(type) ?? INSTEAD_OTHERWISE}`,
		);
	}
	return family;
}

/** The source without front matter and `%%` comment lines; the header keyword is the first word left. */
function stripPreamble(source: string): string {
	return source
		.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, "")
		.split("\n")
		.filter((line) => !line.trim().startsWith("%%"))
		.join("\n")
		.trim();
}

/** Mermaid's `;` statement separator, outside quoted labels, as a new line: the renderer reads one statement per line. */
function splitStatements(source: string): string {
	let quoted = false;
	let out = "";
	for (const ch of source) {
		quoted = ch === '"' ? !quoted : quoted;
		out += ch === ";" && !quoted ? "\n" : ch;
	}
	return out;
}

/** A flowchart link (`-->`, `---`, `-.->`, `==>`, `--x`, `<-->`), with its optional `|label|`. */
const LINK = String.raw`<?(?:-{2,}|={2,}|-\.+-)[->ox]?(?:\|[^|]*\|)?`;
const NO_TARGET = new RegExp(`${LINK}\\s*$`);
const NO_SOURCE = new RegExp(`^\\s*${LINK}`);
/** A sequence message: sender, arrow (`->>`, `-->`, `-x`, `-)` and their dashed forms), receiver with an optional activation sign, text. */
const MESSAGE = /^([^:]*?)\s*(--?>>|--?>|--?x|--?\))\s*([+-]?)([^:]*?)\s*(:.*)?$/;

/**
 * Statements the renderer draws wrong without an error, each with what to write instead: a markdown string (it prints the
 * backticks), a link missing an end (it drops the arrow), a message missing a participant (it invents one named after the arrow).
 */
const MISRENDERS: Array<(family: Family, line: string) => string | undefined> = [
	(_, line) =>
		line.includes('"`')
			? 'markdown strings ("`...`") are not supported; drop the backticks: a["**bold** and *italic*"] still renders'
			: undefined,
	(family, line) =>
		family === "flowchart" && NO_TARGET.test(line)
			? `"${line}" has no target node; write it as "${line} next", naming the node it points to`
			: undefined,
	(family, line) =>
		family === "flowchart" && NO_SOURCE.test(line)
			? `"${line}" has no source node; write it as "prev ${line}", naming the node it starts from`
			: undefined,
	(family, line) => {
		const [, from, arrow, sign, to, text = ""] =
			(family === "sequence" && MESSAGE.exec(line)) || [];
		return arrow && !(from && to)
			? `"${line}" is missing a participant; write it as "${from || "A"}${arrow}${sign}${to || "B"}${text}", sender before the arrow and receiver after`
			: undefined;
	},
];

/** What to write instead of input the renderer does not read, by what the unread part starts with; else UNREAD_DEFAULT. */
const UNREAD_HINTS: Array<[RegExp, string]> = [
	[
		/^<?[-=.]+[xo]\b|^[xo][-=.]/,
		'cross and circle ends (--x, --o) are not drawn; write "-->" and say what the end means in the label: a -->|stops| b',
	],
	[
		/^(?:de)?activate\s/,
		'activate and deactivate lines work right after a message to (or from) that participant, or mark the message: "A->>+B" starts B\'s bar, "B-->>-A" ends it',
	],
];
const UNREAD_DEFAULT =
	"pack draws a subset of Mermaid: leave it out, or say it with the nodes, edges and labels it reads";

/** The author's message for input the renderer's parser left unread: what it is, and what to write instead. */
function unreadMessage({ unread, line }: UnreadInputError): string {
	const hint = UNREAD_HINTS.find(([pattern]) => pattern.test(unread))?.[1] ?? UNREAD_DEFAULT;
	return `pack cannot read "${unread}"${unread === line ? "" : ` in "${line}"`}; ${hint}`;
}

/** The first misrender among the statements after the header, as its message. */
function firstMisrender(family: Family, statements: string[]): string | undefined {
	for (const statement of statements) {
		const line = statement.trim();
		for (const check of MISRENDERS) {
			const problem = check(family, line);
			if (problem) {
				return problem;
			}
		}
	}
	return undefined;
}

/**
 * data-ref on nodes, groups, classes, entities and participants (their id), edges and their labels (the edge id the parser
 * gives both: the author's `e1@`, else `L_<from>_<to>_<n>`), lifelines (their participant) and messages (m1, m2, ...).
 */
function annotateParts(svg: string): string {
	let message = 0;
	return svg
		.replace(
			/<(?:g|polyline) class="(?:node|subgraph|class-node|entity|actor|edge|edge-label)" data-id="([^"]*)"/g,
			(tag, id: string) => `${tag} data-ref="${id}"`,
		)
		.replace(
			/<line class="lifeline" data-actor="([^"]*)"/g,
			(tag, id: string) => `${tag} data-ref="${id}"`,
		)
		.replace(/<g class="message"/g, (tag) => `${tag} data-ref="m${++message}"`);
}

/**
 * The renderer's markup as stylesheets, tags and text. Its text and attribute values are escaped, so a raw `<` only opens a tag
 * and a `"` only ends a value: attributes and CSS can be read and edited without touching the labels.
 */
const MARKUP = /<style\b[^>]*>[\s\S]*?<\/style>|<[^>]*>|[^<]+/g;
const STYLESHEET = /^(<style\b[^>]*>)([\s\S]*?)(<\/style>)$/;
const ATTRIBUTE = /(\s)([\w:-]+)="([^"]*)"/g;

/**
 * Each attribute value and stylesheet of the markup, through `attribute` and `css`. Text content and data-* attributes (the
 * renderer copies labels into data-label) stay as written: they are text, never fetched or styled.
 */
function editMarkup(
	svg: string,
	{
		attribute = (_name, value) => value,
		css = (text) => text,
	}: { attribute?: (name: string, value: string) => string; css?: (text: string) => string },
): string {
	const editTag = (tag: string) =>
		tag.replace(ATTRIBUTE, (whole: string, space: string, name: string, value: string) =>
			name.startsWith("data-") ? whole : `${space}${name}="${attribute(name, value)}"`,
		);
	return svg.replace(MARKUP, (part) => {
		const [, open = "", text = "", close = ""] = STYLESHEET.exec(part) ?? [];
		if (open) {
			return `${editTag(open)}${css(text)}${close}`;
		}
		return part.startsWith("<") ? editTag(part) : part;
	});
}

/** `url(#x)` pointing at the diagram's own `x`, whose id inline() prefixed. */
const localUrls = (value: string, id: string) =>
	value.replace(/url\(#([^)]+)\)/g, `url(#${id}-$1)`);

/**
 * A stylesheet whose every selector, in comma lists too, applies inside `#id` only: `svg` becomes the diagram's root, any
 * other selector its descendant. The renderer's sheets are flat rule lists (no at-rules or nesting), which this relies on.
 */
const scopeRules = (css: string, id: string) =>
	css.replace(/(^|[{}])([^{}]+)\{/g, (_, before: string, selectors: string) => {
		const scoped = selectors
			.split(",")
			.map((selector) =>
				selector.trim().replace(/^svg\b|^/, (root) => (root ? `#${id}` : `#${id} `)),
			);
		return `${before}\n  ${scoped.join(", ")} {`;
	});

/** The renderer's drawn width of `svg`, in px. */
const drawnWidth = (svg: string) => Number(/^<svg [^>]*?width="([\d.]+)"/.exec(svg)?.[1]);

/** The width at which the smallest text of `svg` (an attribute or stylesheet font size) shows at READABLE_PX; 0 with no text. */
function readableWidth(svg: string): number {
	const sizes = [...svg.matchAll(/font-size(?:="|:\s*)([\d.]+)/g)].map((m) => Number(m[1]));
	return (drawnWidth(svg) * READABLE_PX) / Math.min(...sizes);
}

/**
 * The width limits theme.css reads from a diagram's custom properties: at most SCALE times its drawn size, and at least the
 * width that keeps its smallest text readable (never more than the most), below which its block scrolls sideways. Custom
 * properties rather than an inline max-width, so one page rule on `.mermaid > svg` can still size it.
 */
function sizeStyle(svg: string): string {
	const most = Math.ceil(drawnWidth(svg) * SCALE);
	return `--mermaid-max: ${most}px; --mermaid-min: ${Math.min(most, Math.ceil(readableWidth(svg)))}px`;
}

/**
 * Makes the renderer's standalone SVG fit inline in a page: drops its stylesheet (a remote font @import and page-wide
 * `svg`/`text` rules; theme.css maps the renderer's variables instead), prefixes its ids so markers of two diagrams do not
 * clash, scopes the xychart stylesheet to this diagram and draws its series in the kit palette, and lets the diagram shrink
 * with the column within sizeStyle's limits. Only attributes and stylesheets change: a label reads as written.
 */
function inline(svg: string, id: string): string {
	return editMarkup(svg.replace(/<style>\s*@import[\s\S]*?<\/style>\n?/, ""), {
		attribute: (name, value) => (name === "id" ? `${id}-${value}` : localUrls(value, id)),
		css: (text) =>
			scopeRules(localUrls(text, id), id).replace(
				/--xychart-color-(\d+): [^;]+;/g,
				(_, n: string) => `--xychart-color-${n}: var(--c${(Number(n) % 6) + 1});`,
			),
	}).replace(
		/^<svg ([^>]*?)width="[\d.]+" height="[\d.]+" style="[^"]*"/,
		(_, attrs: string) => `<svg id="${id}" ${attrs}width="100%" style="${sizeStyle(svg)}"`,
	);
}

/**
 * The copy of a flowchart or state diagram that phones show instead (theme.css): the source laid out across its direction (LR
 * as top-down, TD as left to right), when the diagram would scroll sideways on a phone and the copy is narrower. Phones then
 * read a left-to-right flow top-down, while wide screens keep the shorter left-to-right layout. Undefined otherwise.
 */
function phoneLayout(
	family: Family,
	svg: string,
	draw: (transpose: boolean) => string,
): string | undefined {
	const needed = readableWidth(svg);
	if (!flows(family) || needed <= PHONE_COLUMN_PX) {
		return undefined;
	}
	const across = draw(true);
	return readableWidth(across) < needed ? across : undefined;
}

/** Renders one source; `n` keeps its ids apart from the page's other diagrams. Throws with a message for the author. */
function renderOne(source: string, n: number): Diagram {
	const body = stripPreamble(source);
	const family = familyOf(body);
	const statements = splitStatements(body);
	const problem = firstMisrender(family, statements.split("\n").slice(1));
	if (problem) {
		throw new Error(problem);
	}

	// Elsewhere ";" can be message or label text.
	const text = flows(family) ? statements : body;
	const draw = (transpose: boolean) =>
		renderMermaidSVG(text, { transparent: true, padding: 12, font: "Geist", transpose });
	const raw = draw(false);
	const across = phoneLayout(family, raw, draw);

	const svg = annotateParts(inline(raw, `mm${n}`));
	const phone =
		across && annotateParts(inline(across, `mm${n}-phone`)).replace(/^<svg /, "<svg data-phone ");
	const refs = [svg, phone ?? ""].flatMap((copy) =>
		[...copy.matchAll(/ data-ref="([^"]*)"/g)].map((m) => m[1] ?? ""),
	);
	return { svg, phone, refs: [...new Set(refs)] };
}

/**
 * Renders one Mermaid source to one inline SVG, plus a phone copy for a wide flowchart or state diagram (phoneLayout), with no
 * browser: beautiful-mermaid parses and lays it out (ELK) in this process, estimating text widths. `n`, the block's place on
 * the page, keeps its ids apart from the other diagrams. A source that fails, or whose type is not supported, returns an Error
 * whose message tells the author what to write instead. Every part carries the data-ref of its Mermaid id (see annotateParts),
 * and colours come from the kit's tokens (theme.css).
 */
export function renderMermaid(source: string, n = 0): Diagram | Error {
	try {
		return renderOne(source, n);
	} catch (e) {
		if (e instanceof UnreadInputError) {
			return new Error(unreadMessage(e));
		}
		return e instanceof Error ? e : new Error(String(e));
	}
}
