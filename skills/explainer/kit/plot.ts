/* plot: small line, stem and bar plots as SVG in the page theme, no ECharts. For zoom, drill-down, heatmaps or sankey use charts.js. Needs kit:theme.css.
   Plot.make(el, option, picker) -> { set(patch), dispose() }
     el      element with a height (.chart), which stays the element's: a bar plot made here gets no height by its bars, unlike
             the Plot component's. Plot fills it with a legend and an SVG drawn at its pixel size and redrawn on resize,
             so text stays at the label size (--size-label, 13 px) from phone to desktop, in place of what pack drew in it.
             Colours are CSS tokens: light and dark switch with no redraw.
     option  { series, categories, horizontal, stack, x, y, marks, legend }
       series  [{ name, type, data, color, width, dash, fill, label }]
         type "line"   data [[x, y], ...]; width in px (default 2); dash: true dashed, false solid, unset by its slot (below)
         type "stem"   data [[x, y], ...]: a drop line from 0 with a dot, for spectra and samples
         type "bar"    data [v, ...], one per category
         color  any CSS colour, default var(--c1)..var(--c6) in turn: muted inks, a line in each also dashed its own way.
                Put "var(--accent)" on the series the page is about; color-mix(...) works too
         fill   a bar's state, from the accent: "accent" solid, "hollow" (tint in an accent outline), "hatch" (grey lines at 45
                degrees), for the whole series or one per bar: ["accent", "hollow", "hatch"] ("" keeps the series' colour).
                On a line: the area down to 0, true in a tint of its colour or a state
         name   named lines carry their names at their ends, kept off the marks' lines and labels (a name spread off its
                end tied to it by a leader), when the names are short (about 15 characters) and stack down the plot; else names go
                in the legend, whose entries switch the series on and off, a series without a name toggling with the named one before it
         label  prints exact values on the marks: true, a format as below, one text per point or bar (["A", "", "C"]),
                or a function: line and stem (x, y, i) => text, bar (v, i) => text. A line prints its last point's after its
                name at its end ("10 kΩ: 847 ns"), wrapped, or left out past two lines. A bar plot whose every bar prints its
                value (true or a format, side by side) leaves out its value axis, unless a marker on it does not write its number
       categories  ["A", "B"] makes a bar plot (bars cannot mix with line or stem); horizontal: true runs them down the page,
                   stack: true piles the series into one bar per category, negative values down from 0, else they sit side by side. Keep names short.
                   { name: "Heat pump", note: "4,200 EUR" } adds a muted second line under a name
       marks  [{ x: 16, label: "Payback" }]: a dashed reference line at x (or y), its label on top beside it, wrapped inside the plot
              { x: [20, 30], label: "night" }: a span, a bracket on top with its label
              { x: [6, 11.5], between: ["Roof", "House"], fill: "accent", label: "charging" }: the region between two named lines
                (or a line and a number) over x, filled as a line's fill, its label inside it or beside it
              { at: [11.5, 2.8], label: "full at 11:31" }: a note beside that point
              Notes keep clear of the lines and labels, wrapping or tied by a leader; pack warns about one with no clear place
       x, y   { min, max, step, name, format, labels }  screen axes (labels: false leaves the tick labels out, true keeps them):
              in a horizontal bar plot y holds the categories, x the values.
              Range and step are automatic and round; format writes the tick labels and values, in the page's lang:
              { digits: 1, unit: "kHz" }, { percent: true }, { currency: "EUR", compact: true }, or a function (v) => text.
       legend true shows the legend, false hides it and the names at the ends; unset, it shows for two or more named series
              unless all are lines
       pick   a bar plot's picked category, by index: its bars framed in ink, and the legend is its key, the category's name over
              each named series' value there, as tall as the tallest category's key
     picker  { choose(i), strip }: a click on a bar plot's category i calls choose(i); strip, an element under the plot (a row of
             controls, one per category), is padded to line up with the categories, and its radios are described by their values.
             A mouse over a category or its strip label frames it and makes the key its, at once, until it leaves; only a click picks
     set(patch)  shallow-merges the patch into the option (x and y one level deeper); series is replaced whole. The plot moves from
             what it shows to the new option over half a second (bars grow, lines morph, a line of another length read off the
             old one; series matched by name), its texts the new option's throughout; at once under reduced motion, for print,
             and until the reader has acted on the page, so the first drawing and a restored control never move.
     dispose()   stops redrawing on resize, for code that takes the element away
   Exact values without hovering: label on stems and bars, a readout in the page for lines; each bar (zero ones too) also has a title.
   A bar label sits past the bar's end, or inside the end when the panel has no room past it or a marker's line
   would cross it there (past the line when it fits neither), and moves across off a neighbour. A label on a stacked segment is left out
   when it does not fit the segment: when every exact value must stay visible, add a readout or table next to the plot.
   A bar past min or max is cut where it meets the edge, its true value always printed there; other values sit on the edge.
   Axes carry their labels and one quiet baseline at 0, without gridlines or tick marks. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the IIFE only scopes the kit file's names away from the page; the code in it is split into small functions
(() => {
	const measureCtx = document.createElement("canvas").getContext("2d");
	// The label size (--size-label) in px, as the plot being drawn sets it on its legend, which theme.css sizes with its text.
	let size = 13;
	const { render, legendMarkup, switchedOn, markLines, bands, keyText } = window.PlotDraw({
		lang: () => document.documentElement.lang || "en",
		size: () => size,
	});
	const { between, same } = window.PlotTween();
	type Measure = (s: unknown) => number;
	/** A label's width in a CSS font. */
	function measure(font: string, s: unknown) {
		if (!measureCtx) {
			throw new Error("kit:plot.js needs a canvas to measure text");
		}
		measureCtx.font = font;
		return measureCtx.measureText(String(s)).width;
	}
	const still = matchMedia("(prefers-reduced-motion: reduce)");
	/** ms a change takes to move the plot, eased out, as charts.js's updates. */
	const TWEEN = 500;

	const made = new WeakMap<HTMLElement, () => void>();
	// Whether the reader has acted on the page: before that a change (a control keep.js restores, a view opened from the address)
	// is drawn at once, as nothing moves on arrival.
	let acted = false;
	for (const type of ["pointerdown", "keydown"]) {
		addEventListener(type, () => (acted = true), { capture: true, once: true });
	}

	/** Calls `finish` before printing and when the reader turns motion off, until `signal` aborts. */
	function whenStill(finish: () => void, signal: AbortSignal) {
		addEventListener("beforeprint", finish, { signal });
		still.addEventListener("change", () => still.matches && finish(), { signal });
	}

	/** Replaces what pack drew in `el` (a legend and copies of the plot at three widths) with the parts plot.js draws into. */
	function partsIn(el: HTMLElement) {
		el.classList.add("plot");
		const legend = Object.assign(document.createElement("ul"), { className: "plot-legend" });
		const area = Object.assign(document.createElement("div"), { className: "plot-area" });
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		area.append(svg);
		el.replaceChildren(legend, area);
		return { legend, area, svg };
	}

	/**
	 * A plot's legend: write(html) puts in its items, buttons pressed for the series switched on; pressing one switches its series
	 * (`off` holds the names switched off) and redraws.
	 */
	function legendOf(legend: HTMLElement, current: () => PlotOption, redraw: () => void) {
		let html = "";
		const off = new Set<string | undefined>();
		const nameOf = (button: HTMLElement) => current().series?.[Number(button.dataset.i)]?.name;
		legend.addEventListener("click", (event) => {
			const button = event.target instanceof Element ? event.target.closest("button") : null;
			if (button) {
				const name = nameOf(button);
				if (!off.delete(name)) {
					off.add(name);
				}
				redraw();
			}
		});
		return {
			off,
			write(next: string) {
				if (next !== html) {
					html = next;
					writeLegend(legend, next);
				}
				// With no legend, nothing could switch a series back on.
				if (!next) {
					off.clear();
				}
				for (const button of legend.querySelectorAll("button")) {
					button.setAttribute("aria-pressed", String(!off.has(nameOf(button))));
				}
			},
		};
	}

	/** Writes the legend's items, keeping its buttons, and a reader's focus on one, where the items stay the same series. */
	function writeLegend(legend: HTMLElement, html: string) {
		const next = document.createElement("ul");
		next.innerHTML = html;
		const [had, has] = [[...legend.children], [...next.children]];
		const kind = (li: Element | undefined) =>
			li?.querySelector<HTMLElement>("button")?.dataset.i ?? li?.className;
		if (had.length !== has.length || had.some((li, i) => kind(li) !== kind(has[i]))) {
			legend.replaceChildren(...has);
			return;
		}
		for (const [i, li] of had.entries()) {
			const fresh = has[i];
			const [button, written] = [li, fresh].map((item) => item?.querySelector("button"));
			(button ?? li).innerHTML = (written ?? fresh)?.innerHTML ?? "";
		}
	}

	/** Shows each step from `from` to `to`, a frame at a time, eased out; `timer.id` is the frame waiting, for cancelling. */
	function tween(
		from: PlotOption,
		to: PlotOption,
		show: (option: PlotOption) => void,
		timer: { id: number },
	) {
		const start = performance.now();
		const step = (now: number) => {
			const k = Math.min(1, (now - start) / TWEEN);
			show(k < 1 ? between(from, to, 1 - (1 - k) ** 4) : to);
			if (k < 1) {
				timer.id = requestAnimationFrame(step);
			}
		};
		timer.id = requestAnimationFrame(step);
	}

	/** A picker's strip under the categories at W x H: padded to their span, each radio described by its values. */
	function lineUp(
		strip: HTMLElement,
		option: PlotOption,
		W: number,
		H: number,
		textWidth: Measure,
	) {
		const at = bands(option, W, H, textWidth);
		if (!at || at.vertical) {
			return;
		}
		strip.style.paddingInline = `${at.start}px ${W - at.end}px`;
		const band = (at.end - at.start) / at.count;
		const labels = [...strip.querySelectorAll<HTMLElement>("[data-full]")];
		const widest = (key: "full" | "short") =>
			Math.max(...labels.map((label) => textWidth(label.dataset[key])));
		// Too narrow for the texts: each by its short form, and where even those touch, every nth, its radio kept, and the
		// picked one's always, in place of the neighbours it would touch.
		const short = widest("full") > band - 8;
		let every = 1;
		while (short && widest("short") > every * band - 8 && every < labels.length) {
			every++;
		}
		const picked = option.pick ?? -1;
		strip.classList.toggle("short", short);
		for (const [i, label] of labels.entries()) {
			const near = i !== picked && Math.abs(i - picked) < every;
			label.classList.toggle("thin", i !== picked && (i % every !== 0 || near));
		}
		for (const [i, input] of strip.querySelectorAll("input").entries()) {
			input.setAttribute("aria-description", keyText(option, i));
		}
	}

	/**
	 * Makes a click on a category of the plot's area pick it, and a mouse over one or its strip label preview it, until `signal`
	 * aborts.
	 */
	function pickable(
		area: HTMLElement,
		picker: PlotPicker,
		option: () => PlotOption,
		textWidth: Measure,
		{ preview, signal }: { preview: (i: number | undefined) => void; signal: AbortSignal },
	) {
		previewable(area, picker.strip, option, textWidth, { preview, signal });
		area.classList.add("pick");
		area.addEventListener(
			"click",
			(event) => {
				const i = categoryAt(event, area, option(), textWidth);
				if (i !== undefined) {
					picker.choose(i);
				}
			},
			{ signal },
		);
	}

	/**
	 * Makes a mouse or pen over a category of the plot's area, or over its label in the picker's strip, preview it
	 * (`preview(i)`), and leaving them, the window or the tab end the preview (`preview(undefined)`), until `signal` aborts. A
	 * touch has no hover: a tap picks, as a click does.
	 */
	function previewable(
		area: HTMLElement,
		strip: HTMLElement | null | undefined,
		option: () => PlotOption,
		textWidth: Measure,
		{ preview, signal }: { preview: (i: number | undefined) => void; signal: AbortSignal },
	) {
		const end = () => preview(undefined);
		const labelAt = (event: PointerEvent) => {
			const label = event.target instanceof Element ? event.target.closest("label") : null;
			const i = label && strip ? [...strip.querySelectorAll("label")].indexOf(label) : -1;
			return i >= 0 ? i : undefined;
		};
		const watch = (target: HTMLElement, at: (event: PointerEvent) => number | undefined) => {
			target.addEventListener(
				"pointermove",
				(event) => {
					if (event.pointerType !== "touch") {
						preview(at(event));
					}
				},
				{ signal },
			);
			target.addEventListener("pointerleave", end, { signal });
		};
		watch(area, (event) => categoryAt(event, area, option(), textWidth));
		if (strip) {
			watch(strip, labelAt);
		}
		addEventListener("blur", end, { signal });
		document.addEventListener("visibilitychange", end, { signal });
	}

	/**
	 * A plot's preview of the category a mouse or pen points at: look(o) is o framed and keyed there (o itself with none), to(i)
	 * previews category i (undefined the pick again) and redraws, end() drops it without redrawing.
	 */
	function previewOf(redraw: () => void) {
		let hovered: number | undefined;
		return {
			look: (o: PlotOption) => (hovered === undefined ? o : { ...o, pick: hovered }),
			end: () => {
				hovered = undefined;
			},
			to(i: number | undefined) {
				if (i !== hovered) {
					hovered = i;
					redraw();
				}
			},
		};
	}

	/**
	 * The room a bar plot's key takes in its legend: the height of its tallest key over the categories at the legend's width, so
	 * neither a pick nor a preview moves the plot under it or runs into it; "" for a plot with no key. Measured once per option
	 * and width, and again while fonts load.
	 */
	function keyRoomOf(legend: HTMLElement, textWidth: Measure) {
		let seen: { option: PlotOption; width: number; room: string } | undefined;
		function tallest(option: PlotOption, width: number) {
			if (option.pick === undefined || !option.categories) {
				return "";
			}
			const ruler = legend.cloneNode(false) as HTMLElement;
			ruler.removeAttribute("style");
			Object.assign(ruler.style, {
				position: "absolute",
				visibility: "hidden",
				inlineSize: `${width}px`,
			});
			legend.after(ruler);
			const heights = option.categories.map((_, pick) => {
				ruler.innerHTML = legendMarkup({ ...option, pick }, textWidth, 0);
				return ruler.getBoundingClientRect().height;
			});
			ruler.remove();
			return `${Math.max(...heights)}px`;
		}
		return (option: PlotOption) => {
			const width = legend.getBoundingClientRect().width;
			if (seen?.option === option && seen.width === width) {
				return seen.room;
			}
			const room = tallest(option, width);
			seen = document.fonts.status === "loaded" ? { option, width, room } : undefined;
			return room;
		};
	}

	/** The category under a pointer on a plot's area, or undefined off them. */
	function categoryAt(
		event: MouseEvent,
		area: HTMLElement,
		option: PlotOption,
		textWidth: Measure,
	) {
		const box = area.getBoundingClientRect();
		const at = bands(option, area.clientWidth, area.clientHeight, textWidth);
		if (!at) {
			return undefined;
		}
		const along = at.vertical ? event.clientY - box.top : event.clientX - box.left;
		const i = Math.floor(((along - at.start) / (at.end - at.start)) * at.count);
		return i >= 0 && i < at.count ? i : undefined;
	}

	/** The option once `patch` is set on it: shallow-merged, x and y one level deeper. */
	const patched = (option: PlotOption, patch: PlotOption): PlotOption => ({
		...option,
		...patch,
		x: { ...option.x, ...patch.x },
		y: { ...option.y, ...patch.y },
	});

	function make(el: HTMLElement, initial: PlotOption, picker?: PlotPicker) {
		made.get(el)?.(); // a view handler that runs again replaces the plot instead of stacking observers
		let option = initial;
		// What is drawn: the option, or a step of the tween towards it.
		let shown = initial;
		let drawn = false;
		const timer = { id: 0 };
		// The plot is drawn at the element's size.
		const { legend, area, svg } = partsIn(el);
		const preview = previewOf(() => draw());
		const listening = new AbortController();
		const switches = legendOf(
			legend,
			() => option,
			() => draw(),
		);

		/** The plot's text: 500 at the label size, in the element's font. */
		const font = () =>
			`500 ${parseFloat(getComputedStyle(legend).fontSize)}px ${getComputedStyle(el).fontFamily}`;
		const textWidth: Measure = (s) => measure(font(), s);
		const room = keyRoomOf(legend, textWidth);

		/** The plot area's height with no legend buttons: the legend's top padding is all that stays above it. */
		const bareHeight = () =>
			area.clientHeight + legend.offsetHeight - parseFloat(getComputedStyle(legend).paddingTop);

		function draw() {
			size = parseFloat(getComputedStyle(legend).fontSize);
			// The legend (or key) is for where the plot is going.
			switches.write(legendMarkup(preview.look(option), textWidth, bareHeight()));
			legend.style.minBlockSize = room(option);
			const W = area.clientWidth;
			if (!W || !area.clientHeight) {
				return; // hidden: drawn when it first gets a size
			}
			// The lines the markers' labels take at this width: a bar plot Plot sizes by its bars grows by them (its height is
			// calc(... var(--plot-mark-lines) ...)), so its rows keep their size; any other plot takes them from its own height.
			el.style.setProperty(
				"--plot-mark-lines",
				String(markLines(shown, W, area.clientHeight, textWidth)),
			);
			const H = area.clientHeight;
			svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
			svg.innerHTML = render(
				preview.look(shown),
				W,
				H,
				textWidth,
				switchedOn(shown.series ?? [], switches.off),
				option,
			);
			drawn = true;
			if (picker?.strip) {
				lineUp(picker.strip, option, W, H, textWidth);
			}
		}

		picker &&
			pickable(area, picker, () => option, textWidth, {
				preview: preview.to,
				signal: listening.signal,
			});

		const show = (step: PlotOption) => {
			shown = step;
			draw();
		};
		/** Ends a move and a preview where the pick is: for print, and when the reader turns motion off. */
		function finish() {
			cancelAnimationFrame(timer.id);
			preview.end();
			show(option);
		}

		/**
		 * Moves what is drawn from what it was to the option, a step a frame; at once under reduced motion, before a drawing and
		 * before the reader has acted on the page.
		 */
		function move() {
			cancelAnimationFrame(timer.id);
			if (still.matches || !drawn || !acted) {
				show(option);
			} else {
				tween(shown, option, show, timer);
			}
		}

		const resizer = new ResizeObserver(draw);
		resizer.observe(area);
		whenStill(finish, listening.signal);
		void document.fonts.load(font()).then(draw, draw);
		const dispose = () => {
			resizer.disconnect();
			listening.abort();
			cancelAnimationFrame(timer.id);
			if (made.get(el) === dispose) {
				made.delete(el);
			}
		};
		made.set(el, dispose);
		draw();
		return {
			dispose,
			set(patch: PlotOption) {
				const next = patched(option, patch);
				if (!same(next, option)) {
					// A pick (a click, a key, a restored control) shows where it goes, not the column last pointed at.
					next.pick !== option.pick && preview.end();
					option = next;
					move();
				}
			},
		};
	}

	window.Plot = { make };
})();
