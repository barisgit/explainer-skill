/* plot format: how kit:plot.js writes numbers, on axes and marks, in the page's lang; draw.ts (PlotDraw) takes it from
   PlotFormat({ lang }): formatter(format), a number's text by an axis's format, and labeller(label, format, stem), a series'
   values' texts by its label. */
window.PlotFormat = ({ lang }) => {
	/**
	 * The Intl options of a JSON number format (NumberFormat in kit-types/globals.d.ts), built as kit/components/parts/format.ts
	 * builds them: a plain number groups from five digits, so a year stays 2024; money always groups, so 4,200 stands beside 11,200,
	 * and a whole amount has no cents unless `digits` asks for them; percent wins over a currency.
	 */
	/** A percent stays one beside a currency, as Table writes it; money groups thousands always and drops whole cents. */
	const money = (currency: string | undefined, digits: number | undefined) => ({
		useGrouping: currency ? ("always" as const) : ("min2" as const),
		...(currency ? { currency } : {}),
		...(currency && digits === undefined ? { trailingZeroDisplay: "stripIfInteger" as const } : {}),
	});
	const intlOptions = ({
		digits,
		percent,
		currency,
		compact,
	}: NumberFormat): Intl.NumberFormatOptions => ({
		style: percent ? "percent" : currency ? "currency" : "decimal",
		...money(currency, digits),
		...(compact ? { notation: "compact" } : {}),
		...(digits === undefined
			? {}
			: { minimumFractionDigits: digits, maximumFractionDigits: digits }),
	});
	/** Writes a number in a JSON format as the page's lang does. A word unit stands apart (18 min), a symbol joins it (90%). */
	function numberText(format: NumberFormat) {
		const intl = new Intl.NumberFormat(lang(), intlOptions(format));
		const { unit = "" } = format;
		const after = /^\p{L}/u.test(unit) ? `\u00a0${unit}` : unit;
		return (v: number) => intl.format(v) + after;
	}
	/** Without a format, numbers are written in full, as String writes them, with the page's decimal mark, minus and grouping. */
	function inFull() {
		const intl = new Intl.NumberFormat(lang(), {
			useGrouping: "min2",
			maximumFractionDigits: 20,
		});
		return (v: number) => intl.format(v);
	}
	const formatter = (format: AxisSpec["format"]): ((v: number) => string) =>
		typeof format === "function" ? format : format ? numberText(format) : inFull();
	const isTexts = (label: PlotSeries["label"]): label is readonly string[] => Array.isArray(label);
	/** The series' label as a PlotLabeller (`format` writes the value for label: true), or none when it asks for no labels. */
	function labeller(label: PlotSeries["label"], format: (v: number) => string, stem: boolean) {
		if (!label) {
			return undefined;
		}
		if (typeof label === "function") {
			return stem
				? (v: number, i: number, x: number) => label(x, v, i)
				: (v: number, i: number) => label(v, i);
		}
		if (isTexts(label)) {
			return (_: number, i: number) => label[i] ?? "";
		}
		return label === true ? format : numberText(label);
	}

	return { formatter, labeller };
};
