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

Shape the page around what the reader does next: learn a topic, make a decision, or explore data. Lead with the answer, or for study material with the questions the reader must be able to answer; a reader not already inside the subject also gets a line or two beneath it that orient them. Give each section one question; put detail behind clicks or drill-down views instead of fitting everything onto the first screen, but keep one complete list when the page covers a set of items the reader works through. Make it visual and add an interaction where it changes understanding, not to fill a section: the moment that makes the reader say wow is the one where they suddenly get it. Draw on every source that describes the subject, such as a work list, spec or requirements, not only the one with the numbers. Keep claims no stronger than the sources, and say where your own reasoning, not a source, decides something the reader acts on.

Guidance on design, wording, or presentation from the user, the project, or another skill you have loaded wins over this skill's defaults. Restyle the kit through its tokens rather than replacing it.

Work with the CLI next to this file, run as `bun <this-directory>/cli.ts`:

1. Read `guide.md` next to this file: a short list of what made earlier pages better or worse. `example/page.mdx` is one short, finished page that uses the kit where it helps its subject; read it for technique, not as a layout to copy.
2. Write `page.mdx`: Markdown prose, the kit's tags, and `.ts` or `.json` data it imports. Run `kit` to list what a page can use, and `kit <name>` for each you use: interactive ECharts in the page theme (`Chart`, or the light `Plot` for a few small plots), sliders and switches over a figure (`Explore`), tables from data (`Table`), Mermaid diagrams written as ```` ```mermaid ```` fences, TeX formulas, the stylesheet, drill-down views (`View`, with breadcrumbs and previous/next built from your links), trees of nested records that open level by level, step-through figures over HTML and hand-built SVG (`Stepper`), linked highlighting between prose, rows and diagram parts, and questions the reader checks on the spot or answers in a reply with notes (`Question`). Build from these before writing your own scripts and styles: hand-made bars, toggles, and saved state tend to miss the dark theme, phones, and keyboard use that the kit already handles. Only behaviour no tag covers needs a `.tsx` component whose first line is `"use client"`.
3. `pack page.mdx -o artifact.html` renders the page, diagrams and formulas included, into one offline file.
4. `check artifact.html` screenshots light and dark at desktop and phone width into a temp directory it prints, and reports errors, console warnings, network use, and overflow; `--view all` also captures every drill-down view. Look at the screenshots and fix what you see. Then take the main reader's questions one by one and confirm the page answers each without hunting across views; a clean check cannot tell you that.
