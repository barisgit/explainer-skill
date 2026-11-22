/* reply place: where kit:reply.js's note hint and popover sit. Not referenced from pages: pack joins it in front of reply.js, whose
   notes part calls it once with the element whose content takes notes, the column they stay in. It returns
     hint(popup, at)               the small Add note button: above the target's document rect `at`, else beside it, else below
     beside(popup, live, lost)     the popover, under or over what `live()` returns; a function to call with fit = true after a
                                   size change (it may scroll the window to show the popover whole) or false after a scroll (it
                                   only follows its target); `lost` runs when the target is no longer drawn. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the function only scopes the part's names away from the page; the code in it is split into small functions
window.ReplyPlace = (root) => {
	/** Above or below the target; if neither fits, scroll only the shorter feasible distance to make one fit. */
	function vertical(at: DOMRect, height: number) {
		const above = at.top - height - 6;
		const below = at.bottom + 6;
		if (above >= 8) {
			return above;
		}
		if (below + height <= innerHeight - 8) {
			return below;
		}
		const bottom = document.documentElement.scrollHeight - innerHeight;
		const fit = [
			{ top: above, delta: above - 8 },
			{ top: below, delta: below + height + 8 - innerHeight },
		]
			.filter(({ delta }) => scrollY + delta >= 0 && scrollY + delta <= bottom)
			.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
		if (!fit) {
			return below;
		}
		const before = scrollY;
		scrollBy(0, fit.delta);
		return fit.top - (scrollY - before);
	}

	/** The page column's inner edges in the viewport, which an overlay stays between; also caps the overlay's size. */
	function columnFor(popup: HTMLElement) {
		const column = root.getBoundingClientRect();
		const left = Math.max(8, column.left);
		const right = Math.min(innerWidth - 8, column.right);
		popup.style.maxWidth = `${Math.max(0, right - left)}px`;
		const { top, bottom } = seen();
		popup.style.maxHeight = `${bottom - top}px`;
		return { left, right };
	}

	/** The hint, a measured overlay inside the column and viewport: above the target, else beside, below, then clamped. */
	function position(popup: HTMLElement, anchor: DOMRect) {
		const at = new DOMRect(anchor.x - scrollX, anchor.y - scrollY, anchor.width, anchor.height);
		const { left, right } = columnFor(popup);
		const { width, height } = popup.getBoundingClientRect();
		const clampX = (x: number) => Math.max(left, Math.min(x, right - width));
		const clampY = (y: number) => Math.max(8, Math.min(y, innerHeight - height - 8));
		let x = clampX(at.right - width);
		let y = at.top - height - 6;
		// Above keeps following prose clear; beside is useful for a selection at the very top of the screen.
		if (y < 8) {
			if (at.right + 6 + width <= right) {
				x = at.right + 6;
				y = at.bottom - height;
			} else {
				y = vertical(at, height);
			}
		}
		popup.style.left = `${clampX(x) + scrollX}px`;
		popup.style.top = `${clampY(y) + scrollY}px`;
	}

	/** The popover's distance from the target, room for its tip. */
	const GAP = 8;
	type Side = "below" | "above";

	/** The target's drawn lines in the viewport: a selection's line boxes, a part's box. */
	function lines(live: () => NoteTarget | null) {
		const target = live();
		const rects = target instanceof Range ? [...target.getClientRects()] : [];
		const boxes = target instanceof Range ? rects : target ? [target.getBoundingClientRect()] : [];
		return boxes.filter((r) => r.width > 0 && r.height > 0);
	}

	/** The part of the window the reader sees, in viewport coordinates: smaller than the window while a phone's keyboard is open. */
	function seen() {
		const view = window.visualViewport;
		const top = view?.offsetTop ?? 0;
		return { top: top + 8, bottom: top + (view?.height ?? innerHeight) - 8 };
	}

	/** How far the window must scroll for the popover to show whole on a side of the target: 0 when it fits there. */
	function shortOf(side: Side, first: DOMRect, end: DOMRect, height: number) {
		const { top, bottom } = seen();
		return side === "below"
			? Math.max(0, end.bottom + GAP + height - bottom)
			: Math.max(0, top - (first.top - GAP - height));
	}

	/**
	 * The popover clear of the text it is about: under its last line, starting where that line starts, or over its first line when
	 * it fits only there. The side is kept while it fits; when the note grows or the window shrinks past it (`fit`), the popover
	 * takes the side that needs less scrolling and the window scrolls just that much, as the hint's editor did. A scroll only moves
	 * it with its target (a sticky figure, a scrolling diagram), never scrolls back. `lost` runs when the target is no longer drawn.
	 */
	function placeBeside(popup: HTMLElement, live: () => NoteTarget | null, lost: () => void) {
		let side: Side | null = null;
		return (fit: boolean) => {
			const boxes = lines(live);
			const [first, end] = [boxes[0], boxes.at(-1)];
			if (!(first && end)) {
				lost();
				return;
			}
			const now: Side = fit || !side ? sideFor(side, popup, first, end) : side;
			side = now;
			put(popup, now, now === "below" ? end : first);
			if (fit) {
				scrollToFit(now, first, end, popup);
			}
		};
	}

	/** Scrolls the window just enough for the popover to show whole on its side. */
	function scrollToFit(side: Side, first: DOMRect, end: DOMRect, popup: HTMLElement) {
		const short = shortOf(side, first, end, popup.getBoundingClientRect().height);
		scrollBy(0, side === "below" ? short : -short);
	}

	/** The one side the window can scroll far enough to show the popover on, or null when both or neither can. */
	function reachable(above: number, below: number): Side | null {
		const bottom = document.documentElement.scrollHeight - innerHeight;
		const up = scrollY - above >= 0;
		const down = scrollY + below <= bottom;
		if (up === down) {
			return null;
		}
		return up ? "above" : "below";
	}

	/**
	 * The side kept while the popover fits on it, else below if it fits there, above if it fits there, else the one needing less
	 * scrolling of those the window can scroll to (at the page's top, nothing scrolls up to show it above).
	 */
	function sideFor(kept: Side | null, popup: HTMLElement, first: DOMRect, end: DOMRect): Side {
		const { height } = popup.getBoundingClientRect();
		const short = (s: Side) => shortOf(s, first, end, height);
		if (kept && short(kept) === 0) {
			return kept;
		}
		if (short("below") === 0 || short("above") === 0) {
			return short("below") === 0 ? "below" : "above";
		}
		const reach = reachable(short("above"), short("below"));
		if (reach) {
			return reach;
		}
		return short("above") < short("below") ? "above" : "below";
	}

	/** Writes the popover's place by `line`, the target's line on that side, in the column, with its tip under the line's start. */
	function put(popup: HTMLElement, side: Side, line: DOMRect) {
		const { left, right } = columnFor(popup);
		const { width, height } = popup.getBoundingClientRect();
		const x = Math.max(left, Math.min(line.left, right - width));
		popup.dataset.side = side;
		popup.style.setProperty("--tip", `${Math.max(12, Math.min(line.left + 12 - x, width - 20))}px`);
		popup.style.left = `${x + scrollX}px`;
		popup.style.top = `${(side === "below" ? line.bottom + GAP : line.top - GAP - height) + scrollY}px`;
	}

	return { hint: position, beside: placeBeside };
};
