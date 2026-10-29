/** Text sizes for schematic labels, measured in Geist (src/geist.ts, which the Mermaid patch and the charts measure with too). */
import { textWidth } from "../geist.ts";

/** Label text size in drawing units; the drawing shrinks no further than READABLE_PX / FONT of its drawn size. */
export const FONT = 12;
/** The second line of a label (a part's value) is set smaller. */
export const VALUE_FONT = 11;
export const LINE = 14;

/** Subscripts are set this much smaller than their line. */
export const SUB = 0.8;

/** A stretch of label text, set as a subscript or not. */
export interface Run {
	text: string;
	sub: boolean;
}

/**
 * A label as runs: `_x` sets the rest of the word as a subscript and `_{x y}` the braced text, as in TeX, so V_O and R_{SC}
 * read as on a datasheet.
 */
export function runsOf(label: string): Run[] {
	const runs: Run[] = [];
	const pattern = /_\{([^}]*)\}|_(\S+)/g;
	let last = 0;
	for (const m of label.matchAll(pattern)) {
		if (m.index > last) {
			runs.push({ text: label.slice(last, m.index), sub: false });
		}
		runs.push({ text: m[1] ?? m[2] ?? "", sub: true });
		last = m.index + m[0].length;
	}
	if (last < label.length) {
		runs.push({ text: label.slice(last), sub: false });
	}
	return runs;
}

/** The width of a label line with its subscripts, and a little slack for the last glyph's edge. */
export const lineWidth = (label: string, size: number) =>
	runsOf(label).reduce((sum, run) => sum + textWidth(run.text, run.sub ? size * SUB : size), 0) +
	size * 0.15;
