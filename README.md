# Explainer

An agent skill that turns "show me" into one self-contained, interactive HTML page: charts you can explore, Mermaid diagrams you can step through, drill-down views, and replies that send the reader's notes and answers back to the agent. The page works offline from `file://`, in light and dark, on desktop and phone.

The agent reads `skills/explainer/SKILL.md` and drives a small CLI:

```sh
bun skills/explainer/cli.ts kit                      # what a page can use
bun skills/explainer/cli.ts pack page.html -o artifact.html
bun skills/explainer/cli.ts check artifact.html      # screenshots + problems
```

`skills/explainer/example.html` is a finished page to read for technique.

## Install

_To be written: how to install the skill with Caplet and with the other installer._

## Requirements

- [Bun](https://bun.sh), developed and tested with 1.4.3. The CLI does not run under node.
- Google Chrome or Chromium, for `check` and for rendering Mermaid diagrams during `pack` (`CHROME=/path/to/chrome` if it is not found).

## Layout

| Path | Contents |
|---|---|
| `skills/explainer/` | The installable skill: `SKILL.md`, `guide.md`, `example.html`, the CLI (`cli.ts`, `src/`), the kit (`kit/`) and `vendor/` |
| `build/` | Regenerates the ECharts bundle, the Mermaid bundle and their licence texts |
| `test/` | Contract tests for the CLI |
| `AGENTS.md` | Commands, decisions and limits for contributors and agents |

## Development

```sh
bun install          # dev tools and the git hook
bun run ci           # typecheck, lint (Biome), tests; what GitHub Actions runs
bun run format       # apply formatting and safe lint fixes
```

`.github/workflows/ci.yml` is prepared but has not run yet: the repository has no remote. Details and decisions are in [AGENTS.md](AGENTS.md).

## Credits

- [visual-explainer](https://github.com/nicobailon/visual-explainer) by Nico Bailon (MIT): the look and the reply flow.
- [Apache ECharts](https://echarts.apache.org) (Apache-2.0) and [Mermaid](https://mermaid.js.org) (MIT), bundled in the kit.
- [Geist and Geist Mono](https://vercel.com/font) by Vercel (SIL OFL 1.1).

Licence texts are in `skills/explainer/kit/licenses/`.

## Licence

Not chosen yet.
