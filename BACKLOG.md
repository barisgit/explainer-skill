# Backlog

Known gaps found while building and testing the skill. Each names where it lives and why it matters.

## Kit

- `kit/charts.js`: a legend that wraps to two rows on a phone overlaps the plot, because `grid.top` does not count legend rows. Pages work around it with extra top padding.
- `kit/plot.js`: no tick list with custom labels (spectra want `f0`, `2f0`), no area fill, no hover readout, and stem labels can collide. Pages fall back to ECharts for these.
- `kit/plot.js` is 16 KB, above the 15 KB aim; most of it is the header (the documentation).
- `kit/reply.js`: its UI strings are English only. `steps.js` has `data-labels`; reply.js needs its own way, perhaps one page-level attribute shared by both.
- `kit/steps.js`: expanding `data-steps` writes `data-step` onto diagram parts and never removes it, so an id dropped from `data-steps` keeps its old step after `Steps.refresh`.
- `kit/theme.css` sits at its 1400-line cap (the formatter writes one declaration per line). Look for unused rules before it grows.
- Study pages build their own quiz with answers behind `<details>`, and their own inline formula styling. Both are common enough to consider a kit pattern.

## CLI

- `pack` leaves `video[src]` and SVG presentation attributes such as `fill="url(https://...)"` unchecked, a remaining hole in the no-network contract.
- `check` cannot show a chart tooltip in its PNGs (full-page shots relayout); a viewport-only shot after `--do` would.
- Wide left-to-right Mermaid and sequence diagrams still shrink to tiny text on phones; `check` warns under 9 px but nothing fixes it.
- The `kit` listing's attribute list is hard-coded in `src/commands.ts` and can drift from the kit headers.
- Machine output: only `check` has `--json`; a shared envelope (tool, version, command, ok, diagnostics) for `pack` and `kit`, a distinct exit code for a missing Chrome, and `--version` would help scripts.
- The embedded page scripts in `src/check.ts` and `src/mermaid.ts` are template strings that neither `tsc` nor Biome sees.

## Project

- `.github/workflows/ci.yml` runs for the first time on the initial push. The Chrome sandbox setting on Ubuntu is the likeliest first failure.
