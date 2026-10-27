/* plot: small line, stem and bar plots as SVG in the page theme, no ECharts. For zoom, drill-down, heatmaps or sankey use charts.js. Needs kit:theme.css.
   Plot.make(el, option) -> { set(patch), dispose() }
     el      element with a height (.chart); Plot fills it with a legend and an SVG drawn at its pixel size and redrawn on resize,
             so text stays 13 px from phone to desktop, in place of what pack drew in it. Colours are CSS tokens: light and dark switch with no redraw.
     option  { series, categories, horizontal, stack, x, y, legend }
       series  [{ name, type, data, color, width, dash, label }]
         type "line"   data [[x, y], ...]; width in px (default 2), dash: true for dashed
         type "stem"   data [[x, y], ...]: a drop line from 0 with a dot, for spectra and samples
         type "bar"    data [v, ...], one per category
         color  any CSS colour, default var(--c1)..var(--c6) in turn; "var(--accent)" and color-mix(...) work
         name   shown in the legend, whose entries switch the series on and off; a series without a name toggles with the named one before it
         label  prints exact values on the marks: true, a format as below, one text per point or bar (["A", "", "C"]),
                or a function: stem (x, y, i) => text, bar (v, i) => text
       categories  ["A", "B"] makes a bar plot (bars cannot mix with line or stem); horizontal: true runs them down the page,
                   stack: true piles the series (non-negative values) into one bar per category, else they sit side by side. Keep names short.
       x, y   { min, max, step, name, format }  screen axes: in a horizontal bar plot y holds the categories, x the values.
              Range and step are automatic and round; format writes the tick labels and values, in the page's lang:
              { digits: 1, unit: "kHz" }, { percent: true }, { currency: "EUR", compact: true }, or a function (v) => text.
       legend false hides the legend (by default it shows when two or more series have a name)
     set(patch)  shallow-merges the patch into the option (x and y one level deeper) and redraws at once; series is replaced whole.
     dispose()   stops redrawing on resize, for code that takes the element away
   Exact values without hovering: label on stems and bars, a readout in the page for lines; each bar (zero ones too) also has a title.
   A bar label sits past the bar's end, or inside the end when the panel has no room past it. A label on a stacked segment is left out
   when it does not fit the segment: when every exact value must stay visible, add a readout or table next to the plot.
   Values outside min and max sit on the edge. A vertical marker is a two-point dashed line series. */
(() => {
	const FONT = 13; // px, as theme.css sets it for .plot text
	const measureCtx = document.createElement("canvas").getContext("2d");
	const { render, legendMarkup, switchedOn } = window.PlotDraw({
		lang: () => document.documentElement.lang || "en",
	});

	const made = new WeakMap<HTMLElement, () => void>();

	function make(el: HTMLElement, initial: PlotOption) {
		made.get(el)?.(); // a view handler that runs again replaces the plot instead of stacking observers
		let option = initial;
		el.classList.add("plot");
		// What pack drew (a legend and copies of the plot at three widths) goes: the plot is drawn here at the element's size.
		const legend = Object.assign(document.createElement("ul"), { className: "plot-legend" });
		const area = Object.assign(document.createElement("div"), { className: "plot-area" });
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		area.append(svg);
		el.replaceChildren(legend, area);
		let legendHtml = "";
		const off = new Set<string | undefined>(); // names of the series the reader switched off in the legend
		const nameOf = (button: HTMLElement) => option.series?.[Number(button.dataset.i)]?.name;

		function draw() {
			const series = option.series ?? [];
			const html = legendMarkup(option);
			if (html !== legendHtml) {
				legend.innerHTML = legendHtml = html;
			}
			for (const button of legend.querySelectorAll("button")) {
				button.setAttribute("aria-pressed", String(!off.has(nameOf(button))));
			}
			const W = area.clientWidth;
			const H = area.clientHeight;
			if (!W || !H) {
				return; // hidden: drawn when it first gets a size
			}
			svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
			if (!measureCtx) {
				throw new Error("kit:plot.js needs a canvas to measure text");
			}
			measureCtx.font = `500 ${FONT}px ${getComputedStyle(el).fontFamily}`;
			const textWidth = (s: unknown) => measureCtx.measureText(String(s)).width;
			svg.innerHTML = render(option, W, H, textWidth, switchedOn(series, off));
		}

		legend.addEventListener("click", (event) => {
			const button = event.target instanceof Element ? event.target.closest("button") : null;
			if (button) {
				const name = nameOf(button);
				if (!off.delete(name)) {
					off.add(name);
				}
				draw();
			}
		});
		const resizer = new ResizeObserver(draw);
		resizer.observe(area);
		void document.fonts.load(`500 ${FONT}px ${getComputedStyle(el).fontFamily}`).then(draw, draw);
		const dispose = () => {
			resizer.disconnect();
			if (made.get(el) === dispose) {
				made.delete(el);
			}
		};
		made.set(el, dispose);
		draw();
		return {
			dispose,
			set(patch: PlotOption) {
				option = {
					...option,
					...patch,
					x: { ...option.x, ...patch.x },
					y: { ...option.y, ...patch.y },
				};
				draw();
			},
		};
	}

	window.Plot = { make };
})();
