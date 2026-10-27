/** Text sizes for schematic labels, measured in Geist without a browser. */

/** Label text size in drawing units; the drawing shrinks no further than READABLE_PX / FONT of its drawn size. */
export const FONT = 12;
/** The second line of a label (a part's value) is set smaller. */
export const VALUE_FONT = 11;
export const LINE = 14;

// Spike: a copy of the Geist 400 advances that patches/beautiful-mermaid@1.1.3.patch carries (build/geist-widths.ts). Shipping
// would export the patch's measureTextWidth from the vendored bundle instead of keeping a second table.
const GEIST_400 = [
	250, 213, 346, 478, 629, 802, 620, 178, 274, 274, 430, 558, 201, 419, 201, 480, 663, 384, 619,
	613, 615, 626, 593, 524, 604, 593, 297, 297, 544, 540, 544, 559, 906, 668, 680, 703, 694, 603,
	590, 700, 713, 270, 597, 640, 580, 877, 743, 739, 650, 733, 672, 640, 552, 689, 667, 945, 606,
	576, 544, 347, 455, 347, 426, 557, 248, 551, 595, 546, 595, 561, 395, 594, 581, 244, 260, 590,
	267, 877, 581, 573, 595, 595, 379, 520, 392, 575, 536, 819, 585, 537, 537, 389, 264, 389, 523,
];

/** A character's advance in em: measured for ASCII and Latin letters built on it, else a wide letter's, so text never runs over. */
function advance(char: string): number {
	const base = char.normalize("NFD")[0] ?? char;
	const code = base.codePointAt(0) ?? 0;
	return (code >= 32 && code <= 126 ? GEIST_400[code - 32] : undefined) ?? 700;
}

/** The width of `text` set at `size` px, with a little slack for the last glyph's edge. */
export const textWidth = (text: string, size = FONT) =>
	[...text].reduce((sum, char) => sum + advance(char), 0) * (size / 1000) + size * 0.15;

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

/** The width of a label line with its subscripts. */
export const lineWidth = (label: string, size: number) =>
	runsOf(label).reduce((sum, run) => sum + textWidth(run.text, run.sub ? size * SUB : size), 0);
