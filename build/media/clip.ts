import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Cdp } from "../../skills/explainer/src/cdp.ts";
import { settle } from "../../skills/explainer/src/chrome.ts";
import { boxOf, resolveRegion, SCALE, screenshot, scrollToTop, TOP_MARGIN } from "./page.ts";
import type { Action, Clip, Frame, Rect, Theme } from "./types.ts";
import { DEFAULT_HOLD, DEFAULT_TRAVEL } from "./types.ts";

/** How long the mouse button stays down in a click, long enough to show in at least one frame. */
const PRESS_MS = 140;
/** Width of a native range thumb in Chrome: the track the value maps onto is the input's width minus this. */
const THUMB_PX = 16;
/** Where the cursor first appears, relative to its first target. */
const ENTRY = { x: 90, y: 60 };

/** A dot with a light ring, readable on both themes; it shrinks while the button is down. */
const CURSOR_JS = `(() => {
	const dot = document.createElement("div");
	dot.id = "media-cursor";
	dot.style.cssText = "position:fixed;left:0;top:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;"
		+ "background:rgba(24,24,27,.2);border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.3);"
		+ "pointer-events:none;z-index:2147483647;display:none";
	document.body.append(dot);
})()`;

interface Point {
	x: number;
	y: number;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Plays actions against the page in real time and captures the region as fast as the pace allows. The cursor and the slider
 * follow the clock, not the frame count, so playback speed is right whatever the captures cost; the frames' own timestamps
 * become their durations when encoded.
 */
class Recorder {
	readonly frames: Frame[] = [];
	private readonly cdp: Cdp;
	private readonly dir: string;
	private readonly region: Rect;
	private readonly scale: number;
	private readonly paceMs: number;
	private start = 0;
	private cursor: Point | null = null;
	private pressed = false;

	constructor(cdp: Cdp, dir: string, region: Rect, scale: number, fps: number) {
		this.cdp = cdp;
		this.dir = dir;
		this.region = region;
		this.scale = scale;
		this.paceMs = 1000 / fps;
	}

	/** Captures the region, no sooner than the pace allows after the previous frame. */
	private async frame() {
		const last = this.frames.at(-1);
		const wait = last ? last.at + this.paceMs - (performance.now() - this.start) : 0;
		if (wait > 0) {
			await settle(wait);
		}
		this.start ||= performance.now();
		const file = join(this.dir, `f${String(this.frames.length).padStart(4, "0")}.png`);
		const at = performance.now() - this.start;
		await screenshot(this.cdp, file, this.region, this.scale);
		this.frames.push({ file, at });
	}

	/** Calls `step` with the eased progress, 0 to 1, before every frame until `ms` have passed, and once more at 1. */
	private async tween(ms: number, step: (progress: number) => Promise<void>) {
		const begin = performance.now();
		for (let t = 0; t < 1; ) {
			t = ms > 0 ? Math.min(1, (performance.now() - begin) / ms) : 1;
			await step(ease(t));
			await this.frame();
		}
	}

	/** Moves the pointer to `at` and draws the dot there. */
	private async place(at: Point) {
		this.cursor = at;
		await this.cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			...at,
			...(this.pressed && { button: "left", buttons: 1 }),
		});
		await this.drawDot(at);
	}

	private async drawDot(at: Point) {
		await this.cdp.evaluate(`(() => {
			const dot = document.getElementById("media-cursor");
			dot.style.display = "block";
			dot.style.transform = "translate(${at.x}px, ${at.y}px) scale(${this.pressed ? 0.75 : 1})";
		})()`);
	}

	private async button(type: "mousePressed" | "mouseReleased") {
		const at = this.cursor;
		if (!at) {
			throw new Error("the button was used before the cursor appeared");
		}
		this.pressed = type === "mousePressed";
		await this.cdp.send("Input.dispatchMouseEvent", {
			type,
			...at,
			button: "left",
			buttons: this.pressed ? 1 : 0,
			clickCount: 1,
		});
		await this.drawDot(at);
	}

	/** Records for `ms` with nothing moving. */
	async hold(ms: number) {
		await this.tween(ms, async () => {});
	}

	/** Moves the cursor to `to` over `ms`, easing in and out; the first move starts from beside the target. */
	async travel(to: Point, ms: number) {
		const from = this.cursor ?? { x: to.x + ENTRY.x, y: to.y + ENTRY.y };
		await this.tween(ms, (t) => this.place({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) }));
	}

	/** Presses, waits `PRESS_MS` and releases, which is what makes the page see a click. */
	async click() {
		await this.press();
		await this.hold(PRESS_MS);
		await this.release();
	}

	async press() {
		await this.button("mousePressed");
	}

	/** Scrolls the page to `to` over `ms`, easing in and out, with the cursor put away: it would ride along over the page. */
	async scroll(to: number, ms: number) {
		this.cursor = null;
		await this.cdp.evaluate(`document.getElementById("media-cursor").style.display = "none"`);
		const from = await this.cdp.evaluate<number>("scrollY");
		await this.tween(ms, async (t) => {
			await this.cdp.evaluate(`scrollTo(0, ${lerp(from, to, t)})`);
		});
	}

	async release() {
		await this.button("mouseReleased");
	}

	/** Shows a press at the cursor without sending one: what a click on a control looks like when the page is told otherwise. */
	async showPress() {
		const at = this.cursor;
		if (!at) {
			throw new Error("a press was shown before the cursor appeared");
		}
		this.pressed = true;
		await this.drawDot(at);
		await this.hold(PRESS_MS);
		this.pressed = false;
		await this.drawDot(at);
	}
}

