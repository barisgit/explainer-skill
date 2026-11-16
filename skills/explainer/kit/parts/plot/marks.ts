/* plot marks: what kit:plot.js draws in a bar, over the plot and in a legend entry, not referenced from pages: pack joins it in
   front of plot.js with draw.ts, which uses it. PlotMarks({ svgLine, svgText }) gives bar(...), a bar in one of the accent's
   three states; markers(...) and rows(...), the labelled reference markers and the lines their labels take on top; and
   swatch(...), a series' legend swatch. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotMarks = ({ svgLine, svgText }) => {
	const HATCH = 6; // px between hatch lines, measured across them
	const GAP = 6; // px between a marker's line and its label
	const EDGE = 4; // px a marker's label keeps from the drawing's edge

	const px = (v: number) => +v.toFixed(1);

	/**
	 * Hatch lines at 45 degrees ("/") inside a rect, HATCH px apart, on a grid anchored at the drawing's origin, so neighbouring
	 * bars share one pattern; a path of M x y L x y segments.
	 */
	function hatchPath(x: number, y: number, w: number, h: number) {
		const step = HATCH * Math.SQRT2; // along x + y
		let d = "";
		for (let c = Math.ceil((x + y) / step) * step; c <= x + w + y + h; c += step) {
			const from = Math.max(x, c - (y + h));
			const to = Math.min(x + w, c - y);
			if (to > from) {
				d += `M${px(from)} ${px(c - from)}L${px(to)} ${px(c - to)}`;
			}
		}
		return d;
	}

	/**
	 * A bar's markup in its state: solid in `colour` (the accent for "accent"), hollow (the accent's tint inside an accent outline)
	 * or hatch (grey lines inside a grey outline, over the tone under it). Outlines are drawn inside the bar's box. `title` is the
	 * bar's tooltip; `open` says the bar is light enough that a value on it reads as one outside it, in ink on a halo.
	 */
	function bar(
		state: PlotFill | undefined,
		colour: string,
		[x, y, w, h]: readonly [number, number, number, number],
		title: string,
	) {
		const box = (inset: number) => {
			const i = Math.min(inset, w / 2, h / 2);
			return `x="${px(x + i)}" y="${px(y + i)}" width="${px(w - 2 * i)}" height="${px(h - 2 * i)}"`;
		};
		if (state === "hollow") {
			return { markup: `<rect class="bar hollow" ${box(0.75)}>${title}</rect>`, open: true };
		}
		if (state === "hatch") {
			const lines = `<path class="hatching" d="${hatchPath(x, y, w, h)}"/>`;
			return { markup: `<rect class="bar hatch" ${box(0.5)}>${title}</rect>${lines}`, open: true };
		}
		const c = state === "accent" ? "var(--accent)" : colour;
		return { markup: `<rect class="bar" style="--c:${c}" ${box(0)}>${title}</rect>`, open: false };
	}

	/** Words of `text` in lines no wider than `width`; a word wider than that stands on a line of its own. */
	function wrap(text: string, width: number, textWidth: (s: unknown) => number) {
		const lines: string[] = [];
		for (const word of text.split(/\s+/).filter(Boolean)) {
			const last = lines.at(-1);
			if (last !== undefined && textWidth(`${last} ${word}`) <= width) {
				lines[lines.length - 1] = `${last} ${word}`;
			} else {
				lines.push(word);
			}
		}
		return lines;
	}

	/** A vertical marker's label on one side of its line: its lines, where they start (x, by anchor) and how wide the widest is. */
	interface Side {
		lines: string[];
		x: number;
		anchor: "start" | "end";
		width: number;
	}
	/**
	 * The sides a label may take, the one it takes fewer lines on first, its right on a tie: on the line's right, wrapped before
	 * `right`, or right-aligned on its left, wrapped after `left`. A side too narrow for the label's longest word is left out,
	 * unless both are, when the wider one stays.
	 */
	function sides(
		label: string,
		at: number,
		[left, right]: readonly [number, number],
		textWidth: (s: unknown) => number,
	): Side[] {
		const word = Math.max(...label.split(/\s+/).map(textWidth));
		const side = (room: number, x: number, anchor: Side["anchor"]) => {
			const lines = wrap(label, room, textWidth);
			return { room, side: { lines, x, anchor, width: Math.max(0, ...lines.map(textWidth)) } };
		};
		const both = [
			side(right - (at + GAP), at + GAP, "start"),
			side(at - GAP - left, at - GAP, "end"),
		];
		const fit = both
			.filter(({ room }) => room >= word)
			.sort((a, b) => a.side.lines.length - b.side.lines.length);
		const widest = both.reduce((a, b) => (b.room > a.room ? b : a));
		return (fit.length ? fit : [widest]).map((o) => o.side);
	}

	/** A placed label's box: from x0 to x1 across, and rows lines down from line `row` on top. */
	interface Box {
		x0: number;
		x1: number;
		row: number;
		rows: number;
	}
	const boxOf = ({ x, anchor, width, lines }: Side, row: number): Box => ({
		x0: anchor === "start" ? x : x - width,
		x1: anchor === "start" ? x + width : x,
		row,
		rows: lines.length,
	});
	/** Whether two boxes keep GAP apart across, or share no line. */
	const apart = (a: Box, b: Box) =>
		a.x1 + GAP <= b.x0 || b.x1 + GAP <= a.x0 || a.row + a.rows <= b.row || b.row + b.rows <= a.row;

	/** The first row from the top, and the side, at which a label's box clears every label placed before it. */
	function placeLabel(choices: Side[], placed: Box[]) {
		for (let row = 0; ; row++) {
			for (const side of choices) {
				const box = boxOf(side, row);
				if (placed.every((other) => apart(box, other))) {
					placed.push(box);
					return { ...side, row };
				}
			}
		}
	}

	/**
	 * The vertical markers' labels (x), on top of the plot, placed together left to right: each beside its line, wrapping before
	 * the next marker or the drawing's edge, on the side with room, and a row lower where both sides would meet a label already
	 * placed. rows says how many lines they take, which the plot makes room for (Plot's height counts them too).
	 */
	function topLabels(marks: readonly PlotMark[], f: PlotMarkFrame) {
		const xs = marks
			.flatMap((m) => (m.x === undefined || !f.X ? [] : [{ at: f.X(m.x), label: m.label ?? "" }]))
			.sort((a, b) => a.at - b.at);
		const placed: Box[] = [];
		const labels = xs.map(({ at, label }, i) => {
			const left = i > 0 ? (xs[i - 1]?.at ?? 0) + GAP : EDGE;
			const right = i < xs.length - 1 ? (xs[i + 1]?.at ?? f.W) - GAP : f.W - EDGE;
			const choices = sides(label, at, [left, right], f.textWidth);
			const [first] = choices;
			return {
				at,
				...(first?.lines[0]
					? placeLabel(choices, placed)
					: { lines: [], x: at, anchor: "start" as const, row: 0 }),
			};
		});
		return { labels, rows: Math.max(0, ...placed.map((b) => b.row + b.rows)) };
	}

	/** Lines of rows of text, one <text> per line, the first centred at y. */
	const textLines = (
		lines: string[],
		x: number,
		y: number,
		anchor: "start" | "end",
		line: number,
	) => lines.map((t, k) => svgText("mark-label", x, y + k * line, anchor, t)).join("");

	/** A horizontal marker: its line across the plot, its label on top at its end, or under it where the plot has no room above. */
	function across(at: number, label: string, f: PlotMarkFrame) {
		const words = label ? wrap(label, f.R - f.L, f.textWidth) : [];
		const above = at - GAP - words.length * f.line;
		const first = above >= 0 ? above + f.line / 2 : at + GAP + f.line / 2;
		return {
			line: svgLine("mark", f.L, f.R, at, at),
			label: textLines(words, f.R, first, "end", f.line),
		};
	}

	/**
	 * The markers' dashed lines (`lines`, drawn under the values) and labels (`labels`, drawn over everything): a vertical one from
	 * the top of its label's row to the plot's bottom, a horizontal one across the plot (see across). `top` is where the vertical
	 * markers' labels start.
	 */
	function markers(marks: readonly PlotMark[], f: PlotMarkFrame, top: number) {
		let lines = "";
		let labels = "";
		for (const { at, lines: words, x, anchor, row } of topLabels(marks, f).labels) {
			const from = top + row * f.line;
			lines += svgLine("mark", at, at, words[0] ? from : f.T, f.B);
			labels += textLines(words, x, from + f.line / 2, anchor, f.line);
		}
		const { Y } = f;
		for (const { y, label = "" } of Y ? marks : []) {
			if (Y && y !== undefined) {
				const drawn = across(Y(y), label, f);
				lines += drawn.line;
				labels += drawn.label;
			}
		}
		return { lines, labels };
	}

	/**
	 * A series' legend swatch: a line in its colour and dash (each dash 2 px longer and each gap 2 px shorter, as the line's
	 * round caps draw them), or a square in its colour or in its bars' state.
	 */
	function swatch(type: string, colour: string, dash: string, state: PlotFill | undefined) {
		let at = 0;
		const stops = dash.split(" ").map((length, k) => {
			const from = at;
			at += Math.max(0, Number(length) + (k % 2 ? -2 : 2));
			return `${k % 2 ? "transparent" : "var(--c)"} ${px(from)}px ${px(at)}px`;
		});
		const c = state === "accent" ? "var(--accent)" : colour;
		const style = `--c:${c}${dash ? `;background:repeating-linear-gradient(90deg, ${stops.join(", ")})` : ""}`;
		return `<i class="${type}${state && state !== "accent" ? ` ${state}` : ""}" style="${style}"></i>`;
	}

	return {
		bar,
		markers,
		rows: (marks: readonly PlotMark[], f: PlotMarkFrame) => topLabels(marks, f).rows,
		swatch,
	};
};
