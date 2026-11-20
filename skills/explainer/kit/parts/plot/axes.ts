/* plot axes: a plot's axes, not referenced from pages: pack joins it in front of plot.js with draw.ts, which uses it.
   PlotAxes({ formatter }) gives a numeric axis over a data extent with its ticks and labels (numericAxis), a category axis
   (categoryAxis), and place, which gives an axis its pixel interval. */
window.PlotAxes = ({ formatter }) => {
	const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
	const unplaced = { at: (v: number) => v, band: 0 };

	/** 1, 2, 5 times a power of ten giving about `count` steps over `span`. */
	function niceStep(span: number, count: number) {
		const raw = span / count;
		const p = 10 ** Math.floor(Math.log10(raw));
		const f = raw / p;
		return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
	}

	/** The multiples of step from lo to hi. */
	function steps(lo: number, hi: number, step: number) {
		const ticks: number[] = [];
		for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) {
			ticks.push(+(k * step).toFixed(10));
		}
		return ticks;
	}
	/** n values evenly from lo to hi, both included. */
	const spread = (lo: number, hi: number, n: number) =>
		Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / Math.max(1, n - 1));

	/** Numeric axis over the data extent (rangeOf); texts as its labels stand evenly from its min to its max, in place of the steps. */
	function numericAxis(
		spec: AxisSpec,
		data: readonly [number, number],
		length: number,
		vertical: boolean,
	): PlotNumericAxis {
		const { lo, hi, step } = rangeOf(spec, data, length, vertical);
		const format = formatter(spec.format);
		const said = Array.isArray(spec.labels) ? spec.labels : undefined;
		const ticks = said ? spread(lo, hi, said.length) : steps(lo, hi, step);
		return {
			lo,
			hi,
			ticks,
			format,
			labels: said ?? ticks.map((v) => (spec.labels === false ? "" : format(v))),
			name: spec.name,
			vertical,
			...unplaced,
		};
	}

	/**
	 * A numeric axis's range and step: min and max round outwards to the step unless given. An axis with texts of its own keeps
	 * the data's extent as it is, since the step, and so the rounding, depends on the plot's width.
	 */
	function rangeOf(
		spec: AxisSpec,
		[dataMin, dataMax]: readonly [number, number],
		length: number,
		vertical: boolean,
	) {
		let lo = spec.min ?? dataMin;
		let hi = spec.max ?? dataMax;
		if (!(hi > lo)) {
			lo -= 1;
			hi += 1;
		}
		const count = clamp(Math.round(length / (vertical ? 48 : 80)), 2, 10);
		const step = spec.step ?? niceStep(hi - lo, count);
		const round = !Array.isArray(spec.labels);
		if (spec.min == null && round) {
			lo = Math.floor(lo / step + 1e-9) * step;
		}
		if (spec.max == null && round) {
			hi = Math.ceil(hi / step - 1e-9) * step;
		}
		return { lo, hi, step };
	}

	/** Category axis: one band per name, ticks at the band centres; notes when a category has a second line. */
	function categoryAxis(
		spec: AxisSpec,
		categories: PlotCategory[],
		vertical: boolean,
		picked: number | undefined,
	): PlotCategoryAxis {
		const names = categories.map((c) => (typeof c === "string" ? c : c.name));
		const notes = categories.map((c) => (typeof c === "string" ? "" : (c.note ?? "")));
		const labelled = spec.labels !== false;
		return {
			names,
			notes: labelled && notes.some(Boolean) ? notes : undefined,
			picked,
			ticks: names.map((_, i) => i),
			labels: names.map((name) => (labelled ? String(name) : "")),
			name: spec.name,
			vertical,
			...unplaced,
		};
	}

	/** Gives the axis its pixel interval [a, b] and at(value), which maps a number, or a category index to its band centre. */
	function place(axis: PlotAxis, a: number, b: number) {
		if (axis.names) {
			const n = axis.names.length;
			axis.at = (i) => a + ((i + 0.5) * (b - a)) / n;
			axis.band = Math.abs(b - a) / n;
		} else {
			const { lo, hi } = axis;
			axis.at = (v) => a + ((clamp(v, lo, hi) - lo) / (hi - lo)) * (b - a);
		}
	}

	return { numericAxis, categoryAxis, place };
};
