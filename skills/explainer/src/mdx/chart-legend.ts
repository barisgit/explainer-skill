/** Certifies constant legend heights from actual SSR boxes, at a copy's fixed height, without estimating rows. */
interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
interface Model {
	get(key: string): unknown;
	getModel(key: string): Model;
}
interface Legend extends Model {
	getData(): Model[];
}
interface LegendChart {
	getModel(): { queryComponents(query: { mainType: "legend" }): Legend[] };
	getWidth(): number;
	getViewOfComponentModel(model: Legend): {
		group: { getBoundingRect(): Rect };
		getContentGroup(): { children(): { getBoundingRect(): Rect }[] };
	};
}

/** Fixed text boxes only: rich/relative text and callbacks do not have a width-independent geometry certificate. */
function fixedText(style: Model): boolean {
	return (
		!style.get("rich") &&
		["width", "height"].every((key) => {
			const value = style.get(key);
			return value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
		})
	);
}

/** Uniform vertical boxes make plain horizontal wrapping monotone in height, even when the row partitions change. */
function uniformBoxes(boxes: Rect[], gap: unknown): boolean {
	const first = boxes[0];
	if (!first || typeof gap !== "number" || !Number.isFinite(gap) || gap < 0) {
		return false;
	}
	const extent = boxes.reduce((sum, box) => sum + Math.abs(box.y) + box.height + gap, 0);
	return (
		Number.isFinite(extent) &&
		first.height + gap > Number.EPSILON * extent * 8 &&
		boxes.every(
			(box) =>
				Object.values(box).every(Number.isFinite) &&
				box.height === first.height &&
				box.y === first.y &&
				box.x <= 0 &&
				box.x + box.width >= 0,
		)
	);
}

