/* plot pick: what a bar plot's picked category (option.pick) adds, for draw.ts (PlotDraw): a frame in ink around its bars, and
   the key that takes the legend's place, its name over each series' swatch, name and value there, which a screen reader also
   hears on that category's control (keyText). Not referenced from pages: pack joins it in front of plot.js. */
window.PlotPick = ({ esc, formatter, labeller }) => {
	/** px between the frame and the bars it surrounds. */
	const AROUND = 4;
	const px = (v: number) => +v.toFixed(1);

	/** The picked category of a bar plot, or undefined when it has none. */
	const pickedAt = ({ pick: at, categories }: PlotOption) =>
		typeof at === "number" && categories?.[at] !== undefined ? at : undefined;

	/** The values the frame spans along the value axis: from 0 to the stack's ends, or to the farthest bars side by side. */
	function span(values: readonly number[], stack: boolean): [number, number] {
		const sum = (sign: number) => values.filter((v) => v * sign > 0).reduce((a, b) => a + b, 0);
		return stack ? [sum(-1), sum(1)] : [Math.min(0, ...values), Math.max(0, ...values)];
	}

	/** The frame, AROUND px out, around the picked category's bars of these series, from the baseline to their far end; "" for none. */
	function frame(series: readonly PlotSeries[], stack: boolean, bars: PlotPickedBars) {
		const { cat, val, thick, horizontal } = bars;
		const at = cat.picked;
		if (at === undefined) {
			return "";
		}
		const centre = cat.at(at);
		const values = series.flatMap((s) => {
			const v = s.data[at];
			return typeof v === "number" && Number.isFinite(v) ? [v] : [];
		});
		const [a, b] = span(values, stack).map(val.at) as [number, number];
		const [across, along, length] = [centre - thick / 2, Math.min(a, b), Math.abs(b - a)];
		const [x, y, w, h] = horizontal
			? [along, across, length, thick]
			: [across, along, thick, length];
		return `<rect class="picked" x="${px(x - AROUND)}" y="${px(y - AROUND)}" width="${px(w + 2 * AROUND)}" height="${px(h + 2 * AROUND)}"/>`;
	}

	/**
	 * A bar's value as its label's format writes it, else as the value axis does (a label of texts says something else, so the key
	 * keeps the number); "" for a bar with no value.
	 */
	function valueText(option: PlotOption) {
		const format = formatter((option.horizontal ? option.x : option.y)?.format);
		return (s: PlotSeries, i: number) => {
			const v = s.data[i];
			if (typeof v !== "number" || !Number.isFinite(v)) {
				return "";
			}
			const label = Array.isArray(s.label) ? undefined : s.label;
			return (labeller(label, format, false) ?? format)(v, i, 0);
		};
	}

	/** Each named series' value in category i, as the key gives it: "bought 403 kWh, sold 12 kWh". */
	function keyText(option: PlotOption, i: number) {
		const value = valueText(option);
		return (option.series ?? [])
			.flatMap((s) => (s.name ? [`${s.name} ${value(s, i)}`.trim()] : []))
			.join(", ");
	}

	/**
	 * The key for category `at`: its name, then a button per named series (`named`, with its index and swatch) that switches it as
	 * the legend's do, its value after its name.
	 */
	function key(
		option: PlotOption,
		at: number,
		named: readonly (readonly [PlotSeries, number, string])[],
	) {
		const c = option.categories?.[at];
		const value = valueText(option);
		const head = `<li class="key-head">${esc(typeof c === "object" ? c.name : String(c ?? ""))}</li>`;
		return `${head}${named
			.map(([s, i, swatch]) => {
				const v = value(s, at);
				return `<li><button type="button" data-i="${i}">${swatch}${esc(s.name)}${v ? `<span class="v">${esc(v)}</span>` : ""}</button></li>`;
			})
			.join("")}`;
	}

	/**
	 * Where a bar plot's categories lie along their axis in the plot's box as drawn (below the marker labels on top and the room
	 * kept for names): from `start` to `end` px, `count` equal bands, `vertical` when they run down the plot; undefined for a
	 * plot without categories or too small to draw.
	 */
	function bands(option: PlotOption, box: { L: number; R: number; T: number; B: number }) {
		const count = option.categories?.length;
		const [start, end] = option.horizontal ? [box.T, box.B] : [box.L, box.R];
		return !count || end - start < 40
			? undefined
			: { start, end, count, vertical: Boolean(option.horizontal) };
	}

	return { pickedAt, frame, keyText, key, bands };
};
