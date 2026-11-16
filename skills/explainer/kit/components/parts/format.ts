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
export const pageLang = (): string =>
	(typeof document === "undefined" ? packLang : document.documentElement.lang) || "en";

/** The page's frontmatter labels: kitLabels, which pack defines while it renders and the page defines in the browser. */
export const pageLabels = (): Readonly<Record<string, string>> =>
	(typeof kitLabels === "undefined" ? undefined : kitLabels) ?? {};

/**
 * The Intl options of a NumberFormat; plot.js and charts.js build the same. A plain number groups from five digits, so a year stays
 * 2024; money always groups, so 4,200 stands beside 11,200, and a whole amount has no cents unless `digits` asks for them.
 */
const intlOptions = ({
	digits,
	percent,
	currency,
	compact,
}: NumberFormat): Intl.NumberFormatOptions => ({
	style: percent ? "percent" : currency ? "currency" : "decimal",
	useGrouping: currency ? "always" : "min2",
	...(currency ? { currency } : {}),
	...(currency && digits === undefined ? { trailingZeroDisplay: "stripIfInteger" } : {}),
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