/** Sets the `<select>` matching `target` to `value` and tells the page, as a reader's pick does. */
async function choose(cdp: Cdp, target: string, value: string) {
	const done = await cdp.evaluate<boolean>(`(() => {
		const select = document.querySelector(${JSON.stringify(target)});
		if (!(select instanceof HTMLSelectElement)) return false;
		select.value = ${JSON.stringify(value)};
		select.dispatchEvent(new Event("input", { bubbles: true }));
		select.dispatchEvent(new Event("change", { bubbles: true }));
		return select.value === ${JSON.stringify(value)};
	})()`);
	if (!done) {
		throw new Error(`${target} is no select with the value ${value}`);
	}
}

/** Where a click on the first element matching `target` lands, in viewport coordinates: its centre, or `at` into its box. */
async function centreOf(
	cdp: Cdp,
	target: string,
	at: [number, number] = [0.5, 0.5],
): Promise<Point> {
	const box = await boxOf(cdp, target);
	return { x: box.x + box.width * at[0], y: box.y + box.height * at[1] };
}

/** Where the thumb of the range input `selector` sits when its value is `value`. */
async function thumbAt(cdp: Cdp, selector: string, value: number): Promise<Point> {
	const [box, min, max] = await Promise.all([
		boxOf(cdp, selector),
		cdp.evaluate<number>(`Number(document.querySelector(${JSON.stringify(selector)}).min || 0)`),
		cdp.evaluate<number>(`Number(document.querySelector(${JSON.stringify(selector)}).max || 100)`),
	]);
	const share = (value - min) / (max - min);
	return {
		x: box.x + THUMB_PX / 2 + share * (box.width - THUMB_PX),
		y: box.y + box.height / 2,
	};
}

/** The scroll position that puts the first element matching `selector` at the top of the viewport, as `scrollToTop` does. */
async function scrollTopOf(cdp: Cdp, selector: string): Promise<number> {
	const box = await boxOf(cdp, selector);
	const [y, max] = await cdp.evaluate<[number, number]>(
		"[scrollY, document.documentElement.scrollHeight - innerHeight]",
	);
	return Math.max(0, Math.min(max, y + box.y - TOP_MARGIN));
}

async function perform(cdp: Cdp, rec: Recorder, action: Action, theme: Theme) {
	const travel = "travel" in action ? (action.travel ?? DEFAULT_TRAVEL) : 0;
	switch (action.do) {
		case "wait":
			await rec.hold(action.ms);
			return;
		case "click":
			await rec.travel(await centreOf(cdp, action.target, action.at), travel);
			await rec.click();
			await rec.hold(action.hold ?? DEFAULT_HOLD);
			return;
		case "hover":
			await rec.travel(await centreOf(cdp, action.target, action.at), travel);
			await rec.hold(action.hold ?? DEFAULT_HOLD);
			return;
		case "select":
			await rec.travel(await centreOf(cdp, action.target), travel);
			await rec.showPress();
			await choose(
				cdp,
				action.target,
				typeof action.value === "string" ? action.value : action.value[theme],
			);
			await rec.hold(action.hold ?? DEFAULT_HOLD);
			return;
		case "scroll":
			await rec.scroll(await scrollTopOf(cdp, action.to), action.ms);
			await rec.hold(action.hold ?? DEFAULT_HOLD);
			return;
		case "drag": {
			const [first = 0, ...rest] = action.values;
			await rec.travel(await thumbAt(cdp, action.selector, first), travel);
			await rec.press();
			for (const value of rest) {
				await rec.travel(await thumbAt(cdp, action.selector, value), action.ms);
			}
			await rec.release();
			await rec.hold(action.hold ?? DEFAULT_HOLD);
			return;
		}
	}
}

/**
 * Plays `clip` on the page that is already open and writes its frames into `dir`; returns them in order.
 */
export async function record(cdp: Cdp, clip: Clip, dir: string, theme: Theme): Promise<Frame[]> {
	mkdirSync(dir, { recursive: true });
	if (clip.scrollTo) {
		await scrollToTop(cdp, clip.scrollTo);
	}
	const region = clip.region
		? await resolveRegion(cdp, clip.region)
		: { x: 0, y: 0, ...clip.viewport };
	await cdp.evaluate(CURSOR_JS);
	await settle(300);
	const rec = new Recorder(cdp, dir, region, clip.width / (region.width * SCALE), clip.fps);
	for (const action of clip.actions) {
		await perform(cdp, rec, action, theme);
	}
	return rec.frames;
}
