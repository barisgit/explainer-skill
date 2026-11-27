# Explainer

An agent skill that answers with a page: the finding up front, a figure you can move, and a question you answer on it. One HTML file that opens offline.

<a href="https://barisgit.github.io/explainer-skill/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/hero-dark.webp">
  <img alt="A clip over three pages, in turn: Next steps a lookup for key 71 down a B-tree from the root to its leaf; a heatmap shows German negative electricity prices clustering at spring and summer middays, and a day picker switches from a January weekday that stays above zero to a May Sunday whose price falls to minus 250; the theme picker flips a treemap of npm packages between light and dark, and a click on the largest package opens why it is installed" src="examples/media/hero-light.webp">
</picture>
</a>

```sh
npx skills add barisgit/explainer-skill --global --agent claude-code --agent codex -y
```

Then ask your agent to show you: “explain this pull request as a page”. [More ways to install](#install).

Eleven questions, each answered with a page. The [gallery](https://barisgit.github.io/explainer-skill/) shows them with their first figures; sources are in [`examples/`](examples/), each with the prompt it answers in `prompt.md`.

<table>
<tr>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/btree-index/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/btree-index-card-dark.webp">
  <img alt="First screen of the page: How a B-tree index finds a row: a lookup reads one page per level, so a million rows take three reads, over a tree whose path to key 71 lights up step by step" src="examples/media/btree-index-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/btree-index/"><b>How it works</b></a>: how a B-tree index finds a row
</td>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/negative-prices/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/negative-prices-card-dark.webp">
  <img alt="First screen of the page: Why German electricity prices go negative: 576 hours in 2025, up from 211 in 2019, over yearly bars with 2025 in the accent" src="examples/media/negative-prices-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/negative-prices/"><b>Data report</b></a>: negative electricity prices in Germany, from Energy-Charts data
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/node-modules/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/node-modules-card-dark.webp">
  <img alt="First screen of the page: What npm install put on disk: 406 packages for 3 listed, over a treemap of their bytes with the 15 heaviest in red" src="examples/media/node-modules-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/node-modules/"><b>Drill-down over records</b></a>: what one <code>npm install</code> puts on disk
</td>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/litestream-tour/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/litestream-tour-card-dark.webp">
  <img alt="First screen of the page: How Litestream works: a map of your app and SQLite, the Litestream process and object storage, its seven numbered parts coloured by role" src="examples/media/litestream-tour-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/litestream-tour/"><b>System tour</b></a>: how Litestream works, part by part
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/saas-database/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/saas-database-card-dark.webp">
  <img alt="First screen of the page: The database for a multi-tenant SaaS: needs as toggles over Postgres, MySQL and two SQLite options, each cell a Yes, Partial or No mark with its reason" src="examples/media/saas-database-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/saas-database/"><b>Team decision</b></a>: the database for a multi-tenant SaaS
</td>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/battery/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/battery-card-dark.webp">
  <img alt="First screen of the page: Home battery payback by size: the first 5 kWh pays back in 10 years and the second in 62, over three bars on one scale against the cells' 16-year life" src="examples/media/battery-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/battery/"><b>Purchase decision</b></a>: home battery payback by size
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/i2c-pull-ups/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/i2c-pull-ups-card-dark.webp">
  <img alt="First screen of the page: I²C pull-up resistors at 400 kHz: the 10 kΩ pull-ups take 847 ns to raise the line, over the rise curves against the 300 ns limit" src="examples/media/i2c-pull-ups-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/i2c-pull-ups/"><b>Engineering page</b></a>: I²C pull-ups, with the schematic
</td>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/fourier-series/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/fourier-series-card-dark.webp">
  <img alt="First screen of the page: The Gibbs overshoot of a square wave: a thousand sines still overshoot the corner by 9%, over the sum zoomed on the jump" src="examples/media/fourier-series-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/fourier-series/"><b>Study page</b></a>: the Gibbs overshoot
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/echarts-compressed/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/echarts-compressed-card-dark.webp">
  <img alt="First screen of the page: Shipping ECharts compressed: it takes 513 KB off every chart page, over two bars for the plain and the compressed size" src="examples/media/echarts-compressed-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/echarts-compressed/"><b>Code review</b></a>: the change that ships ECharts compressed
</td>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/electricity-mix/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/electricity-mix-card-dark.webp">
  <img alt="First screen of the page: Change in world electricity generation by source: wind and solar added 669 TWh in 2024, over yearly columns of added generation" src="examples/media/electricity-mix-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/electricity-mix/"><b>Data set by place</b></a>: world electricity, 223 places from Our World in Data
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://barisgit.github.io/explainer-skill/dijkstra/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/dijkstra-card-dark.webp">
  <img alt="First screen of the page: Dijkstra's algorithm with a negative edge: it answers 2 where the shortest path is 1, over the three-node graph" src="examples/media/dijkstra-card-light.webp">
</picture>
</a>
<br><a href="https://barisgit.github.io/explainer-skill/dijkstra/"><b>Algorithm</b></a>: Dijkstra with a negative edge
</td>
<td width="50%"></td>
</tr>
</table>

## What the reader gets

**A control where it answers a question.** A slider, switch or toggles over a figure, which moves from the state it is in.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/fourier-series-terms-dark.webp">
  <img alt="Fourier series page: dragging the terms slider from 1 to 200 changes the sum while its peak settles at the marked limit" src="examples/media/fourier-series-terms-light.webp">
</picture>

**Marks that are the control.** A choice can be the plot's own columns: pick one and the key reads its values.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/i2c-pull-ups-values-dark.webp">
  <img alt="I²C page: picking 10 kΩ, 680 Ω and 2.2 kΩ among the pull-up columns shows each rise time against the 300 ns limit" src="examples/media/i2c-pull-ups-values-light.webp">
</picture>

**Text, drawing and code that point at each other.** A numbered part lights up in the prose, the diagram and the diff together.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/echarts-compressed-linked-dark.webp">
  <img alt="ECharts page: hovering the numbers in the prose lights the same stage in the diagram and the line that implements it in the diff" src="examples/media/echarts-compressed-linked-light.webp">
</picture>

Also on a page: drill-down views with breadcrumbs, one collection of records as a tree, sortable table or board, step-through figures, questions checked on the spot or sent back as one Markdown reply with the reader's notes, and answers that survive a reload. Light and dark, desktop and phone, and print.

## How it works

The agent reads [`SKILL.md`](skills/explainer/SKILL.md) and drives a small CLI, run as `bun <skill directory>/cli.ts`:

1. **Write** `page.mdx`: Markdown prose, the kit's components and the `.ts` or `.json` data it imports. `kit` lists what is available and `kit <name>` documents one; [`guide.md`](skills/explainer/guide.md) records what made earlier pages better or worse for their readers.
2. **Pack**: `pack page.mdx -o out.html` renders the page to static HTML, draws charts, diagrams, circuits, formulas and code colours into it, and inlines the fonts, local images and only the kit scripts the page uses, so the result is one offline file.
3. **Check**: `check out.html` opens it in headless Chrome in light and dark at 1440 and 390 px wide, scrolls it and tries its kit controls from fresh states, reports errors, network use, dead links, clipping and overflow. Add `--shots` for screenshots, or `--do shot:<css>` for one element. `--do` runs the clicks, drags, hovers, keys and field values you name instead, and `--do reply` prints the reply the page would send.

A diagram whose parts light up from the text, for illustration:

````mdx
```mermaid
flowchart TD
  req["Request"] --> cache["Cache"] --> db["Database"]
```

1. <span data-ref="req">A request</span> arrives.
2. <span data-ref="cache">The cache</span> misses.
3. <span data-ref="db">The database</span> answers.
````

## What a page can use

| Write | Get |
|---|---|
| `Plot` | Line, stem and bar plots as SVG with no chart library: names and values on the marks, one accent with hollow and hatch states, labelled reference markers, filled and annotated areas |
| `Chart` | ECharts in the page theme: treemap, sankey, heatmap, zoom, click-to-drill; about 0.4 MB compressed, only on pages that use it |
| `Explore`, `Controls` | A slider, choice or toggle over a plot, chart, readout or the page's own parts; `axis: true` makes a choice the plot's columns; one set of controls can drive figures in several sections |
| `Stepper` | Back, Next, a count and arrow keys over HTML, hand-built SVG or Mermaid parts; scrubber from five steps by default; opt-in Play |
| `View` | Drill-down views inside the one file, with Back, breadcrumbs, previous and next, and a contents rail |
| `Records` | One collection as a grouped tree, sortable table or board, with search, facets, subtotals and an answer per row |
| `Question` | Choices, the rows of a comparison table, a self-check or a written answer, with a recommendation and a note; answers join the reply |
| `Table` | A fixed comparison computed from data; a Markdown table gets the same look |
| ```` ```mermaid ```` | Flowchart, state, sequence, class, ER and xychart drawn at pack time, with number tags the text can point at |
| ```` ```schematic ```` | A circuit from a netlist: the wiring stated is the wiring drawn |
| ```` ```ts ````, ```` ```diff-ts ```` … | Code coloured at pack time, with marks that link to the prose |
| `$…$` | TeX drawn as MathML, no script |
| `data-ref` | Prose, table rows, diagram parts and marked code that share a name light up together; `.beside` keeps a figure in view while its text scrolls |
| Frontmatter | `contents: true` for a contents rail, `display: condensed` for poster headings, `reply: true` for notes, `lang` and `labels` for a page in another language |

Pages follow the system's light or dark setting. A `.tsx` component whose first line is `"use client"` covers behaviour no component does. The skill ships two examples: a decision page, [`skills/explainer/example/`](skills/explainer/example/page.mdx), and a system tour, [`skills/explainer/example/tour/`](skills/explainer/example/tour/page.mdx).

## Install

Both installers copy `skills/explainer/` as it is.

**npx skills** ([vercel-labs/skills](https://github.com/vercel-labs/skills))

```sh
npx skills add barisgit/explainer-skill --global --agent claude-code --agent codex -y
```

Several agents share one copy in `~/.agents/skills/explainer` and the others get symlinks; add `--copy` to give each agent its own copy. Without `--global` the skill goes into the current project. A local checkout works too: pass its path instead of `barisgit/explainer-skill`.

<details>
<summary>Install with Caplet (verified with 0.1.0)</summary>

```sh
caplet add github:barisgit/explainer-skill --pin v0.21.0 --scope user
```

Caplet needs a ref for GitHub sources. `main` follows the latest commit on each `caplet update`; pin a tag such as `v0.15.0` instead to hold a version.

Caplet copies the skill into `~/.agents/skills/explainer`, gives it to Claude Code as a plugin, and records the source in `~/.agents/capabilities.yml`. For one project, run `caplet init` in it, then `caplet add <source> --scope project`. A local checkout works too: `caplet add <path> --scope user`.

</details>

Use one installer per machine: both write `~/.agents/skills/explainer`, and Caplet does not warn when another source already emits a skill of the same name. `bun ~/.agents/skills/explainer/cli.ts kit` checks an installed copy.

**Requirements:** [Bun](https://bun.sh) (verified with 1.4.3), and Google Chrome or Chromium for `check` (`CHROME=/path/to/chrome` if it is not found; a build downloaded by agent-browser or Playwright also works). Nothing else is installed: the skill runs as copied.

<details>
<summary>Update and uninstall</summary>

```sh
npx skills update explainer --global                                     # GitHub source
npx skills add <path> --global --agent claude-code --agent codex -y      # local checkout: add again
caplet update explainer --scope user                                    # re-reads the source and applies

npx skills remove explainer --global -y
caplet remove explainer --scope user && caplet apply --scope user
```

`npx skills update` cannot check a local path, and plain `caplet apply` reuses the snapshot of a local source, so use the commands above after changing a checkout.

</details>

## Development

```sh
bun install               # dev tools and the git hook
bun run ci                # typecheck, lint (Biome), tests; what GitHub Actions runs
bun run media             # regenerates the README media from examples/ (Chrome, ffmpeg with libwebp_anim)
bun run verify:install    # before a release: installs with both installers into a temp HOME (network, Chrome)
```

`bun run media` needs all eleven packed `examples/<name>/index.html` pages, Chrome or Chromium (`CHROME=/path` overrides discovery), and ffmpeg on PATH with both `libwebp` and `libwebp_anim` encoders (`ffmpeg -encoders | grep webp`). Keep the machine awake while recording. `--keep` retains the captured frames for inspection; example names limit the run, such as `bun run media --keep hero`.

Layout, decisions and limits are in [AGENTS.md](AGENTS.md). The examples are published from `examples/` by `.github/workflows/pages.yml`.

## Credits

- [visual-explainer](https://github.com/nicobailon/visual-explainer) by Nico Bailon (MIT): the look and the reply flow.
- [Apache ECharts](https://echarts.apache.org) (Apache-2.0), bundled in the kit.
- [pele](https://github.com/kepano/pele) by kepano (MIT): the Mermaid renderer `pack` uses, not shipped in pages.
- [Preact](https://preactjs.com) and preact-render-to-string (MIT): the components and their hydration; [MDX](https://mdxjs.com) (MIT) with its unified, remark and micromark packages (MIT, one ISC), used by `pack`, not shipped in pages.
- [Temml](https://temml.org) by Ron Kok (MIT) with remark-math, micromark-extension-math and mdast-util-math (MIT): TeX to MathML in `pack`; `temml.woff2` is from the KaTeX fonts (MIT, Khan Academy).
- [TanStack Table](https://tanstack.com/table) by Tanner Linsley (MIT), with TanStack Store (MIT): the sorting, filtering, grouping and facets of `Records`.
- [refractor](https://github.com/wooorm/refractor) by Titus Wormer with [Prism](https://prismjs.com)'s grammars by Lea Verou and others (MIT), and the hast packages it uses (MIT): code fence colours in `pack`, not shipped in pages.
- [Geist and Geist Mono](https://vercel.com/font) by Vercel and [Barlow Condensed](https://github.com/jpt/barlow) by The Barlow Project Authors (SIL OFL 1.1).

Licence texts are in `skills/explainer/kit/licenses/`. The examples cite their own sources; the electricity data is from [Our World in Data](https://github.com/owid/energy-data) and [Energy-Charts](https://energy-charts.info) (Fraunhofer ISE, CC BY 4.0).

## Licence

MIT, see [LICENSE](LICENSE). A copy sits in `skills/explainer/` so installed copies carry it.
