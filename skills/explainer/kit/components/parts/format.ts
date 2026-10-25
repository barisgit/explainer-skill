/*
 * Numbers as the page's language writes them, for components that write them while pack renders the page (Table, Explore's
 * slider readout). A NumberFormat (kit-types/globals.d.ts) means the same here as in plot.js and charts.js, which write it in
 * the browser.
 */

let packLang = "";

/** Sets the language pack renders the page in: its frontmatter `lang`. */
export function setPageLang(lang: string): void {
	packLang = lang;
}

/** The page's language: `<html lang>` in the browser, the frontmatter's while pack renders. */
const pageLang = () =>
	(typeof document === "undefined" ? packLang : document.documentElement.lang) || "en";

/** The Intl options of a NumberFormat; plot.js and charts.js build the same. */
const intlOptions = ({
	digits,
	percent,
	currency,
	compact,
}: NumberFormat): Intl.NumberFormatOptions => ({
	style: percent ? "percent" : currency ? "currency" : "decimal",
	useGrouping: "min2", // 12 345, but a year stays 2024
	...(currency ? { currency } : {}),
	...(compact ? { notation: "compact" } : {}),
	...(digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
});

/** Writes numbers in `format` for the page's language. A word unit stands apart (18 min), a symbol joins the number (90%). */
export function numberText(format: NumberFormat = {}): (value: number) => string {
	const intl = new Intl.NumberFormat(pageLang(), intlOptions(format));
	const { unit = "" } = format;
	const after = /^\p{L}/u.test(unit) ? `\u00a0${unit}` : unit;
	return (value) => intl.format(value) + after;
}
