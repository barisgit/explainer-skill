# Explainer

An agent skill that turns "show me" into one self-contained, interactive HTML page: charts you can explore, Mermaid diagrams you can step through, drill-down views, and replies that send the reader's notes and answers back to the agent. The page works offline from `file://`, in light and dark, on desktop and phone.

The agent reads `skills/explainer/SKILL.md` and drives a small CLI (see Commands). `skills/explainer/example.html` is a finished page to read for technique.

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

An installed skill can be checked with `bun ~/.claude/skills/explainer/cli.ts kit`. Use one installer per machine: both write `~/.agents/skills/explainer`, and Caplet does not warn when another source already emits a skill of the same name (see [AGENTS.md](AGENTS.md)).

### Update

```sh
npx skills add ~/Programming_local/Projects/explainer-skill --global --agent claude-code --agent codex -y   # local path: add again
npx skills update explainer --global                                                                         # GitHub source
caplet update explainer --scope user                                                                        # re-reads the source and applies
```

`npx skills update` cannot check a local path, and plain `caplet apply` reuses the snapshot of a local source, so use the commands above after changing the checkout.

### Uninstall

```sh
npx skills remove explainer --global -y
caplet remove explainer --scope user && caplet apply --scope user
```

Caplet leaves empty `kit`, `src` and `vendor` folders under `skills/explainer/`; delete them if they bother you.

### Publishing

- npx skills needs a public GitHub repository (or any git URL). The skills.sh listing comes from install telemetry, so the skill appears there after people install it.
- Caplet takes `github:<owner>/<repo>` or `git:<url>` with a required `--pin <ref>`: a branch to follow, or a tag for a fixed version.
- There is no `acf.yml` on purpose. Caplet then imports `skills/explainer/` whole; an `acf.yml` would limit it to `SKILL.md` and the files listed in `assets:`.

## Requirements

- [Bun](https://bun.sh), verified with 1.4.3. Nothing else is installed: no `npm install`, the installed skill runs as copied. The CLI does not run under node; `node cli.ts` prints how to get Bun and exits 2.
- Google Chrome or Chromium, for `check` and for rendering Mermaid diagrams during `pack` (`CHROME=/path/to/chrome` if it is not found). Without a system Chrome, a build downloaded by agent-browser or Playwright is used. Where the host blocks Chrome's sandbox (Ubuntu 23.10+, most containers), Chrome runs without it.

## Commands

Run as `bun <skill directory>/cli.ts <command>`; `--help` on any command lists its options.

| Command | What it does |
|---|---|
| `kit [file]` | Lists what a page can use, or documents one kit file |
| `pack page.html -o artifact.html` | Inlines the kit and local assets and renders Mermaid diagrams into one offline file |
| `check artifact.html` | Opens the page headless in light and dark at desktop and phone width, saves screenshots and reports problems (exit 1) |

## Layout

| Path | Contents |
|---|---|
| `skills/explainer/` | The installable skill: `SKILL.md`, `guide.md`, `example.html`, the CLI (`cli.ts`, `src/`), the kit (`kit/`) and `vendor/` |
| `build/` | Regenerates the ECharts bundle, the Mermaid bundle and their licence texts |
| `test/` | Contract tests for the CLI |
| `AGENTS.md` | Commands, decisions and limits for contributors and agents |

## Development

```sh
bun install               # dev tools and the git hook
bun run ci                # typecheck, lint (Biome), tests; what GitHub Actions runs
bun run format            # apply formatting and safe lint fixes
bun run verify:install    # before a release: installs with both installers into a temp HOME (network, Chrome)
```

GitHub Actions runs the same gate (`.github/workflows/ci.yml`). Details and decisions are in [AGENTS.md](AGENTS.md).

## Credits

- [visual-explainer](https://github.com/nicobailon/visual-explainer) by Nico Bailon (MIT): the look and the reply flow.
- [Apache ECharts](https://echarts.apache.org) (Apache-2.0) and [Mermaid](https://mermaid.js.org) (MIT), bundled in the kit.
- [Geist and Geist Mono](https://vercel.com/font) by Vercel (SIL OFL 1.1).

Licence texts are in `skills/explainer/kit/licenses/`.

## Licence

MIT, see [LICENSE](LICENSE). A copy sits in `skills/explainer/` so installed copies carry it.
