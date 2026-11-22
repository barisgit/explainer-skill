import type { Point } from "unist";

/** Where a point of a page's tree was written, as errors show it: `file:line`, with `:column` when asked, or the file alone. */
export type Where = (start: Point | undefined, column?: boolean) => string;

/** One file in the joined text: its name and the line it starts at there. */
interface Origin {
	file: string;
	line: number;
}

/** A node as positions shift it: anything with a position, at any depth of an mdast or hast tree. */
interface Positioned {
	position?: { start: Point; end: Point } | undefined;
	children?: unknown;
}

/** Moves every position in `node` down by `lines` and `offset`, so it points into the joined text. */
function shift(node: Positioned, lines: number, offset: number) {
	for (const point of node.position ? [node.position.start, node.position.end] : []) {
		point.line += lines;
		if (point.offset !== undefined) {
			point.offset += offset;
		}
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			shift(child, lines, offset);
		}
	}
}

/**
 * The text of a page and the parts spliced into it (src/mdx/parts.ts), joined in one string: a part's nodes are moved to point
 * into it (`add`), so a check that reads the source at a node's offsets (math's dollar amounts) reads the part's own text, and
 * `where` names the file and line the author wrote.
 */
export function origins(file: string, text: string) {
	const files: Origin[] = [{ file, line: 1 }];
	let joined = text;
	const where: Where = (start, column = false) => {
		if (!start) {
			return file;
		}
		const origin = files.findLast((o) => o.line <= start.line) ?? { file, line: 1 };
		return `${origin.file}:${start.line - origin.line + 1}${column ? `:${start.column}` : ""}`;
	};
	return {
		where,
		/** The page's text and every part's, one after another. */
		text: () => joined,
		/** Appends a part's text and moves its tree's positions into the joined text. */
		add(part: string, partText: string, tree: Positioned) {
			const lines = joined.split("\n").length;
			const offset = joined.length + 1;
			joined += `\n${partText}`;
			files.push({ file: part, line: lines + 1 });
			shift(tree, lines, offset);
		},
	};
}
