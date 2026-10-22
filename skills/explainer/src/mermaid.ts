import { renderMermaidSVG, UnreadInputError } from "../vendor/beautiful-mermaid.js";

/** A rendered diagram: one SVG that follows light and dark through the kit's tokens, and the data-ref ids of its parts. */
export interface Diagram {
	svg: string;
	refs: string[];
}

/** The renderer sets node labels at 13 px; drawn 1.2 times larger they read like the page's 16 px text and Mermaid's labels. */
const SCALE = 1.2;

/** What pack does with a supported type beyond drawing it: misrender checks for flowcharts and sequences, `;` as a line break for flowcharts and states. */
type Family = "flowchart" | "state" | "sequence" | "other";

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
 * What to draw instead, per Mermaid type pack cannot render. The kit names are the files `kit <file>` documents. A Map, unlike an
 * object literal, finds nothing for a header such as `constructor`.
 */
const INSTEAD = new Map([
	["pie", "a pie or, better for comparing, a bar chart with kit:charts.js (ECharts)"],
	["gantt", "a horizontal bar chart on a time axis with kit:charts.js, or a table of dates"],
	["timeline", "an ordered list or a table, or a flowchart LR with one node per period"],
	["journey", "a line chart of the scores per step with kit:plot.js or kit:charts.js"],
	["quadrantChart", "a scatter chart with kit:charts.js, with markLine at the two midpoints"],
	["gitGraph", "a flowchart LR with one node per commit and a subgraph per branch"],
	["sankey-beta", "a sankey chart with kit:charts.js"],
	["sankey", "a sankey chart with kit:charts.js"],
	["architecture-beta", "a flowchart with a subgraph per group"],
	["packet-beta", "an HTML table with one column per bit range"],
	["packet", "an HTML table with one column per bit range"],
	["mindmap", "a flowchart LR or a nested list"],
]);

/** The family of the source's header keyword; throws, saying what to draw instead, for a type pack cannot draw. */
function familyOf(body: string): Family {
	const type = /^\S+/.exec(body)?.[0] ?? "";
	const family = SUPPORTED.get(type);
	if (!family) {
		const instead = INSTEAD.get(type);
		throw new Error(
			`"${type}" diagrams are not supported (pack draws ${SUPPORTED_LIST})${instead ? `; draw it as ${instead}` : ""}`,
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

/** A value as the browser's CSS parser reads it: entities, then CSS escapes (`\\75 rl(` is `url(`), decoded. */
const cssValue = (value: string) =>
	value
		.replace(/&#x([\da-f]+);?/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/\\([\da-f]{1,6})[ \t\n]?/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/\\(.)/g, "$1");

/** References out of the diagram in a CSS value or stylesheet: url() and @import targets other than a `#` fragment of the page. */
function cssReferences(text: string): string[] {
	const value = cssValue(text);
	return [
		...[...value.matchAll(/url\(\s*(['"]?)([^'")\s]*)/gi)].map((m) => m[2] ?? ""),
		...[...value.matchAll(/@import\s+(['"]?)([^'";\s]*)/gi)].map((m) => m[2] || "@import"),
	].filter((target) => !target.startsWith("#"));
}

/**
 * Everything in the rendered SVG that points outside the page: a style, classDef or linkStyle value lands in fill and stroke
 * attributes as written, and a remote url() there is a network request the packed page must not make.
 */
function externalReferences(svg: string): string[] {
	const found: string[] = [];
	editMarkup(svg, {
		attribute(name, value) {
			const href = /^(?:xlink:)?href$|^src$/i.test(name) && !value.startsWith("#");
			found.push(...(href ? [value] : []), ...cssReferences(value));
			return value;
		},
		css(text) {
			found.push(...cssReferences(text));
			return text;
		},
	});
	return [...new Set(found)];
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

/**
 * Makes the renderer's standalone SVG fit inline in a page: drops its stylesheet (a remote font @import and page-wide
 * `svg`/`text` rules; theme.css maps the renderer's variables instead), prefixes its ids so markers of two diagrams do not
 * clash, scopes the xychart stylesheet to this diagram and draws its series in the kit palette, and lets the diagram shrink
 * to the column (at most SCALE times its size). Only attributes and stylesheets change: a label reads as written.
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
		/^<svg ([^>]*?)width="([\d.]+)" height="[\d.]+" style="[^"]*"/,
		(_, attrs: string, width: string) =>
			`<svg id="${id}" ${attrs}width="100%" style="max-width: ${Math.ceil(Number(width) * SCALE)}px"`,
	);
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

	// Mermaid reads ";" as a line break in flowcharts and state diagrams; elsewhere it can be message or label text.
	const text = family === "flowchart" || family === "state" ? statements : body;
	const raw = renderMermaidSVG(text, { transparent: true, padding: 12, font: "Geist" });
	const svg = annotateParts(inline(raw, `mm${n}`));
	const remote = externalReferences(svg);
	if (remote.length) {
		throw new Error(
			`the diagram references ${remote.join(", ")}; a packed page loads nothing, so give style, classDef and linkStyle colours (fill:#e33) or kit tokens (fill:var(--accent))`,
		);
	}
	return { svg, refs: [...svg.matchAll(/ data-ref="([^"]*)"/g)].map((m) => m[1] ?? "") };
}

/**
 * Renders one Mermaid source to one inline SVG, with no browser: beautiful-mermaid parses and lays it out (ELK) in this process,
 * estimating text widths. `n`, the block's place on the page, keeps its ids apart from the other diagrams. A source that fails,
 * or whose type is not supported, returns an Error whose message tells the author what to write instead.
 * Every part carries the data-ref of its Mermaid id (see annotateParts), and colours come from the kit's tokens (theme.css).
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
