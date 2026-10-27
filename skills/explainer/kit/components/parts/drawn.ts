/*
 * Charts and plots drawn while pack renders the page: Chart and Plot put what the drawer returns inside their element, so the
 * figure is in the page before any script runs, with scripts off and in print. pack sets the drawer (src/mdx/draw.ts) in the
 * module it renders one page with; in the browser there is none, and the kit scripts draw over what pack drew.
 */

/** The figure's element, by what sizes it: its classes, its id (which a page's CSS may name) and its `height` prop. */
export interface Place {
	classes: readonly string[];
	id: string | undefined;
	height: string | undefined;
}

/** Draws a figure as markup for the inside of its element, sized for `place` as the theme and the page's CSS size it. */
export interface Drawer {
	chart(option: ChartOption, place: Place): string;
	plot(option: PlotOption, place: Place): string;
}

let drawer: Drawer | undefined;

/** Sets the drawer pack renders the page with. */
export function setDrawer(next: Drawer): void {
	drawer = next;
}

/**
 * What the figure's element holds as its component renders: what pack draws while it renders the page, or nothing in the
 * browser, where the element is left as it was, so hydration keeps what pack drew until the kit script draws over it.
 */
export function drawnInside(draw: (drawer: Drawer) => string): {
	dangerouslySetInnerHTML: { __html: string };
} {
	return { dangerouslySetInnerHTML: { __html: drawer ? draw(drawer) : "" } };
}

/** The place of a figure whose element has the classes `classes` (one string, as in class="..."), `id` and `height`. */
export const placeOf = (
	classes: string,
	id: string | undefined,
	height: string | undefined,
): Place => ({
	classes: classes.split(/\s+/).filter(Boolean),
	id,
	height,
});

/** The style attribute that gives an element the `height` prop as its block size. */
export const heightStyle = (height: string | undefined) =>
	height ? `block-size:${height}` : undefined;