/** Nonnegative background padding keeps its union with the content box monotone too. */
function fixedBackground(legend: Model): boolean {
	const padding = legend.get("padding");
	return [legend.get("borderWidth") ?? 0, ...(Array.isArray(padding) ? padding : [padding])].every(
		(value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0,
	);
}

/** Only constant pixel terms; relative terms can wobble between adjacent floats. */
function pixels(value: unknown): number {
	if (value == null || value === "auto") {
		return 0;
	}
	if (typeof value === "number") {
		return value;
	}
	return typeof value === "string" && !value.includes("%") ? Number.parseFloat(value) : NaN;
}

/** Positive signed capacity stays on one monotone branch; BoundingRect would otherwise normalize a negative width. */
function monotoneWidth(legend: Model, viewport: number): boolean {
	const width = legend.get("width");
	if (width != null && width !== "auto") {
		const fixed = pixels(width);
		return Number.isFinite(fixed) && fixed > 0;
	}
	const left = legend.get("left");
	const right = legend.get("right");
	// Default center/right alignment with an unset right falls back to viewport width minus constant padding.
	const aligned = (left === "center" || left === "right") && (right == null || right === "auto");
	const leftPixels = aligned ? 0 : pixels(left);
	const rightPixels = pixels(right);
	const padding = legend.get("padding");
	const sides: unknown[] = Array.isArray(padding) ? padding : [padding];
	const margin = Number(sides[1] ?? sides[0]) + Number(sides[3] ?? sides[1] ?? sides[0]);
	// Both native subtraction orders are monotone; require positivity before native absolute-width normalization.
	return [
		viewport - rightPixels - margin - leftPixels,
		viewport - margin - leftPixels - rightPixels,
	].every((capacity) => Number.isFinite(capacity) && capacity > 0);
}

/** Deterministic text and monotone capacity, or scroll's fixed-height content/controller placeholders (ECharts 6.1). */
function fixedLegend(legend: Legend, width: number): boolean {
	const scroll = legend.get("type") === "scroll";
	return (
		!legend.get("selector") &&
		fixedBackground(legend) &&
		(scroll || monotoneWidth(legend, width)) &&
		typeof legend.get("formatter") !== "function" &&
		typeof legend.get("pageFormatter") !== "function" &&
		fixedText(legend.getModel("pageTextStyle")) &&
		legend.getData().every((item) => fixedText(item.getModel("textStyle"))) &&
		(!scroll ||
			(legend.get("orient") === "horizontal" &&
				legend.getModel("pageTextStyle").get("width") == null &&
				!/[\r\n\u2028\u2029]/.test(String(legend.get("pageFormatter") ?? ""))))
	);
}

/** All legend heights, or no certificate. Positioned legends obey the same rule as automatic ones. */
export function legendHeights(instance: unknown): number[] | undefined {
	const chart = instance as LegendChart;
	const heights: number[] = [];
	for (const legend of chart.getModel().queryComponents({ mainType: "legend" })) {
		if (!legend.get("show")) {
			heights.push(0);
			continue;
		}
		if (!fixedLegend(legend, chart.getWidth())) {
			return undefined;
		}
		const view = chart.getViewOfComponentModel(legend);
		const boxes = view
			.getContentGroup()
			.children()
			.map((item) => item.getBoundingRect());
		if (boxes.length && !uniformBoxes(boxes, legend.get("itemGap"))) {
			return undefined;
		}
		const height = view.group.getBoundingRect().height;
		if (!Number.isFinite(height)) {
			return undefined;
		}
		heights.push(height);
	}
	return heights;
}

/** The adjacent positive IEEE width, used to respect inclusive media thresholds and exclusive container-query ends. */
function adjacent(width: number, direction: bigint): number {
	const data = new DataView(new ArrayBuffer(8));
	data.setFloat64(0, width);
	data.setBigUint64(0, data.getBigUint64(0) + direction);
	return data.getFloat64(0);
}

/** First representable width where a monotone native media predicate holds; this searches numbers, never chart renders. */
function firstWidth(
	low: number,
	high: number,
	matches: (width: number) => boolean,
): number | undefined {
	if (!matches(high)) {
		return undefined;
	}
	if (matches(low)) {
		return low;
	}
	while (true) {
		const mid = low + (high - low) / 2;
		if (mid === low || mid === high) {
			return high;
		}
		if (matches(mid)) {
			high = mid;
		} else {
			low = mid;
		}
	}
}

/** Width/aspect predicates anywhere ECharts can take responsive options. Height predicates are constant at the copy height. */
function predicates(option: unknown, height: number): ((width: number) => boolean)[] {
	if (!option || typeof option !== "object") {
		return [];
	}
	const value = option as { baseOption?: unknown; media?: { query?: object; option?: unknown }[] };
	return [
		...predicates(value.baseOption, height),
		...(value.media ?? []).flatMap((entry) => [
			...Object.entries(entry.query ?? {}).flatMap(([key, value]: [string, unknown]) => {
				const match = /^(?:min|max)?(width|aspectratio)$/i.exec(key);
				if ((value !== null && typeof value === "object") || typeof value === "function") {
					throw new Error("Non-scalar media predicates cannot certify a drawing.");
				}
				const limit = Number(value);
				if (!match || !Number.isFinite(limit)) {
					return [];
				}
				const dimension = (width: number) =>
					match[1]?.toLowerCase() === "width" ? width : width / height;
				// Checking both inequalities includes exact-equality states and division's rounded threshold plateaus.
				return [
					(width: number) => dimension(width) >= limit,
					(width: number) => dimension(width) > limit,
				];
			}),
			...predicates(entry.option, height),
		]),
	];
}

/** Endpoints of every fixed-media interval, including isolated boundary states; no recursive SSR render search. */
export function legendWidths(
	option: unknown,
	height: number,
	shown: readonly [number, number],
	includeEnd: boolean,
): number[] {
	const [low, end] = shown;
	const high = includeEnd ? end : adjacent(end, -1n);
	const widths = new Set([low, high]);
	for (const matches of predicates(option, height)) {
		const boundary = firstWidth(low, high, matches);
		if (boundary !== undefined) {
			widths.add(boundary);
			if (boundary > low) {
				widths.add(adjacent(boundary, -1n));
			}
		}
	}
	return [...widths];
}
