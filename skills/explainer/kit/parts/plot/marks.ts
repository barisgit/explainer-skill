/* plot marks: what kit:plot.js draws in a bar, over the plot and in a legend entry, not referenced from pages: pack joins it in
   front of plot.js with draw.ts, which uses it. PlotMarks({ svgLine, svgText }) gives bar(...) and area(...), a bar or an area in
   one of the accent's three states; markers(...) and rows(...), the labelled reference markers and spans, the lines their labels
   take on top, and the arrows; wrap(...), a label's lines; and swatch(...), a series' legend swatch. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotMarks = ({ svgLine, svgText }) => {
	const HATCH = 6; // px between hatch lines, measured across them
	const GAP = 6; // px between a marker's line and its label
	const EDGE = 4; // px a marker's label keeps from the drawing's edge
	const ARROW_OFF = 3; // px an arrow stops short of its points
	const HEAD = 7; // px of an arrow's head along it, half as wide

	const px = (v: number) => +v.toFixed(1);

	/** Where the line x + y = c crosses the polygon's edges, by x. */
	function cuts(polygon: readonly PlotPx[], c: number) {
		const xs: number[] = [];
		for (const [i, [x1, y1]] of polygon.entries()) {
			const [x2, y2] = polygon[(i + 1) % polygon.length] ?? [x1, y1];
			const [s1, s2] = [x1 + y1, x2 + y2];
			if (s1 < c !== s2 < c) {
				xs.push(x1 + ((x2 - x1) * (c - s1)) / (s2 - s1));
			}
		}
		return xs.sort((a, b) => a - b);
	}

	/**
	 * Hatch lines at 45 degrees ("/") inside a polygon, HATCH px apart, on a grid anchored at the drawing's origin, so neighbouring
	 * bars and areas share one pattern; a path of M x y L x y segments.
	 */
	function hatchPath(polygon: readonly PlotPx[]) {
		const step = HATCH * Math.SQRT2; // along x + y
		const sums = polygon.map(([x, y]) => x + y);
		let d = "";
		for (let c = Math.ceil(Math.min(...sums) / step) * step; c <= Math.max(...sums); c += step) {
			const xs = cuts(polygon, c);
			for (let k = 0; k + 1 < xs.length; k += 2) {
				const [from = 0, to = 0] = [xs[k], xs[k + 1]];
				if (to > from) {
					d += `M${px(from)} ${px(c - from)}L${px(to)} ${px(c - to)}`;
				}
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
			const rect: PlotPx[] = [
				[x, y],
				[x + w, y],
				[x + w, y + h],
				[x, y + h],
			];
			const lines = `<path class="hatching" d="${hatchPath(rect)}"/>`;
			return { markup: `<rect class="bar hatch" ${box(0.5)}>${title}</rect>${lines}`, open: true };
		}
		const c = state === "accent" ? "var(--accent)" : colour;
		return { markup: `<rect class="bar" style="--c:${c}" ${box(0)}>${title}</rect>`, open: false };
	}

	/**
	 * An area's markup in its state: true a tint of `colour`, "accent" solid, "hollow" the accent's tint inside an accent outline,
	 * "hatch" grey lines inside a grey outline. `open` says a label on it reads as one outside it, in ink on a halo.
	 */
	function area(state: PlotFill | true, colour: string, polygon: readonly PlotPx[]) {
		const d = `M${polygon.map(([x, y]) => `${px(x)} ${px(y)}`).join("L")}Z`;
		if (state === true) {
			return { markup: `<path class="area" style="--c:${colour}" d="${d}"/>`, open: true };
		}
		const hatching = state === "hatch" ? `<path class="hatching" d="${hatchPath(polygon)}"/>` : "";
		return {
			markup: `<path class="area ${state}" d="${d}"/>${hatching}`,
			open: state !== "accent",
		};
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

	/**
	 * A label on top: its lines, where they stand (x, by anchor: a marker's on one side of its line, a span's centred over it) and
	 * how wide the widest is.
	 */
	interface Side {
		lines: string[];
		x: number;
		anchor: "start" | "middle" | "end";
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
		const side = (room: number, x: number, anchor: "start" | "end") => {
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
	const boxOf = ({ x, anchor, width, lines }: Side, row: number): Box => {
		const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
		return { x0, x1: x0 + width, row, rows: lines.length };
	};
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
	 * placed; then the spans' (x [from, to]). rows says how many lines they take, which the plot makes room for (Plot's height
	 * counts them too).
	 */
	function topLabels(marks: readonly PlotMark[], f: PlotMarkFrame) {
		const { X } = f;
		const xs = marks
			.flatMap((m) => (typeof m.x !== "number" || !X ? [] : [{ at: X(m.x), label: m.label ?? "" }]))
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
		const spans = marks.flatMap((m) =>
			Array.isArray(m.x) && !m.between && X
				? [spanLabel(X(m.x[0]), X(m.x[1]), m.label ?? "", f, placed)]
				: [],
		);
		return { labels, spans, rows: Math.max(0, ...placed.map((b) => b.row + b.rows)) };
	}

	/**
	 * A span's label on top, centred over the span and wrapped to its width, in the first row where it and its bracket clear the
	 * labels placed before it; a span without a label takes a row for its bracket.
	 */
	function spanLabel(a: number, b: number, label: string, f: PlotMarkFrame, placed: Box[]) {
		const [from, to] = [Math.min(a, b), Math.max(a, b)];
		const lines = label ? wrap(label, to - from - 2 * GAP, f.textWidth) : [];
		const width = Math.max(0, ...lines.map(f.textWidth));
		const x = Math.min(Math.max((from + to) / 2, EDGE + width / 2), f.W - EDGE - width / 2);
		const side: Side = { lines, x, anchor: "middle", width };
		for (let row = 0; ; row++) {
			const own = boxOf(side, row);
			const box = {
				x0: Math.min(from, own.x0),
				x1: Math.max(to, own.x1),
				row,
				rows: Math.max(1, own.rows),
			};
			if (placed.every((other) => apart(box, other))) {
				placed.push(box);
				return { from, to, side, row };
			}
		}
	}

	/** A span's bracket: ticks at its ends and a line between them at the middle of its label's lines, broken by the label. */
	function bracket({ from, to, side }: ReturnType<typeof spanLabel>, top: number, line: number) {
		const y = top + (Math.max(1, side.lines.length) * line) / 2;
		const [x0, x1] = side.width
			? [side.x - side.width / 2 - GAP, side.x + side.width / 2 + GAP]
			: [to, to];
		return (
			svgLine("span", from, from, y - 4, y + 4) +
			svgLine("span", to, to, y - 4, y + 4) +
			(x0 > from ? svgLine("span", from, x0, y, y) : "") +
			(to > x1 ? svgLine("span", x1, to, y, y) : "")
		);
	}

	/** Lines of rows of text, one <text> per line, the first centred at y. */
	const textLines = (lines: string[], x: number, y: number, anchor: Side["anchor"], line: number) =>
		lines.map((t, k) => svgText("mark-label", x, y + k * line, anchor, t)).join("");
	/** The box such lines take. */
	function linesBox(
		lines: string[],
		x: number,
		y: number,
		anchor: Side["anchor"],
		f: PlotMarkFrame,
	): PlotBox {
		const width = Math.max(0, ...lines.map(f.textWidth));
		const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
		return { x0, x1: x0 + width, y0: y - f.line / 2, y1: y - f.line / 2 + lines.length * f.line };
	}

	/**
	 * A horizontal marker: its line across the plot, its label above it at its right end, else (f.choose picks, where a line
	 * crosses it there) under it, or at its left end above or under it, then each wrapped to half the plot; under it where the
	 * plot has no room above.
	 */
	function across(at: number, label: string, f: PlotMarkFrame, placed: readonly PlotBox[]) {
		// Wrapped to the plot's width, then to a half and a third of it, which a line may pass beside.
		const spots = [1, 2, 3].flatMap((share) => {
			const width = (f.R - f.L) / share;
			const words = label ? wrap(label, width, f.textWidth) : [];
			const above = at - GAP - words.length * f.line;
			const ys = [...(above >= 0 ? [above + f.line / 2] : []), at + GAP + f.line / 2];
			return [f.R, f.L].flatMap((x) =>
				ys.map((y) => {
					const anchor = x === f.R ? ("end" as const) : ("start" as const);
					return { box: linesBox(words, x, y, anchor, f), lines: words, anchor };
				}),
			);
		});
		// spots always holds the first choice; the fallback only satisfies the type.
		const { box, anchor, lines } = f.choose?.(spots, placed) ??
			spots[0] ?? { box: linesBox([], f.R, at, "end", f), lines: [], anchor: "end" };
		const x = anchor === "end" ? box.x1 : box.x0;
		return {
			line: svgLine("mark", f.L, f.R, at, at),
			label: textLines(lines, x, box.y0 + f.line / 2, anchor, f.line),
			box,
		};
	}

	/** The horizontal markers (see across), each label clear of those placed before it, which it joins (`placed`). */
	function acrossAll(marks: readonly PlotMark[], f: PlotMarkFrame, placed: PlotBox[]) {
		let lines = "";
		let labels = "";
		for (const { y, label = "" } of marks) {
			const flat = y === undefined || !f.Y ? undefined : across(f.Y(y), label, f, placed);
			if (flat) {
				lines += flat.line;
				labels += flat.label;
				placed.push(flat.box);
			}
		}
		return { lines, labels };
	}

	/**
	 * An arrow from one data point to another: its shaft, ARROW_OFF px short of both points so it points at them rather than
	 * covering them, and a solid head at the second. Points closer than both gaps and a head shrink all three alike, so a short
	 * arrow still shows on a phone; none where the points lie within a pixel.
	 */
	function arrow(
		from: PlotPoint,
		to: PlotPoint,
		X: (v: number) => number,
		Y: (v: number) => number,
	) {
		const [ax, ay, bx, by] = [X(from[0]), Y(from[1]), X(to[0]), Y(to[1])];
		const length = Math.hypot(bx - ax, by - ay);
		if (length < 1) {
			return "";
		}
		const scale = Math.min(1, length / (2 * ARROW_OFF + HEAD + 1));
		const [off, size] = [ARROW_OFF * scale, HEAD * scale];
		const [ux, uy] = [(bx - ax) / length, (by - ay) / length];
		const [tx, ty] = [bx - ux * off, by - uy * off];
		const [cx, cy] = [tx - ux * size, ty - uy * size];
		const [nx, ny] = [-uy * (size / 2), ux * (size / 2)];
		const head = `M${px(tx)} ${px(ty)}L${px(cx + nx)} ${px(cy + ny)}L${px(cx - nx)} ${px(cy - ny)}Z`;
		// The shaft runs 1 px into the head, so no seam shows between them.
		const shaft = svgLine("arrow", ax + ux * off, cx + ux * scale, ay + uy * off, cy + uy * scale);
		return `${shaft}<path class="arrow-head" d="${head}"/>`;
	}

	/** The arrows of a plot with numeric axes. */
	const arrows = (marks: readonly PlotMark[], { X, Y }: PlotMarkFrame) =>
		marks.map((m) => (m.from && m.to && X && Y ? arrow(m.from, m.to, X, Y) : "")).join("");

	/**
	 * The markers' dashed lines and the spans' brackets (`lines`, drawn under the values) and their labels (`labels`, drawn over
	 * everything): a vertical marker from the top of its label's row to the plot's bottom, a horizontal one across the plot (see
	 * across), a span's bracket in its label's row; and the labels' boxes, which other labels keep clear of. `top` is where the
	 * labels on top start.
	 */
	function markers(marks: readonly PlotMark[], f: PlotMarkFrame, top: number) {
		let lines = "";
		let labels = "";
		const boxes: PlotBox[] = [];
		const onTop = topLabels(marks, f);
		for (const { at, lines: words, x, anchor, row } of onTop.labels) {
			const from = top + row * f.line;
			lines += svgLine("mark", at, at, words[0] ? from : f.T, f.B);
			labels += textLines(words, x, from + f.line / 2, anchor, f.line);
			boxes.push(linesBox(words, x, from + f.line / 2, anchor, f));
		}
		for (const span of onTop.spans) {
			const from = top + span.row * f.line;
			lines += bracket(span, from, f.line);
			labels += textLines(span.side.lines, span.side.x, from + f.line / 2, "middle", f.line);
			boxes.push(linesBox(span.side.lines, span.side.x, from + f.line / 2, "middle", f));
		}
		const flat = acrossAll(marks, f, boxes);
		return {
			lines: lines + flat.lines + arrows(marks, f),
			labels: labels + flat.labels,
			boxes: boxes.filter((b) => b.x1 > b.x0),
		};
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

	/**
	 * A break across a bar at `at` on the value axis, [from, to] across it: a slanted band in the tone under the plot, 4 px wide,
	 * which also cuts a hollow bar's outline.
	 */
	function cut(at: number, [from, to]: readonly [number, number], horizontal: boolean) {
		const band: PlotPx[] = [
			[at - 4, to + 1],
			[at, to + 1],
			[at + 4, from - 1],
			[at, from - 1],
		];
		const points = band.map(([a, c]) => (horizontal ? [a, c] : [c, a]).map(px).join(","));
		return `<path class="cut" d="M${points.join("L")}Z"/>`;
	}

	return {
		bar,
		cut,
		area,
		markers,
		wrap,
		rows: (marks: readonly PlotMark[], f: PlotMarkFrame) => topLabels(marks, f).rows,
		swatch,
	};
};
