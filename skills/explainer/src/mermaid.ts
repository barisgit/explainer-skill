import {
	type FlowEdge,
	type ParsedModel,
	parse,
	render,
	type StateStatement,
} from "../vendor/pele.js";
import { textWidth } from "./geist.ts";
import {
	type Family,
	familyOf,
	flows,
	peleMessage,
	sourceProblem,
	stripPreamble,
} from "./mermaid-input.ts";

/**
 * A rendered diagram: its SVG, which follows light and dark through the kit's tokens; for a wide flowchart or state diagram the
 * copy phones show instead (svg[data-phone], placed right after it: see phoneLayout), which also prints in the SVG's place when
 * it carries data-print (see printAttr); the data-ref ids of its parts, which both copies carry; and the number tags its fence's
 * meta put on nodes, by node id.
 */
export interface Diagram {
	svg: string;
	phone?: string | undefined;
	refs: string[];
	tags: Map<string, string>;
	warnings: string[];
}

/**
 * Node text is laid out at 15 px, so pele's edge labels (7/8 of it) come out at the kit's 13 px label size. A diagram shrinks
 * with its column until its smallest text is READABLE_PX; in a narrower column it scrolls sideways.
 */
const NODE_PX = 15;
/** The smallest text a diagram draws: pele's smaller texts (a sequence block's kind, ER keys, class cardinalities) are raised to it. */
const LABEL_PX = 13;
export const READABLE_PX = 10;
/** The width a diagram block gives its SVG on a 390 px phone: the viewport less the page's and the block's 16 px insets. */
const PHONE_COLUMN_PX = 326;
/**
 * The width a diagram block gives its SVG on A4 paper with Chrome's default margins: the 717 px page box less the page's gutters
 * (4vw each) and the block's 16 px insets. US Letter is wider, so a diagram that fits A4 fits it too.
 */
const PRINT_COLUMN_PX = 627;

/** Geist's advances for pele's text, bold at 600 as the kit draws it; monospace (style bit 4) at the 0.6 em of a mono face. */
const MEASURER = {
	width: (text: string, size: number, style: number) => {
		const px = Math.max(size, LABEL_PX);
		return style & 4 ? text.length * px * 0.6 : textWidth(text, px, style & 1 ? 600 : 400);
	},
};

/** Fixed node paint still draws as written, but cannot follow the reader's scheme. */
function fixedNodePaintWarnings(source: string): string[] {
	return [...source.matchAll(/^[ \t]*(classDef|style)[ \t]+([\w,-]+)[ \t]+(.+)/gm)].flatMap(
		([, statement, target, body = ""]) => {
			const paints = [...body.matchAll(/(?:^|,)\s*(?:fill|stroke|color)\s*:\s*([^,]+)/g)];
			return paints.some(
				([, paint = ""]) => !/^(?:none$|transparent$|currentcolor$)/i.test(paint.trim()),
			)
				? [
						`${statement} "${target}" uses fixed paint; check both themes, or use info, ok, warn or bad`,
					]
				: [];
		},
	);
}

/** The room between a tag's ring and its label, in px. */
const TAG_GAP = 4;

/** One `tag:id=number` of a fence's meta, the number quoted or not. */
const TAG = /^tag:([^\s=]+)=(?:"([^"]*)"|'([^']*)'|(\S*))$/;

/**
 * The number tags a fence's meta puts on nodes, by node id. Throws, saying what to write, for anything else in the meta, a tag
 * that is not 1 to 3 digits, one node with two numbers or one number on two nodes, and tags on a diagram that has no nodes to
 * carry them.
 */
function tagsOf(meta: string, family: Family): Map<string, string> {
	const tags = new Map<string, string>();
	for (const word of meta.split(/\s+/).filter(Boolean)) {
		const [, id = "", ...values] = TAG.exec(word) ?? [];
		const tag = values.find((value) => value !== undefined) ?? "";
		if (!id) {
			throw new Error(`pack does not read "${word}" after mermaid; tag nodes with tag:id=number`);
		}
		if (!/^\d{1,3}$/.test(tag)) {
			throw new Error(`${word} is not a number; a tag is 1 to 3 digits, as in tag:${id}=2`);
		}
		const given = tags.get(id);
		if (given !== undefined && given !== tag) {
			throw new Error(`tag:${id} is given ${given} and ${tag}; give each part one number`);
		}
		const other = [...tags].find(([key, number]) => number === tag && key !== id)?.[0];
		if (other) {
			throw new Error(`tag ${tag} is on ${other} and ${id}; give each part its own number`);
		}
		tags.set(id, tag);
	}
	if (tags.size && !flows(family)) {
		throw new Error(
			"tags are drawn on flowchart and state diagram nodes; name the parts in the messages instead",
		);
	}
	return tags;
}

