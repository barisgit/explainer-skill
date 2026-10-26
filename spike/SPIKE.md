# Spike: TanStack Charts as the kit's one chart path

Throwaway evaluation of `@tanstack/charts` 1.1.0 (MIT) as the replacement for both `Chart` (ECharts) and `Plot` (`kit/plot.ts`). Not for merging.

## What is here

- `skills/explainer/kit/components/tchart.tsx`: `TChart`, a thin island over `@tanstack/charts/preact`'s `Chart`. Its required `id` is the chart's `idPrefix`, because islands hydrate one by one and `useId` would differ between prerender and hydration.
- `kit/components/parts/explore-tchart.tsx` and `explore.tsx`: Explore takes a `tchart` frame key (client frames only: a definition holds functions, so it cannot be precomputed to JSON).
- `kit/parts/theme/03-graphics.css`: `.tchart` maps `--ts-chart-1..6` and the tooltip variables to the kit tokens.
- `spike/tanstack/`: four ported figures (`page.mdx`, packed `index.html`): the Fourier coefficient stems (a Plot figure), the Fourier hero in Explore (an ECharts figure), the electricity world mix (stacked areas, Amount/Share, legend toggle, group tooltip with total) and the change-by-source diverging bars (ECharts).
- `spike/size.ts`: gzipped sizes. `spike/nojs.ts`: element shots with scripts disabled. `spike/probe.ts`: dumps a chart scene.

## Findings

| | TanStack (spike) | Today |
|---|---|---|
| Without script | Full SVG in the HTML: axes, marks, labels | ECharts and Plot figures are blank |
| Theme | `currentColor` and CSS variables: light, dark and page overrides follow with no script | `charts.js` reads the tokens in the browser and builds an ECharts theme |
| Keyboard | Focusable SVG, arrows/Home/End move a focus ring and the tooltip | Neither reaches data points from the keyboard (Plot's legend buttons are focusable) |
| Chart code, gzipped | 38 KB (stems) to 47 KB (all four figures); 76 KB with legend, zoom and brush | ECharts + charts.js 301 KB; plot.js 4.5 KB |
| Source lines (non-blank, no comments) | stems 41, hero 61, mix 67 + 12 legend, change 30 | 21, 60, 56, 65 |

Defaults the kit would own: tick text is 10 to 11 px (the kit uses 13 px); the default tooltip shows raw field names and mark ids; the library's interactive legend reserves 44 px rows inside the chart and squeezed the plot at 390 px, so the spike uses a kit HTML legend; text marks become keyboard stops; a line with repeated x needs an `id` field; zoom (`zoomX`) is controlled state the page owns, not a drop-in `dataZoom`.

Shots are in the worktree's `.evidence/shots/` (ignored): `compare/` (current left, TanStack right, light and dark, desktop and 390 px), `tanstack-interact/`, `nojs/`.
