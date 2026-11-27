import { ELEMENT_NAME_JS } from "./page-js.ts";

/**
 * Page-side check of the colour tokens a page may override, as the page computes them, returning one warning per token, scheme and
 * scope that falls short of the contrast the kit tunes its own colours to: --accent as text on --bg, --surface and --sunken (4.5:1,
 * the worst named), --accent-ink as text on --accent (4.5:1), and each series ink --c1..--c6 as a mark on --bg (3:1). The scopes are
 * :root and every element, body and SVG included, that sets one of those tokens to another value than its parent (a page may give a
 * block its own accent); an element is measured only for the tokens it changes, on the tones it inherits or sets, unless it changes
 * the color-scheme (the kit's .hero), where every token is measured. Values are resolved in one detached probe that takes the scope's
 * color-scheme, so light-dark() and color-mix() resolve as there, and read back through a 1 px canvas, so any colour syntax ends as
 * sRGB (an invalid value reads as transparent, which measures as the tone under it). The probe is added to the page, so check runs
 * this last on a load. Not measured: translucent tones (composited over white) and currentColor in a token. The scheme is the one the scope resolves light-dark() to, so a page with a fixed scheme names that scheme in both themes.
 */
export const CONTRAST_JS = `(() => {
	const name = ${ELEMENT_NAME_JS};
	const SERIES = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"];
	const FOREGROUND = ["--accent", "--accent-ink", ...SERIES];
	const SURFACES = ["--bg", "--surface", "--sunken"];
	const canvas = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	const paint = (colours) => {
		ctx.clearRect(0, 0, 1, 1);
		for (const colour of colours) { ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1); }
		const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
		return "rgb(" + r + ", " + g + ", " + b + ")";
	};
	const channels = (rgb) => rgb.match(/\\d+/g).map(Number);
	const luminance = (rgb) => channels(rgb).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
	const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
	const hex = (rgb) => "#" + channels(rgb).map((c) => c.toString(16).padStart(2, "0")).join("");
	const probe = document.createElement("span");
	probe.hidden = true;
	document.documentElement.append(probe);
	const resolve = (scheme, value) => { probe.style.colorScheme = scheme; probe.style.color = "transparent"; probe.style.color = value; return getComputedStyle(probe).color; };
	const styles = new Map();
	const style = (el) => { if (!styles.has(el)) styles.set(el, getComputedStyle(el)); return styles.get(el); };
	const token = (el, t) => style(el).getPropertyValue(t).trim();
	// An element that turns the scheme (a .hero) resolves every light-dark() token anew, so all of them are measured there.
	const changed = (el) => style(el).colorScheme !== style(el.parentElement).colorScheme ? FOREGROUND : FOREGROUND.filter((t) => token(el, t) !== token(el.parentElement, t));
	const root = document.documentElement;
	const scopes = [[root, FOREGROUND], ...[...document.querySelectorAll("body, body *")].map((el) => [el, changed(el)]).filter(([, tokens]) => tokens.length)];
	const warnings = [];
	try {
		for (const [el, tokens] of scopes) {
			const scheme = style(el).colorScheme;
			const solid = (t, under) => paint([under, resolve(scheme, token(el, t))]);
			const surfaces = SURFACES.filter((t) => token(el, t)).map((t) => ({ t, rgb: solid(t, "#fff") }));
			const bg = surfaces.find((s) => s.t === "--bg");
			const dark = luminance(paint([resolve(scheme, "light-dark(#000, #fff)")])) > 0.5;
			const scope = (dark ? "dark" : "light") + " (" + (el === root ? ":root" : name(el)) + ")";
			const fix = dark ? "lighten it" : "darken it";
			const warn = (t, worst, against, need) => warnings.push(t + " in " + scope + " is " + (Math.floor(worst.r * 100) / 100).toFixed(2) + ":1 on " + against + " " + hex(worst.rgb) + "; " + need);
			const least = (t, pairs) => pairs.map(({ t: on, rgb }) => ({ on, rgb, r: ratio(solid(t, rgb), rgb) })).sort((a, b) => a.r - b.r)[0];
			const has = (t) => tokens.includes(t) && token(el, t);
			if (has("--accent") && surfaces.length) {
				const worst = least("--accent", surfaces);
				if (worst.r < 4.5) warn("--accent", worst, worst.on, "text in it needs 4.5:1: " + fix);
			}
			if ((has("--accent") || has("--accent-ink")) && token(el, "--accent-ink") && token(el, "--accent") && bg) {
				const accent = solid("--accent", bg.rgb);
				const r = ratio(solid("--accent-ink", accent), accent);
				if (r < 4.5) warn("--accent-ink", { r, rgb: accent }, "--accent", "text on the accent needs 4.5:1: change --accent-ink or --accent");
			}
			for (const t of SERIES.filter(has)) {
				if (!bg) break;
				const r = ratio(solid(t, bg.rgb), bg.rgb);
				if (r < 3) warn(t, { r, rgb: bg.rgb }, "--bg", "a mark in it needs 3:1: " + fix);
			}
		}
	} finally {
		probe.remove();
	}
	return warnings;
})()`;