/**
 * Leads each tagged node's label with `$$tag:id=n$$`, which pele hands to tagMarkup as inline math and sizes the node for. It
 * goes through the parsed model, so a label's own text (`a["see b[1]"]`) and every way of declaring a node (`b@{ shape: ... }`,
 * a bare id, a state named only in transitions) take it alike; a tag no node carries is left for `untagged` to name.
 */
function tagNodes(model: ParsedModel, tags: Map<string, string>) {
	for (const [id, number] of tags) {
		const mark = `$$tag:${id}=${number}$$ `;
		const node = model.nodes?.get(id);
		if (node) {
			node.text = mark + node.text;
		}
		for (const state of model.graph?.nodes ?? []) {
			if (state.id === id) {
				state.label = mark + state.label;
			}
		}
	}
}

/**
 * A number tag as pele places inline math: a ring of 13 px text that the node makes room for, before its label, with TAG_GAP
 * after it (pele's space before the label is narrower than a ring wants).
 */
function tagMarkup(tex: string) {
	const [, id = "", number = ""] = /^tag:(.+)=(\d{1,3})$/.exec(tex) ?? [];
	if (!id) {
		return null;
	}
	const width = Math.max(20, 9 + number.length * 8);
	return {
		svg: `<g class="tag" data-id="${id}" data-ref="${id}" data-tag="${number}"><rect x="0.5" y="0.5" width="${width - 1}" height="19" rx="9.5" fill="none" stroke="currentColor"/><text x="${width / 2}" y="14.5" text-anchor="middle" font-size="${LABEL_PX}">${number}</text></g>`,
		width: width + TAG_GAP,
		height: 20,
	};
}

