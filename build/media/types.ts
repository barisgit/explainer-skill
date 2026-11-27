/** Scene data shared by the media script and the code that plays it. */

export type Theme = "light" | "dark";

/** Every output is written once per theme, `<name>-<theme>.webp`, so the README can follow the viewer's. */
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
	/** Clicks the target's centre, or the point `at` that many widths and heights into its box: a mark on a canvas. */
	| { do: "click"; target: string; at?: [number, number]; travel?: number; hold?: number }
	/** Moves the cursor onto the target (its centre or `at`) and leaves it there, for what a page shows under the pointer. */
	| { do: "hover"; target: string; at?: [number, number]; travel?: number; hold?: number }
	/** Presses a range input's thumb at the first value and drags it through the others, `ms` per leg. */
	| { do: "drag"; selector: string; values: number[]; ms: number; travel?: number; hold?: number }
	/** Scrolls the page over `ms` until the first element matching `to` is at the top of the viewport; the cursor is put away. */
	| { do: "scroll"; to: string; ms: number; hold?: number }
	/**
	 * Clicks a `<select>` and picks `value`, or the value for the clip's theme. A native list draws outside the page, so
	 * the click is shown with the cursor and the value set as the reader's choice would set it.
	 */
	| {
			do: "select";
			target: string;
			value: string | Record<Theme, string>;
			travel?: number;
			hold?: number;
	  };

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
	/** The recorded area; left out, the whole viewport, which a clip with `scroll` actions wants. */
	region?: Region;
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

/** One page's part of a clip that plays several pages in turn: opened fresh, scrolled to `scrollTo`, then played. */
export interface Scene {
	/** Directory name under `examples/`. */
	page: string;
	hash?: string;
	scrollTo?: string;
	actions: Action[];
}

/** A clip of scenes from several pages, cut together in order: `examples/media/<name>-<theme>.webp`. */
export interface Reel extends Omit<Clip, "scrollTo" | "region" | "hash" | "actions"> {
	scenes: Scene[];
}

export interface Example {
	/** Directory name under `examples/`; the page is `examples/<name>/index.html`. */
	name: string;
	/**
	 * Whether the README shows the headline and complete opening figure as a card. `window` replaces the default for a
	 * figure that needs a wider screen to keep its layout; `until` names the opening's last element when it is not the
	 * first figure.
	 */
	card: boolean | { window?: Size; until?: string };
	clips: Clip[];
}
