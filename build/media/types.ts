/** Scene data shared by the media script and the code that plays it. */

export type Theme = "light" | "dark";

/** Every output is written once per theme, `<name>-<theme>.webp`, so the README and the gallery can follow the viewer's. */
export const THEMES: readonly Theme[] = ["light", "dark"];

export interface Size {
	width: number;
	height: number;
}

/** A rectangle in CSS pixels, from the top left of the viewport. */
export interface Rect extends Size {
	x: number;
	y: number;
}

/**
 * One interaction in a clip. Times are milliseconds of page time; the cursor takes `travel` to reach the control
 * (default {@link DEFAULT_TRAVEL}) and recording goes on for `hold` (default {@link DEFAULT_HOLD}) after the action so
 * the reaction is visible.
 */
export type Action =
	| { do: "wait"; ms: number }
	| { do: "click"; target: Target; travel?: number; hold?: number }
	/** Presses a range input's thumb at the first value and drags it through the others, `ms` per leg. */
	| { do: "drag"; selector: string; values: number[]; ms: number; travel?: number; hold?: number };

/** What a click lands on: the centre of the first element matching a selector, or one bar of an ECharts bar chart. */
export type Target = string | { bar: { chart: string; index: number } };

export const DEFAULT_TRAVEL = 600;
export const DEFAULT_HOLD = 600;

/** What a recording keeps of each frame: its file and when it was captured, in ms since the first. */
export interface Frame {
	file: string;
	at: number;
}

/** The recorded area: an element's box grown by `pad` and cut to `height` when given (measured once, after `scrollTo`), or a fixed rectangle. */
export type Region = { selector: string; pad?: number; height?: number } | Rect;

export interface Clip {
	/** Names the files: `examples/media/<example>-<name>-<theme>.webp`, one per theme. */
	name: string;
	viewport: Size;
	/** Element to scroll to the top of the viewport before recording; the region is measured afterwards. */
	scrollTo?: string;
	region: Region;
	/** Width of the encoded clip in pixels; up to twice the region's CSS width stays sharp. */
	width: number;
	/** Most frames per second; captures slower than this set the pace. */
	fps: number;
	/** libwebp quality, 0 to 100. */
	quality: number;
	/** Location hash to open the page at. */
	hash?: string;
	actions: Action[];
}

export interface Example {
	/** Directory name under `examples/`; the page is `examples/<name>/index.html`. */
	name: string;
	clips: Clip[];
}
