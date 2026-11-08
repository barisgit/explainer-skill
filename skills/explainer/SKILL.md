---
name: explainer
description: Build a visual, interactive HTML page (chart explorer, step-through
  explanation, study page, diagram, comparison, report) as one file that opens
  offline. Use when the user wants something to see and explore rather than read
  as text. Skip plain-text answers, production web apps, and slide decks.
license: MIT
compatibility: Needs Bun 1.4.3 or later, and Google Chrome or Chromium for check.
---
# Explainer

Fit a short first route to the reader's knowledge, goal and available time from the request; ask when unknown and it would change the page. Lead with one short answer, name their next action and its size directly beneath it, and put that action's section first. Briefly orient novices; keep the main path short and the rest as reference. A lost or time-pressed reader needs one task at a time, not a whole course; unfamiliar material needs a worked example before practice. Give each section one question. Keep a complete list when readers work through a set, and show each item whole beside its evidence and reply question when they must judge it. Use visuals and interaction to build understanding, not fill sections. Draw on the sources that describe the subject, not only its numbers: bring real images in locally and link claims to sources. Offline means no network needed, not no links. Keep claims no stronger than their sources and distinguish the page's own reasoning.

Guidance on design, wording, or presentation from the user, the project, or another skill you have loaded wins over this skill's defaults. Restyle the kit through its tokens rather than replacing it.

Work with the CLI next to this file, run as `bun <this-directory>/cli.ts`:

1. Read `guide.md` next to this file: a short list of what made earlier pages better or worse. `example/page.mdx` is one short, finished page that uses the kit where it helps its subject; read it for technique, not as a layout to copy.
2. Write `page.mdx`: Markdown prose, the kit's tags, and `.ts` or `.json` data it imports. Run `kit` to list what a page can use, and `kit <name>` for each you use: interactive ECharts in the page theme (`Chart`, or the light `Plot` for a few small plots), sliders and switches over a figure (`Explore`; with `Controls`, one set of them drives figures in several sections), tables from data (`Table`), Mermaid diagrams written as ```` ```mermaid ```` fences, circuits as ```` ```schematic ```` netlists, TeX formulas, the stylesheet, drill-down views (`View`, with breadcrumbs and previous/next built from your links), one collection of records as a grouped tree, sortable table or board with search and filters (`Records`), step-through figures over HTML and hand-built SVG (`Stepper`), linked highlighting between prose, rows and diagram parts, and questions the reader checks on the spot or answers in a reply with notes (`Question`). Build from these before writing your own scripts and styles: hand-made bars, toggles, and saved state tend to miss the dark theme, phones, and keyboard use that the kit already handles. Only behaviour no tag covers needs a `.tsx` component whose first line is `"use client"`.
3. `pack page.mdx -o artifact.html` renders the page, diagrams and formulas included, into one offline file.
4. `check artifact.html` screenshots light and dark at desktop and phone width into a temp directory it prints, and reports errors, console warnings, network use, and overflow; `--view all` also captures every drill-down view, and `--do` clicks, drags, types or sets fields instead of the default bounded kit-control sample; `--do shot:<css>` saves one element. Look at the screenshots and fix what you see. Then follow the first route as the intended reader: can they start without reading all the context, learn what the first control reveals, and answer beside the evidence with choices that fit? Check the remaining questions without hunting across views; a clean check cannot tell you that.
