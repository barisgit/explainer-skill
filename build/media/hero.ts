import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Cdp, settle } from "../../skills/explainer/src/chrome.ts";
import { SCALE, screenshot } from "./page.ts";
import type { Size } from "./types.ts";

/** Width the README shows the hero at, in CSS pixels; the image is rendered at `SCALE` times this. */
const HERO_WIDTH = 880;
const GAP = 16;
const MARGIN = 20;
const COLUMNS = 2;

/**
 * The collage page: one tile per first-screen PNG of `still` CSS pixels, in a grid. The page background is transparent so the image sits on
 * either GitHub theme; the faint ring and shadow keep tile edges visible on both.
 */
function layout(tiles: string[], still: Size): string {
	const cells = tiles
		.map((png) => `<div class="tile"><img src="file://${png}" alt=""></div>`)
		.join("\n");
	return `<!doctype html>
<meta charset="utf-8">
<style>
	html, body { margin: 0; background: transparent; }
	body { padding: ${MARGIN}px; display: grid; grid-template-columns: repeat(${COLUMNS}, 1fr); gap: ${GAP}px; }
	.tile { aspect-ratio: ${still.width} / ${still.height}; border-radius: 10px; overflow: hidden;
		box-shadow: 0 0 0 1px rgba(128, 128, 128, 0.3), 0 6px 20px rgba(0, 0, 0, 0.14); }
	img { display: block; inline-size: 100%; }
</style>
${cells}`;
}

/** Writes the collage of `tiles` to `out` as a PNG, `HERO_WIDTH * SCALE` pixels wide. */
export async function renderHero(
	cdp: Cdp,
	tiles: string[],
	still: Size,
	work: string,
	out: string,
) {
	await cdp.send("Page.enable");
	const rows = Math.ceil(tiles.length / COLUMNS);
	const tileWidth = (HERO_WIDTH - 2 * MARGIN - (COLUMNS - 1) * GAP) / COLUMNS;
	const tileHeight = (tileWidth * still.height) / still.width;
	const height = Math.ceil(2 * MARGIN + rows * tileHeight + (rows - 1) * GAP);
	const page = join(work, "hero.html");
	writeFileSync(page, layout(tiles, still));
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: HERO_WIDTH,
		height,
		deviceScaleFactor: SCALE,
		mobile: false,
	});
	await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
		color: { r: 0, g: 0, b: 0, a: 0 },
	});
	const loaded = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url: `file://${page}` });
	await loaded;
	await settle(500);
	await screenshot(cdp, out);
}
