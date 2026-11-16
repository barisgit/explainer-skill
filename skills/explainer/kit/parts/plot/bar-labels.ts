/* plot bar labels: a bar's value label, inside a stacked segment or at a side-by-side bar's end, not referenced from pages: pack
   joins it in front of plot.js with draw.ts, which uses it. PlotBarLabels({ svgLine, svgText, size }) gives barLabel(...), the
   label clear of the markers' lines, and moved across where it would sit on another bar or label; text is set at size() px. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.PlotBarLabels = ({ svgText, size }) => {
	/** A value's class and style on its bar: written against the bar's colour, or as a value outside it on an open bar. */
	const onBar = ({ open, colour }: PlotBarGeometry) =>
		open ? (["value", ""] as const) : (["value inside", `--c:${colour}`] as const);

	/** Label of a stacked segment: centred when it fits, else none. */
	function segmentLabel(t: string, bar: PlotBarGeometry, textWidth: (s: unknown) => number) {
		const { horizontal, start, length, mid, each } = bar;
		const tw = textWidth(t);
		const fits = horizontal
			? length >= tw + 10 && each >= size() + 2
			: length >= size() + 6 && each >= tw + 6;
		const centre = start + length / 2;
		const [cls, style] = onBar(bar);
		return fits
			? svgText(cls, horizontal ? centre : mid, horizontal ? mid : centre, "middle", t, style)
			: "";
	}

	/**
	 * Where a side-by-side bar's label goes: past its end (`dir` is the screen direction it grows), or inside the end when the
	 * panel has no room past it; where a marker's line would cross it there, inside the end when it fits, else past the line.
	 * `from` is where the label starts out from, `inside` whether it runs back into the bar.
	 */
	function endSpot(reach: number, bar: PlotBarGeometry, crossing: readonly number[]) {
		const { length, end, dir, bound } = bar;
		const room = (from: number) => dir * (bound - from) >= reach;
		const clear = (a: number, b: number) =>
			crossing.every((at) => at <= Math.min(a, b) - 2 || at >= Math.max(a, b) + 2);
		const fits = length >= reach + 6;
		const past = (from: number) => ({
			from,
			inside: false,
			ok: room(from) && clear(from + dir * 4, from + dir * reach),
		});
		const back = { from: end, inside: true, ok: fits && clear(end - dir * reach, end - dir * 4) };
		// Where the label goes with no marker in the way, then the other side of the end, then past each line beyond it.
		const usual = room(end) || !fits ? past(end) : back;
		const beyond = crossing.filter((at) => dir * (at - end) > 0).sort((a, b) => dir * (a - b));
		return [usual, usual.inside ? past(end) : back, ...beyond.map(past)].find((s) => s.ok) ?? usual;
	}

	const overlaps = (a: PlotBox, b: PlotBox) =>
		a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;

	/**
	 * How far across its bar a label wider than the bar moves (along the category axis), so that it keeps off the other bars and
	 * the labels placed before it: none, else lined up with the bar's one edge or the other, so it runs out over the gap beside it.
	 */
	function sideways(
		box: (shift: number) => PlotBox,
		across: number,
		bar: PlotBarGeometry,
		room: PlotBarRoom,
	) {
		const over = Math.max(0, (across - bar.each) / 2);
		const clear = (shift: number) =>
			[...room.bars, ...room.placed].every((other) => !overlaps(box(shift), other));
		return [0, over, -over].find(clear) ?? 0;
	}

	/**
	 * The box of a bar's label tw px wide: from `along` on the value axis in the direction `at` (a horizontal bar's) or centred
	 * there (a column's), centred on `c` across.
	 */
	function labelBox(
		{ horizontal }: PlotBarGeometry,
		along: number,
		at: number,
		tw: number,
		c: number,
	): PlotBox {
		const half = size() / 2;
		if (horizontal) {
			const [x0, x1] = at > 0 ? [along, along + tw] : [along - tw, along];
			return { x0, x1, y0: c - half, y1: c + half };
		}
		return { x0: c - tw / 2, x1: c + tw / 2, y0: along - half, y1: along + half };
	}

	/** Where a bar's label lies on the value axis: where its text starts (a horizontal bar's) or its middle (a column's). */
	function alongOf(
		{ horizontal, cut }: PlotBarGeometry,
		from: number,
		at: number,
		inside: boolean,
	) {
		const past = inside && cut ? 12 : 0; // inside a cut bar, past the cut
		return from + at * ((horizontal ? 6 : size() / 2 + 4) + past);
	}

	/** A value's text at `along` on the value axis and `c` across, in the direction `at`, written on its bar when inside it. */
	function valueText(
		t: string,
		bar: PlotBarGeometry,
		along: number,
		c: number,
		at: number,
		inside: boolean,
	) {
		const [cls, style] = inside ? onBar(bar) : (["value", ""] as const);
		return bar.horizontal
			? svgText(cls, along, c, at > 0 ? "start" : "end", t, style)
			: svgText(cls, c, along, "middle", t, style);
	}

	/** Label of a side-by-side bar, where endSpot puts it, moved across where it would sit on another bar or label. */
	function endLabel(
		t: string,
		bar: PlotBarGeometry,
		textWidth: (s: unknown) => number,
		room: PlotBarRoom,
	) {
		const { horizontal, mid, dir } = bar;
		const tw = textWidth(t);
		const reach = horizontal ? tw + 6 : size() + 4;
		const { from, inside } = endSpot(reach, bar, room.crossing);
		const at = inside ? -dir : dir;
		const along = alongOf(bar, from, at, inside);
		const box = (shift: number) => labelBox(bar, along, at, tw, mid + shift);
		const shift = inside ? 0 : sideways(box, horizontal ? size() : tw, bar, room);
		room.placed.push(box(shift));
		return valueText(t, bar, along, mid + shift, at, inside);
	}

	/** A value label: inside a stacked segment when it fits, else at the end of a side-by-side bar. */
	const barLabel = (
		t: string,
		bar: PlotBarGeometry,
		stack: boolean,
		textWidth: (s: unknown) => number,
		room: PlotBarRoom,
	) => (stack ? segmentLabel(t, bar, textWidth) : endLabel(t, bar, textWidth, room));

	return { barLabel };
};
