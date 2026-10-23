import { writeFileSync } from "node:fs";
import { type Cdp, settle } from "../../skills/explainer/src/chrome.ts";
import type { Rect, Region, Size, Theme } from "./types.ts";

/** Device pixels per CSS pixel in every capture: text stays sharp when the image is shown at its CSS size on a dense screen. */
export const SCALE = 2;

/** Room above an element that `scrollToTop` leaves, so a region padded by a few pixels stays inside the viewport. */
const TOP_MARGIN = 16;

/**
 * Opens `url` in a fresh load at `viewport` with the colour scheme of `theme`. Local storage is emptied first because every
 * file:// page shares one origin and the pages keep what the reader enters. `reduceMotion` makes transitions finish at once,
 * which stills want; clips want the motion.
 */
export async function open(
	cdp: Cdp,
	url: string,
	viewport: Size,
	theme: Theme,
	reduceMotion: boolean,
) {
	await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		...viewport,
		deviceScaleFactor: SCALE,
		mobile: false,
	});
	await cdp.send("Emulation.setEmulatedMedia", {
		features: [
			{ name: "prefers-color-scheme", value: theme },
			{ name: "prefers-reduced-motion", value: reduceMotion ? "reduce" : "no-preference" },
		],
	});
	const blank = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url: "about:blank" });
	await blank;
	await cdp.send("Storage.clearDataForOrigin", {
		origin: "file://",
		storageTypes: "local_storage",
	});
	const loaded = cdp.once("Page.loadEventFired");
	await cdp.send("Page.navigate", { url });
	await loaded;
	await settle(800);
}

/**
 * Writes the PNG of the current viewport, or of `clip` (CSS pixels from the top left of the viewport) when given.
 * The protocol measures a clip from the top left of the page, so the scroll position is added: a clip then keeps
 * showing the same part of the screen when the page scrolls or a drill-down view resets it. `scale` multiplies the
 * image size (`SCALE` times the CSS size at 1), so a clip can be captured at the size it is encoded at.
 */
export async function screenshot(cdp: Cdp, file: string, clip?: Rect, scale = 1) {
	const scroll = clip ? await cdp.evaluate<[number, number]>("[scrollX, scrollY]") : [0, 0];
	const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
		format: "png",
		...(clip && {
			clip: { ...clip, x: clip.x + (scroll[0] ?? 0), y: clip.y + (scroll[1] ?? 0), scale },
		}),
	});
	writeFileSync(file, Buffer.from(data, "base64"));
}

/** The box of the first element matching `selector`, in viewport coordinates; throws when there is none or it has no size. */
export async function boxOf(cdp: Cdp, selector: string): Promise<Rect> {
	const box = await cdp.evaluate<Rect | null>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const { x, y, width, height } = el.getBoundingClientRect();
		return { x, y, width, height };
	})()`);
	if (!box || box.width === 0 || box.height === 0) {
		throw new Error(`no visible element matches ${selector}`);
	}
	return box;
}

/**
 * Scrolls so that the first element matching `selector` starts `TOP_MARGIN` below the top of the viewport, or below what
 * the page keeps fixed there: the kit's reply strip sets the root's scroll padding to its height. Under the strip the
 * element would be covered in the frames, and the recorded clicks and drags would land on the strip.
 */
export async function scrollToTop(cdp: Cdp, selector: string) {
	await cdp.evaluate(`(() => {
		const covered = parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockStart) || 0;
		const top = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top;
		scrollBy(0, top - covered - ${TOP_MARGIN});
	})()`);
	await settle(300);
}

/** Resolves a region to whole CSS pixels: a fractional clip would blur the edges. */
export async function resolveRegion(cdp: Cdp, region: Region): Promise<Rect> {
	if (!("selector" in region)) {
		return region;
	}
	const box = await boxOf(cdp, region.selector);
	const pad = region.pad ?? 0;
	const x = Math.floor(box.x - pad);
	const y = Math.floor(box.y - pad);
	return {
		x,
		y,
		width: Math.ceil(box.x + box.width + pad) - x,
		height: region.height ?? Math.ceil(box.y + box.height + pad) - y,
	};
}
