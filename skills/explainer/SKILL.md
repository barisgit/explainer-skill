---
name: explainer
description: Build a visual, interactive HTML page (chart explorer, step-through explanation, study page, diagram, comparison, report) as one file that opens offline. Use when the user wants something to see and explore rather than read as text. Skip plain-text answers, production web apps, and slide decks.
license: MIT
compatibility: Needs Bun 1.4.3 or later, and Google Chrome or Chromium for check.
---

# Explainer

Shape the page around what the reader does next: learn a topic, make a decision, or explore data. Lead with the answer, or for study material with the questions the reader must be able to answer; a reader not already inside the subject also gets a line or two beneath it that orient them. Give each section one question; put detail behind clicks or drill-down views instead of fitting everything onto the first screen, but keep one complete list when the page covers a set of items the reader works through. Make it visual and add an interaction where it changes understanding, not to fill a section: the moment that makes the reader say wow is the one where they suddenly get it. Draw on every source that describes the subject, such as a work list, spec or requirements, not only the one with the numbers. Keep claims no stronger than the sources, and say where your own reasoning, not a source, decides something the reader acts on.

Guidance on design, wording, or presentation from the user, the project, or another skill you have loaded wins over this skill's defaults. Restyle the kit through its tokens rather than replacing it.

Work with the CLI next to this file, run as `bun <this-directory>/cli.ts`:

1. Read `guide.md` next to this file: a short list of what made earlier pages better or worse. `example.html` is one short, finished page that uses each kit feature where it helps its subject; read it for technique, not as a layout to copy.
2. Run `kit` to list what a page can use: interactive ECharts in the page theme (or the light `plot.js` for a few small line, stem and bar plots), Mermaid diagrams written as `<pre class="mermaid">`, the stylesheet, drill-down views (with breadcrumbs and previous/next built from your links), step-through figures over HTML and hand-built SVG, linked highlighting between prose, rows and diagram parts, and reader replies that send notes and answers back (the same file keeps the reader's inputs and notes across reloads, with a button to clear them; give inputs ids). Each is a few HTML attributes; run `kit <file>` for each one you use. Build from these before writing your own scripts and styles: hand-made bars, toggles, and saved state tend to miss the dark theme, phones, and keyboard use that the kit already handles.
3. `pack page.html -o artifact.html` inlines everything into one offline file and renders the Mermaid diagrams.
4. `check artifact.html` screenshots light and dark at desktop and phone width into a temp directory it prints, and reports errors, console warnings, network use, and overflow; `--view all` also captures every drill-down view. Look at the screenshots and fix what you see. Then take the main reader's questions one by one and confirm the page answers each without hunting across views; a clean check cannot tell you that.
