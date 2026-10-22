---
name: explainer
description: Build a visual, interactive HTML page (chart explorer, step-through explanation, study page, diagram, comparison, report) as one file that opens offline. Use when the user wants something to see and explore rather than read as text. Skip plain-text answers, production web apps, and slide decks.
---

# Explainer

Shape the page around what the reader does next: learn a topic, make a decision, or explore data. Lead with the answer, or for study material with the questions the reader must be able to answer, and give each section one question; put detail behind clicks or drill-down views instead of fitting everything onto the first screen. Make it visual and add an interaction where it changes understanding, not to fill a section: the moment that makes the reader say wow is the one where they suddenly get it. Keep claims no stronger than the sources, and label what you inferred.

The toolbox is the CLI next to this file, run as `bun <this-directory>/cli.ts`:

- `kit` lists what a page can use: interactive ECharts in the page theme (or the light `plot.js` for a few small line, stem and bar plots), Mermaid diagrams written as `<pre class="mermaid">`, the stylesheet, drill-down views, step-through figures (Mermaid diagrams included), linked highlighting between prose, rows and diagram parts, and reader replies that send notes and answers back (the same file keeps the reader's inputs and notes across reloads, with a button to clear them; give inputs ids). Each is a few HTML attributes; `kit <file>` documents one.
- `pack page.html -o artifact.html` inlines everything into one offline file and renders the Mermaid diagrams.
- `check artifact.html` screenshots light and dark at desktop and phone width into a temp directory it prints, and reports errors, console warnings, network use, and overflow; `--view all` also captures every drill-down view. Look at the screenshots and fix what you see before calling the page done.

Before designing, read `guide.md` next to this file: a short list of what made earlier pages better or worse. `example.html` is one short, finished page that uses each kit feature where it helps its subject; read it for technique, not as a layout to copy.