/** The text of a node's label as read aloud: its lines joined by spaces. */
const labelText = (node: string) =>
	(/<text class="pele-label"[\s\S]*?<\/text>/.exec(node)?.[0] ?? "")
		.replace(/<\/tspan><tspan[^>]*?\sy="[^"]*"[^>]*>/g, " ")
		.replace(/<[^>]*>/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** Each tag named by its number and its node's label ("2, hybrid inverter"), as a screen reader reaches it from the keyboard. */
const nameTags = (svg: string) =>
	svg.replace(
		/(<g class="pele-node[^"]*" data-id="[^"]*"[\s\S]*?)<g class="tag" ([^>]*)data-tag="(\d+)"/g,
		(_, node: string, attrs: string, number: string) =>
			`${node}<g class="tag" ${attrs}data-tag aria-label="${number}, ${labelText(node.slice(node.lastIndexOf('<g class="pele-node')))}"`,
	);

/**
 * Gives a flowchart's unnamed edges ids that are unique and count every edge drawn before between the same two nodes, named ones
 * too: `L_<from>_<to>_<n>`, the next free n where two pairs would read alike (`A_B --> C`, `A --> B_C`) or an author's id took
 * it. Mermaid numbers a pair's second edge 2 and lets such ids repeat, so one ref would light two edges.
 */
function renumberEdges(edges: FlowEdge[] = []) {
	const taken = new Set(edges.filter((edge) => edge.isUserDefinedId).map((edge) => edge.id));
	const pairs = new Map<string, number>();
	for (const edge of edges) {
		const pair = `${edge.start}_${edge.end}`;
		let n = pairs.get(pair) ?? 0;
		pairs.set(pair, n + 1);
		if (edge.isUserDefinedId) {
			continue;
		}
		while (taken.has(`L_${pair}_${n}`)) {
			n++;
		}
		edge.id = `L_${pair}_${n}`;
		taken.add(edge.id);
	}
}

/** A state diagram's transitions in drawing order, which pele numbers edge0, edge1, ...: nested composites in place. */
function transitionsOf(statements: StateStatement[] = []): Array<[string, string]> {
	return statements.flatMap((statement): Array<[string, string]> => {
		if ("state1" in statement) {
			return [[statement.state1.id, statement.state2.id]];
		}
		return "doc" in statement ? transitionsOf(statement.doc) : [];
	});
}

/** A state's ref: the diagram's own start and end are _start and _end, as the generated edge ids name them. */
const stateRef = (id: string) => id.replace(/^root(?=_start$|_end$)/, "");

/** A state diagram's edge refs by pele's edge id: `L_<from>_<to>_<n>`, n counting the transitions between the two. */
function stateEdgeRefs(model: ParsedModel): Map<string, string> {
	const seen = new Map<string, number>();
	return new Map(
		transitionsOf(model.rootDoc).map(([from, to], index) => {
			const pair = `${stateRef(from)}_${stateRef(to)}`;
			const n = seen.get(pair) ?? 0;
			seen.set(pair, n + 1);
			return [`edge${index}`, `L_${pair}_${n}`];
		}),
	);
}

/** Parts whose pele data-id is their ref, by class: nodes, groups, sequence lifelines, flowchart and state edges and labels. */
const PART =
	/<(g|path) class="pele-(node|cluster|lifeline|edge|edge-label)\b[^"]*" data-id="([^"]*)"/g;

/**
 * data-ref on nodes, groups, classes, entities and participants (their id), lifelines (their participant), flowchart edges and
 * their labels (the edge id: the author's `e1@`, else `L_<from>_<to>_<n>`), state transitions (the same form, [*] as _start and
 * _end) and sequence messages (m1, m2, ... in order). Class and ER relations, notes and activations carry none.
 */
function annotateParts(svg: string, family: Family, model: ParsedModel): string {
	const edgeRef = edgeRefs(svg, family, model);
	const ref = (kind: string, id: string) =>
		kind === "edge" || kind === "edge-label" ? edgeRef(id) : family === "state" ? stateRef(id) : id;
	return svg.replace(PART, (tag, _element: string, kind: string, id: string) => {
		const name = ref(kind, id);
		return name === undefined ? tag : `${tag} data-ref="${name}"`;
	});
}

/** An edge's (or its label's) ref by pele's id: see annotateParts. */
function edgeRefs(
	svg: string,
	family: Family,
	model: ParsedModel,
): (id: string) => string | undefined {
	if (family === "flowchart") {
		return (id) => id;
	}
	if (family === "state") {
		const transitions = stateEdgeRefs(model);
		return (id) => transitions.get(id);
	}
	const messages = [
		...new Set(
			[...svg.matchAll(/class="pele-edge pele-message" data-id="([^"]*)"/g)].map((m) => m[1]),
		),
	];
	return (id) => (messages.includes(id) ? `m${messages.indexOf(id) + 1}` : undefined);
}

/** The drawn width of `svg`, in px: its viewBox's, which inline keeps. */
const drawnWidth = (svg: string) =>
	Number(/^<svg [^>]*?viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg)?.[1]);

/** The width at which the smallest text of `svg` (the root's font or a text's font-size) shows at READABLE_PX. */
function readableWidth(svg: string): number {
	const sizes = [...svg.matchAll(/font-size="([\d.]+)"|font:([\d.]+)px/g)].map((m) =>
		Number(m[1] ?? m[2]),
	);
	return (drawnWidth(svg) * READABLE_PX) / Math.min(NODE_PX, ...sizes);
}

/**
 * The drawn width theme.css caps on phones and in print (and scales up on desktops), and the width that keeps the smallest
 * text readable, below which its block scrolls sideways. Custom properties rather than an inline max-width, so one page rule
 * on `.mermaid > svg` can still size it.
 */
function sizeStyle(svg: string, width: number, height: number): string {
	const most = Math.floor(width);
	return `--_diagram-base: ${most}px; --mermaid-min: ${Math.min(most, Math.ceil(readableWidth(svg)))}px; --diagram-ratio: ${width / height}`;
}

/**
 * pele's SVG as one of the page's: its root takes the block's id and the column's width within sizeStyle's limits (theme.css,
 * in place of pele's own max-width), keeping the private colour variables its style sets from the `--pele-*` ones theme.css
 * maps to the kit's tokens; text smaller than LABEL_PX, which MEASURER already made room for, is raised to it.
 */
function inline(svg: string, id: string): string {
	return svg
		.replace(/ font-size="([\d.]+)"/g, (whole, size: string) =>
			Number(size) < LABEL_PX ? ` font-size="${LABEL_PX}"` : whole,
		)
		.replace(
			/^<svg ([^>]*?)width="([\d.]+)" height="([\d.]+)" style="max-width:100%;height:auto;([^"]*)"/,
			(_, attrs: string, width: string, height: string, style: string) =>
				`<svg id="${id}" ${attrs}width="100%" style="${style};${sizeStyle(svg, Number(width), Number(height))}"`,
		);
}

