/* plot legend: a plot's legend buttons, not referenced from pages: pack joins it in front of plot.js with draw.ts, which uses
   it. PlotLegend({ swatch, esc, colour, dash, fill, pick }) gives markup(option, atEnds), the buttons or a picked category's
   key, and switchedOn(series, off), which series the legend leaves on. */
window.PlotLegend = ({ swatch, esc, colour, dash, fill, pick }) => {
	/**
	 * A series' legend swatch: a line in its dash, or a square in its bars' state when every bar takes that one; bars in mixed
	 * states show the series' colour, and the page's chips say what the states mean.
	 */
	function swatchOf(s: PlotSeries, i: number) {
		const type = s.type ?? "line";
		const states = new Set(s.data.map((_, k) => fill(s, k)));
		const [state] = type === "bar" && states.size === 1 ? states : [undefined];
		return swatch(type, colour(s, i), type === "line" ? dash(s, i) : "", state);
	}

	/**
	 * Legend buttons for the named series, or "" when the legend is off, has fewer than two entries or the names sit at the line
	 * ends (`atEnds`). A bar plot with a picked category has its key instead, from one named series: the category's name, then
	 * each series' value there after its name.
	 */
	function markup(option: PlotOption, atEnds: boolean) {
		const named = (option.series ?? []).map((s, i) => [s, i] as const).filter(([s]) => s.name);
		const at = pick.pickedAt(option);
		if (option.legend === false || named.length < (at === undefined ? 2 : 1)) {
			return "";
		}
		if (at !== undefined) {
			return pick.key(
				option,
				at,
				named.map(([s, i]) => [s, i, swatchOf(s, i)] as const),
			);
		}
		if (atEnds) {
			return "";
		}
		return named
			.map(
				([s, i]) =>
					`<li><button type="button" data-i="${i}">${swatchOf(s, i)}${esc(s.name)}</button></li>`,
			)
			.join("");
	}

	/** Per series: whether it is switched on. An unnamed series belongs to the named one before it. */
	function switchedOn(series: PlotSeries[], off: Set<string | undefined>) {
		let owner: string | undefined;
		return series.map((s) => {
			owner = s.name ?? owner;
			return !off.has(owner);
		});
	}

	return { markup, switchedOn };
};
