/**
 * Prototype, not wired into pack: a Mermaid block drawn by pele (https://github.com/obsidianmd/pele, the renderer T3 Code uses)
 * instead of the patched beautiful-mermaid, returned as pack's Diagram so the comparison and the stress tests can hold the two
 * side by side. It covers what the swap would have to keep: Geist's advances for text, the kit's refs on every part (the
 * same ids the current renderer gives), a phone copy laid out across the direction, and number tags drawn inside their node.
 * It does not cover pack's input checks, the plain look's mapping in theme.css, or class, ER and xychart diagrams.
 */

import { render } from "pele";
import { textWidth } from "../skills/explainer/src/geist.ts";
import type { Diagram } from "../skills/explainer/src/mermaid.ts";

/** The kit's label size; pele draws edge labels at 7/8 of it. */
const FONT_PX = 13;
/** A phone's diagram column, as in src/mermaid.ts. */
const PHONE_COLUMN_PX = 326;

const measurer = {
	width: (text: string, size: number, style: number) =>
		textWidth(text, size, style & 1 ? 600 : 400),
};

/** A number tag as pele places inline math: a ring of 13 px text, sized so the node makes room for it. */
function tagMarkup(tex: string) {
	const [, id = "", number = ""] = /^tag:([^=]+)=(\d{1,3})$/.exec(tex) ?? [];
	if (!id) {
		return null;
	}
	const width = Math.max(20, 9 + number.length * 8);
	return {
		svg: `<svg width="${width}" height="20" viewBox="0 0 ${width} 20"><g class="tag" data-id="${id}" data-ref="${id}" data-tag aria-label="${number}"><rect x="0.5" y="0.5" width="${width - 1}" height="19" rx="9.5" fill="none" stroke="currentColor"/><text x="${width / 2}" y="14.5" text-anchor="middle" font-size="${FONT_PX}">${number}</text></g></svg>`,
		width,
		height: 20,
	};
}

/** The fence meta's `tag:id=number` words, by node id. */
const tagsOf = (meta: string) =>
	new Map(
		[...meta.matchAll(/tag:([^\s=]+)=(\d{1,3})/g)].map(([, id = "", n = ""]) => [id, n] as const),
	);

/** The source with each tagged node's first bracketed label led by its tag, which tagMarkup draws. */
function withTags(source: string, tags: Map<string, string>): string {
	let text = source;
	for (const [id, number] of tags) {
		text = text.replace(
			new RegExp(
				String.raw`(^|[\s;&>])(${id})(\[\[|\[\(|\(\[|\(\(|\[|\(|\{\{|\{|>)"?([^\]\)\}"]*)"?`,
				"m",
			),
			(_, before: string, node: string, open: string, label: string) =>
				`${before}${node}${open}"$$tag:${id}=${number}$$ ${label}"`,
		);
	}
	return text;
}

/** The source laid out across its direction: LR and RL as TB, TB, TD and BT as LR, the header and every `direction` line. */
const across = (source: string) =>
	source.replace(
		/^(\s*(?:flowchart|graph|direction)\s+)(LR|RL|TB|TD|BT)\b/gm,
		(_, head: string, dir: string) => `${head}${dir === "LR" || dir === "RL" ? "TB" : "LR"}`,
	);

/** State transitions in written order as the current renderer names them (L_<from>_<to>_<n>, [*] as _start or _end). */
function stateEdgeIds(source: string): string[] {
	const seen = new Map<string, number>();
	return [...source.matchAll(/^\s*(\S+)\s*-->\s*([^:\n]+?)\s*(?::.*)?$/gm)].map(
		([, from = "", to = ""]) => {
			const pair = `${from === "[*]" ? "_start" : from}_${to === "[*]" ? "_end" : to}`;
			const n = seen.get(pair) ?? 0;
			seen.set(pair, n + 1);
			return `L_${pair}_${n}`;
		},
	);
}

/**
 * pele's data-id as data-ref: the parts' Mermaid ids, but for a state diagram's transitions and start and end, and a sequence's
 * messages, which take the current renderer's names.
 */
function annotate(svg: string, source: string): string {
	const transitions = stateEdgeIds(source);
	const ref = (id: string) => {
		const transition = /^edge(\d+)$/.exec(id);
		const message = /^i(\d+)$/.exec(id);
		const pseudo = /^root(_start|_end)$/.exec(id);
		return pseudo
			? (pseudo[1] ?? id)
			: transition
				? (transitions[Number(transition[1])] ?? id)
				: message
					? `m${Number(message[1]) + 1}`
					: id;
	};
	return svg.replace(
		/(<g class="pele-(?:node|edge|edge-label|cluster|lifeline)[^"]*" data-id="([^"]*)")/g,
		(tag, _whole: string, id: string) => `${tag} data-ref="${ref(id)}"`,
	);
}

/** The drawn width of pele's SVG. */
const widthOf = (svg: string) => Number(/ width="([\d.]+)"/.exec(svg)?.[1]);

/** One Mermaid block as pack's Diagram, drawn by pele; an Error with pele's message for input it does not parse. */
export function renderWithPele(source: string, n = 0, meta = ""): Diagram | Error {
	const tags = tagsOf(meta);
	const text = withTags(source, tags);
	const draw = (body: string, copy: string) =>
		annotate(
			render(body, {
				measurer,
				fontFamily: "Geist",
				fontSize: FONT_PX,
				idPrefix: `mm${n}${copy}-`,
				math: tagMarkup,
				links: false,
				images: false,
			}).svg,
			body,
		);
	try {
		const svg = draw(text, "");
		const flows = /^\s*(?:flowchart|graph|stateDiagram)/m.test(text);
		const phone =
			flows && widthOf(svg) > PHONE_COLUMN_PX ? draw(across(text), "-phone") : undefined;
		const refs = [...new Set([...svg.matchAll(/data-ref="([^"]*)"/g)].map(([, id = ""]) => id))];
		return {
			svg,
			phone: phone && widthOf(phone) < widthOf(svg) ? phone : undefined,
			refs,
			tags,
			warnings: [],
		};
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}