/** The source laid out across its direction: LR and RL as top-down, TB, TD and BT (and no direction) as left to right. */
function across(body: string, family: Family): string {
	const flip = (dir = "TB") => (dir === "LR" || dir === "RL" ? "TB" : "LR");
	const turned = body.replace(
		/^(\s*direction\s+)(LR|RL|TB|TD|BT)\b/gm,
		(_, head: string, dir: string) => `${head}${flip(dir)}`,
	);
	if (family === "flowchart") {
		return turned.replace(
			/^((?:flowchart|graph)\b)(?:[ \t]+(LR|RL|TB|TD|BT)\b)?/,
			(_, head: string, dir?: string) => `${head} ${flip(dir)}`,
		);
	}
	return /^\s*direction\s/m.test(body) ? turned : turned.replace(/^(\S+)/, "$1\n  direction LR");
}

/**
 * The copy of a flowchart or state diagram that phones show instead (theme.css): the source laid out across its direction, when
 * the diagram is wider than a phone's column, so would shrink its text, and the copy is narrower. Phones then read a
 * left-to-right flow top-down, while wide screens keep the shorter left-to-right layout. Undefined otherwise.
 */
function phoneLayout(family: Family, svg: string, draw: () => string): string | undefined {
	if (!flows(family) || drawnWidth(svg) <= PHONE_COLUMN_PX) {
		return undefined;
	}
	const turned = draw();
	return drawnWidth(turned) < drawnWidth(svg) ? turned : undefined;
}

/**
 * The attribute that makes a diagram's phone copy print instead of the wide layout: paper cannot scroll, so theme.css fits the
 * printed copy to the column, and the wide layout prints only while that keeps its text readable (it is the shorter of the two).
 */
const printAttr = (svg: string) => (readableWidth(svg) > PRINT_COLUMN_PX ? "data-print " : "");

/** The first tagged id no node of the drawn `svg` carries, as its message. */
function untagged(svg: string, tags: Map<string, string>): string | undefined {
	const id = [...tags.keys()].find((key) => !svg.includes(`<g class="tag" data-id="${key}"`));
	return id && `tag:${id} names no node; use the id written before its label, as a in a["label"]`;
}

/** One layout of `text` as pele draws it for the page, with its parts' refs and tags named; `id` is its root's id. */
function draw(text: string, family: Family, id: string, tags: Map<string, string>): string {
	let model: ParsedModel;
	let drawn: string;
	try {
		model = parse(text);
		renumberEdges(model.edges);
		tagNodes(model, tags);
		drawn = render(model, {
			measurer: MEASURER,
			fontFamily: "Geist",
			fontSize: NODE_PX,
			idPrefix: `${id}-`,
			math: tagMarkup,
			links: false,
			images: false,
		}).svg;
	} catch (error) {
		throw new Error(peleMessage(error, text));
	}
	return inline(nameTags(annotateParts(drawn, family, model)), id);
}

/**
 * Renders one source with its fence's meta; `n` keeps its ids apart from the page's other diagrams. Throws with a message for
 * the author.
 */
function renderOne(source: string, n: number, meta: string): Diagram {
	const body = stripPreamble(source);
	const family = familyOf(body);
	const tags = tagsOf(meta, family);
	const problem = sourceProblem(family, body);
	if (problem) {
		throw new Error(problem);
	}
	const svg = draw(body, family, `mm${n}`, tags);
	const unknown = untagged(svg, tags);
	if (unknown) {
		throw new Error(unknown);
	}
	const turned = phoneLayout(family, svg, () =>
		draw(across(body, family), family, `mm${n}-phone`, tags),
	);
	const phone = turned?.replace(/^<svg /, `<svg data-phone ${printAttr(svg)}`);
	const refs = [svg, phone ?? ""].flatMap((copy) =>
		[...copy.matchAll(/ data-ref="([^"]*)"/g)].map((m) => m[1] ?? ""),
	);
	return {
		svg,
		phone,
		refs: [...new Set(refs)],
		tags,
		warnings: family === "flowchart" ? fixedNodePaintWarnings(body) : [],
	};
}

/**
 * Renders one Mermaid source to one inline SVG, plus a phone copy for a wide flowchart or state diagram (phoneLayout), with no
 * browser: pele parses and lays it out in this process, measuring text with Geist's advances. `n`, the block's place on the
 * page, keeps its ids apart from the other diagrams. A source that fails, or whose type is not supported, returns an Error
 * whose message tells the author what to write instead. Every part carries the data-ref of its Mermaid id (see annotateParts),
 * and colours come from the kit's tokens (theme.css). `meta`, the fence's text after `mermaid`, may tag nodes with numbers:
 * `tag:inv=2` draws 2 in a ring before node inv's label.
 */
export function renderMermaid(source: string, n = 0, meta = ""): Diagram | Error {
	try {
		return renderOne(source, n, meta);
	} catch (e) {
		return e instanceof Error ? e : new Error(String(e));
	}
}
