# Explainer skill: agent instructions

An agent skill, `explainer`, that builds one self-contained, interactive HTML page (charts, diagrams, step-through figures, drill-down views, reader replies) that works offline from `file://`. The skill is a thin `SKILL.md` plus a CLI (`kit`, `pack`, `check`) that the agent drives.

## Requirements

- Bun 1.4.3 (`curl -fsSL https://bun.sh/install | bash`). The CLI uses Bun's built-in `HTMLRewriter` and `import.meta.dir`; there is no npm install step for users. `node skills/explainer/cli.ts` prints an install hint and exits 2.
- Google Chrome or Chromium for `check` and for rendering Mermaid in `pack` (`CHROME=/path` overrides the search; CI uses the runner's Chrome).

## Layout

```text
skills/explainer/      the installable skill, copied as-is by installers: no dotfiles, tests or node_modules inside
  SKILL.md guide.md example.html
  cli.ts               thin entry: Bun check, then imports src/main.ts (erasable syntax only, so node can run it far enough to explain)
  src/                 main.ts (dispatch, help), commands.ts (one spec per command), paths.ts, pack.ts, check.ts, steps.ts, report.ts, mermaid.ts, chrome.ts (CDP client)
  kit/                 what pages reference as kit:<file>: theme.css, charts.js, plot.js, steps.js, link.js, views.js, reply.js, echarts.js (generated), fonts/, licenses/
  vendor/mermaid.min.js  generated; used by pack to pre-render diagrams, never inlined
build/                 vendor.ts regenerates kit/echarts.js, vendor/mermaid.min.js and the licence texts from the pinned devDependencies; verify-install.ts is the release check for the installers
test/                  contract tests, outside the skill so installs do not ship them
```

Root files: `package.json` (devDependencies only), `bun.lock`, `tsconfig.json`, `biome.json`, `bunfig.toml`, `.husky/`, `.github/workflows/ci.yml`.

## Commands

| Command | What it does |
|---|---|
| `bun install` | Installs dev tools from the lockfile and the git hook (`prepare` runs husky) |
| `bun run typecheck` | `bun check --all` (Bun's built-in checker, same errors as `tsc`), strictest settings |
| `bun run lint` | `biome check` (format check, lint, import order), warnings are errors; no writes |
| `bun run format` | `biome check --write`: formats and applies safe fixes |
| `bun run test` | Contract tests (Chrome needed, about 10 s) |
| `bun run ci` | typecheck, lint, test: the gate; the same command runs in GitHub Actions |
| `bun run verify:install` | Release check, not in `ci` (needs network and Chrome): installs from a clone of HEAD with `npx skills` and Caplet into a temp HOME, then runs `kit`, `pack`, `check` from each copy |
| `bun run vendor` | Regenerates ECharts bundle, Mermaid bundle and licence texts (dev only) |
| `bun skills/explainer/cli.ts kit \| pack \| check` | The skill's CLI; `--help` on any command |

The pre-commit hook (husky + lint-staged) runs Biome with fixes on the staged files, then the typecheck; about 2 s, no Chrome. It keeps partially staged hunks. lint-staged backs up through `git stash`, which worktrees share, so run commits of different worktrees one at a time. Never use `--no-verify`.

`.github/workflows/ci.yml` runs `bun install --frozen-lockfile` and `bun run ci` on ubuntu-latest. Its first run is on the initial push; the Chrome sandbox on Ubuntu is the likeliest thing to need adjusting.

## Decisions

- One skill named `explainer`: thin `SKILL.md` and the CLI as the toolbox; no custom elements; offline single-file output; the house style lives in `kit/theme.css` and `example.html`, not in instructions.
- Runtime is Bun only. Headless Chrome (CDP over WebSocket, no Puppeteer) for `check` and Mermaid rendering.
- Layout is the packaging layout above: Caplet imports `skills/*/SKILL.md` as a bare skill and copies every non-hidden file. Do not add an `acf.yml`; it would make Caplet emit only the files listed in `assets:`.
- Agent-facing text (SKILL.md, guide.md, kit file headers, CLI help) stays short and soft. A kit file's leading comment is its documentation: `kit <file>` prints it, and its first line (`name: description`) is the listing.
- Credits stay: visual-explainer (MIT, Nico Bailon), ECharts (Apache-2.0), Mermaid (MIT), Geist fonts (OFL); their licence texts ship in `kit/licenses/`.
- No local-only dependencies at runtime: nothing but `kit/`, `vendor/` and Chrome is needed after install.

## Limits

Biome (pinned 2.6.2) enforces the quality baseline at error: cognitive complexity 15, function length 80 lines without blanks, file length 600 lines, no `any`, no non-null assertions, no `@ts-ignore`, no import cycles, no unused code. Suppressions need a rule-specific reason and are rare; today they are:

- `kit/*.js`: each file is one IIFE that keeps its names out of the page's global scope, so the function-length rule sees one long function. The code inside is split into small functions.
- `kit/theme.css`: deliberate `!important` overrides (`[hidden]`, reduced motion, print) and selector orders whose properties are disjoint.
- `kit/theme.css` has a file limit of 1400 lines (the formatter puts one declaration per line) instead of 600. It is one stylesheet by design, because `pack` rejects `@import`; lower the limit when it shrinks.

Excluded by path: `kit/echarts.js`, `vendor/mermaid.min.js` (generated), HTML and Markdown. The kit scripts are browser scripts: `echarts` is a declared global and undeclared variables are errors.

TypeScript uses `erasableSyntaxOnly`: no parameter properties, enums or namespaces, so node can strip types in `cli.ts`.

## Installing

Verified with `npx skills` 1.7.4 and Caplet 0.2.0: both copy every file byte for byte (npx skills symlinks the other agents to one canonical copy when several are chosen), and `kit`, `pack` and `check` run from the installed copy with no install step. `bun run verify:install` repeats this from a clone of HEAD (uncommitted changes are not tested); run it before a release and whenever `skills/explainer/` changes shape (new top-level file, dotfile, `package.json`).

Trying an installer by hand: always give it a disposable HOME (installers write to `~/.agents`, `~/.claude` and, for npx skills, `~/.agents/.skill-lock.json`), with `DISABLE_TELEMETRY=1` and `CLAUDE_CONFIG_DIR` unset. Caplet quirks that matter:

- A project-scope Caplet command with no `.agents/` in the project walks up the directory tree. A sandbox below the real home therefore finds the real `~/.agents` and writes to it. Run `caplet init` in the project first (`verify-install.ts` does).
- `caplet add` does not detect that another capability already emits a skill of the same name. Both write into one directory, the files mix, and `caplet check` stays stale. Retire the other source first.
- A local-path source is snapshotted: after changing the checkout run `caplet update explainer`, not `caplet apply`.

## Changing the kit

Kit files are behaviour, not just code. After a change: `pack` then `check` `skills/explainer/example.html` and a few real pages (light and dark, 1440 and 390 wide are covered by `check`), open the screenshots, and compare with the previous output. Pages reference local files relative to themselves, so pack them from where they are with `-o` elsewhere.

## Commits

Conventional Commits (`feat(kit):`, `fix(check):`, `chore:`, `test:`, `docs:`), one change per commit, explicit paths when staging. Gates pass on every commit. The public remote is `github.com/barisgit/explainer-skill` (MIT); releases are tags such as `v0.1.0`, which Caplet installs pin.
