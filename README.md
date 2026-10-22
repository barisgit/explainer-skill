# Explainer

An agent skill that turns "show me" into one interactive HTML page: charts to explore, diagrams to step through, drill-down views, and questions the reader answers on the page. The page is a single file that works offline from `file://`, in light and dark, on desktop and phone.

<a href="https://barisgit.github.io/explainer-skill/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/hero-dark.webp">
  <img alt="First screens of four example pages: a Fourier series study page, a Dijkstra step-through, a world electricity explorer and a password hashing decision page" src="examples/media/hero-light.webp">
</picture>
</a>

**Live examples**, each written by an agent following the skill: [Fourier series](https://barisgit.github.io/explainer-skill/fourier-series/) (study page), [Dijkstra's algorithm](https://barisgit.github.io/explainer-skill/dijkstra/) (step-through), [World electricity mix](https://barisgit.github.io/explainer-skill/electricity-mix/) (data explorer), [Choosing a password hash](https://barisgit.github.io/explainer-skill/password-hashing/) (decision page). Sources are in [`examples/`](examples/).

## Install

Both installers copy `skills/explainer/` as it is.

**npx skills** ([vercel-labs/skills](https://github.com/vercel-labs/skills))

```sh
npx skills add barisgit/explainer-skill --global --agent claude-code --agent codex -y
```

Several agents share one copy in `~/.agents/skills/explainer` and the others get symlinks; add `--copy` to give each agent its own copy. Without `--global` the skill goes into the current project. A local checkout works too: pass its path instead of `barisgit/explainer-skill`.

**Caplet** (verified with `caplet` v0.2.0)

```sh
caplet add github:barisgit/explainer-skill --pin main --scope user
```

Caplet needs a ref for GitHub sources. `main` follows the latest commit on each `caplet update`; pin a tag such as `v0.1.0` instead to hold a version.

Caplet copies the skill into `~/.agents/skills/explainer` and `~/.claude/skills/explainer` and records the source in `~/.agents/capabilities.yml`. For one project, run `caplet init` in it, then `caplet add <source> --scope project`. A local checkout works too: `caplet add <path> --scope user`.

Use one installer per machine: both write `~/.agents/skills/explainer`, and Caplet does not warn when another source already emits a skill of the same name. `bun ~/.claude/skills/explainer/cli.ts kit` checks an installed copy.

**Requirements:** [Bun](https://bun.sh) (verified with 1.4.3), and Google Chrome or Chromium for `check` and for rendering Mermaid during `pack` (`CHROME=/path/to/chrome` if it is not found; a build downloaded by agent-browser or Playwright also works). Nothing else is installed: the skill runs as copied.

<details>
<summary>Update and uninstall</summary>

```sh
npx skills update explainer --global                                     # GitHub source
npx skills add <path> --global --agent claude-code --agent codex -y      # local checkout: add again
caplet update explainer --scope user                                    # re-reads the source and applies

npx skills remove explainer --global -y
caplet remove explainer --scope user && caplet apply --scope user
```

`npx skills update` cannot check a local path, and plain `caplet apply` reuses the snapshot of a local source, so use the commands above after changing a checkout. Caplet leaves empty `kit`, `src` and `vendor` folders under `skills/explainer/` after removal.

</details>

## How it works

The agent reads [`SKILL.md`](skills/explainer/SKILL.md) and drives a small CLI, run as `bun <skill directory>/cli.ts`:

1. **Write** `page.html`: plain HTML that references kit files with a `kit:` prefix and adds behaviour through attributes. `kit` lists what is available and `kit <file>` documents one file.
2. **Pack**: `pack page.html -o out.html` inlines the kit, fonts and local assets and renders the Mermaid diagrams in light and dark, so the result is one offline file.
3. **Check**: `check out.html` opens it in headless Chrome in light and dark at 1440 and 390 px wide, scrolls it end to end, reports errors, network use and clipped or overflowing content, and saves screenshots for the agent to look at. `--do` clicks and presses keys first, so the screenshots can show a later state.

A diagram whose parts light up from the text, for illustration:

```html
<link rel="stylesheet" href="kit:theme.css">

<figure class="fig">
  <pre class="mermaid">flowchart TD; req --> cache --> db</pre>
</figure>
<ol>
  <li><span data-ref="req">A request</span> arrives.</li>
  <li><span data-ref="cache">The cache</span> misses.</li>
  <li><span data-ref="db">The database</span> answers.</li>
</ol>

<script src="kit:link.js"></script>
```

## What a page can use

**Charts that redraw as the reader moves a control.** ECharts in the page theme, with zoom, legend toggles and click-to-drill, or the light `plot.js` for a few small plots.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/fourier-series-terms-dark.webp">
  <img alt="Fourier series page: dragging the terms slider sharpens the partial sum of a square wave" src="examples/media/fourier-series-terms-light.webp">
</picture>

**Step-through figures.** Back, Play, Next, a scrubber and arrow keys from a few attributes; Mermaid diagrams, SVG parts and captions step together.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/dijkstra-steps-dark.webp">
  <img alt="Dijkstra page: stepping the algorithm on a street grid updates the graph, the queue and the distance table" src="examples/media/dijkstra-steps-light.webp">
</picture>

**Drill-down views.** A hash router inside the one file: a bar, row or link opens its own view, and Back returns with the scroll position kept.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/electricity-mix-coal-ranking-dark.webp">
  <img alt="Electricity page: switching the coal ranking to TWh, then opening the United States view and going back" src="examples/media/electricity-mix-coal-ranking-light.webp">
</picture>

**Questions the reader answers.** Form controls marked `data-reply` become one Markdown reply the reader sends back to the agent, together with notes on selected text or diagram parts. Inputs and notes survive a reload, with a Clear button.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/media/password-hashing-presets-dark.webp">
  <img alt="Password hashing page: deployment presets change the recommended OWASP setting, down to nothing fits" src="examples/media/password-hashing-presets-light.webp">
</picture>

Also in the kit: Mermaid diagrams written as `<pre class="mermaid">` and pre-rendered at pack time, linked highlighting between prose, table rows and diagram parts, and a stylesheet that follows the system's light or dark setting.

[`skills/explainer/example.html`](skills/explainer/example.html) is one short page that uses each feature where it helps its subject.

## Development

```sh
bun install               # dev tools and the git hook
bun run ci                # typecheck, lint (Biome), tests; what GitHub Actions runs
bun run media             # regenerates the README and gallery media from examples/ (Chrome, ffmpeg)
bun run verify:install    # before a release: installs with both installers into a temp HOME (network, Chrome)
```

Layout, decisions and limits are in [AGENTS.md](AGENTS.md). The examples are published from `examples/` by `.github/workflows/pages.yml`.

## Credits

- [visual-explainer](https://github.com/nicobailon/visual-explainer) by Nico Bailon (MIT): the look and the reply flow.
- [Apache ECharts](https://echarts.apache.org) (Apache-2.0) and [Mermaid](https://mermaid.js.org) (MIT), bundled in the kit.
- [Geist and Geist Mono](https://vercel.com/font) by Vercel (SIL OFL 1.1).

Licence texts are in `skills/explainer/kit/licenses/`. The examples cite their own sources; the electricity data is from [Our World in Data](https://github.com/owid/energy-data).

## Licence

MIT, see [LICENSE](LICENSE). A copy sits in `skills/explainer/` so installed copies carry it. The password hashing example adapts the OWASP Password Storage Cheat Sheet and is under CC BY-SA 4.0, as stated on the page.
