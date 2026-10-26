# Changelog

## Unreleased

One collection of records, shown as a grouped tree, a sortable table or a board, is one component: `Records`. It replaces `Tree`. Mermaid diagrams stay readable on phones and in print.

### What an author does differently

- Write `<Records {...plan} />` with a config object (`kit Records`): flat `data`, `idField`, `fields` with a kind each, `columns`, and `groupBy` for the tree's levels. `views`, `search`, `facets` and `sort` add the controls; the view, sort, search, filters and open folds go in the URL hash, so `<a href="#plan?f.owner=JV">` opens a filtered list. `link` names a filled `View` each row opens, with previous/next through the rows shown; `detail` names a text field each row opens to in place, in the tree, the table and the board alike.
- A field with `sum: true` adds subtotals and a total. Records without a value never count as zero: the sum shows what is known plus a question mark, `1,372 h + ?` (or `?` when no record has a value), since a missing value may be negative, and screen readers hear how many records it leaves out.
- A block inside a `View` keeps its state after the view's route: `#team?crew?view=table`. A view's route ends at its first `?`, and what follows belongs to what the view holds; client code reads and writes that part with `Views.local(el)` and `Views.setLocal(el, text)`, which keep the view's trail. Previous and next walk views by their route, so links that carry state (`#v/a?panel?x=1`) still get them, and follow each link with its state. `View`'s `param` takes the record id as it is; link to an id with `?`, `#` or `%` in it as `encodeURIComponent` writes it (`#s/a%3Fb`).
- `pack` checks the config and fails with the path of each problem (`fields.hours.kind`) and what to write instead. It also fails on a `link` that names no `View`, and on a block `id` that is also a View's name, in the page and in each record a filled `View` draws.
- `Tree` is gone. Flatten its nested `items` into records with the group's name as a field, list those fields in `groupBy`, and move a row's `text` and `ref` into fields named by `detail` and `refField`. Hand-written `.tree` markup still works. Uneven depths and JSX cells have no Records form; write the `<details>` yourself for those.
- New label keys for the block's controls and texts (`kit labels` lists them, all starting with `records`).

### Mermaid

- Mermaid diagrams stay readable on phones. A flowchart or state diagram too wide for a phone gets a second layout across its direction (left to right becomes top-down), shown below 40rem, so left to right is fine to write. Other diagrams shrink until their smallest text is 10 px, then scroll sideways. Printed, each diagram fits the paper whole, top-down when the left-to-right layout would be too small to read.
- A diagram's width limits are the custom properties `--mermaid-max` and `--mermaid-min` on its `svg`, so one page rule can change them.
- A circle node with a short label is about the size of a box node, not a large disc.
- Flowcharts turn back only the edges of a real cycle. An input written after the node it feeds now sits before that node, instead of being looped around it.
- `check`'s warning about tiny SVG text names the fix: drop the page rule that squeezes a diagram, or for a hand-built SVG, redraw it about 360 wide or hold it at the `min-width` it gives inside a `.scroll` block.

### check

- `check` waits after each load and `--do` step until the page has settled instead of a fixed time: fonts loaded, every visible chart drawn, and the timers of up to 1 s the page set have run. A slow island chart is in the shots, and an error a page throws shortly after a click is reported. What is still missing after 10 s is a problem: `still waiting after 10 s for charts to be drawn: div#sales.chart`.
- When Chrome fails to start or stops answering, `check` prints one line and exits 1 with no report, for example `error: the load event of file:///…/page.html did not come in 10 s (at dark narrow, view #fix/none)`. It used to wait forever.
- `--timeout <seconds>` (default 600) limits the whole run: `error: check passed its 600 s limit at light desktop, view #plan/a, after 324 page(s): raise --timeout for a page with many views or --do steps`.
- Chrome exits with `check` however `check` ends, and its profile is deleted (also on Ctrl-C or SIGTERM). Before, every run left a profile of up to 150 MB in the temp directory, and a `check` killed by a timeout left a Chrome running that used a CPU core.
- Chrome no longer downloads components or models while it checks a page.

## v0.9.0

Pages are MDX. An agent writes `page.mdx`: Markdown prose, the kit's components, and the `.ts` or `.json` data and `.css` it imports. `pack` renders it once to static HTML with Preact and ships code only for client components. Packed v0.8 files still open offline, and `check` still takes them.

### What an author does differently

- Write `page.mdx` instead of `page.html`; `pack` refuses any other input. There are no `kit:` references to write: `pack` adds the theme and the kit scripts the page uses.
- Prose, lists, tables and formulas are Markdown. A `#` and the paragraphs under it are the masthead; each `##` starts a section; a Markdown table is a `table.compare`.
- Figures and interactions are components imported from `"kit"`. Behaviour no component covers goes in your own `.tsx` component whose first line is `"use client"`.
- Page settings move into frontmatter: `lang` instead of `<html lang>`, `labels` instead of `var kitLabels`, `scheme` instead of `<html data-scheme>`.
- Controls with ids are kept across reloads without `reply.js`. Ids repeated on one page fail `pack`.
- Images and fonts that code shows are imported (`import icon from "./icon.svg"` gives a `data:` URL `pack` embeds). A file path written in client code, its props or a filled view's records fails `pack`, since the browser would load it later.
- `example.html` is now `example/` (`page.mdx` and the model it imports).

Before (v0.8.2), a step-through figure:

```html
<link rel="stylesheet" href="kit:theme.css">
<figure class="fig" data-stepper data-start="1">
  <svg viewBox="0 0 90 20"><rect data-step="1" width="20" height="20" /><rect data-step="2" x="35" width="20" height="20" /></svg>
  <ol data-captions><li>The queue is empty</li><li>A burst arrives</li></ol>
</figure>
<script src="kit:steps.js"></script>
```

After (v0.9.0):

```mdx
import { Stepper } from "kit";

<Stepper start={1} captions={["The queue is empty", "A burst arrives"]}>
  <svg viewBox="0 0 90 20"><rect data-step="1" width="20" height="20" /><rect data-step="2" x="35" width="20" height="20" /></svg>
</Stepper>
```

### New public names

Components, imported from `"kit"` (`kit <Name>` documents each):

- `Chart`: `option`, `label`, `class`, `setup`. Formatters and labels may be JSON (`{ digits: 1, unit: "min" }`, `{ percent: true }`, `{ currency: "EUR", compact: true }`, or one text per item).
- `Plot`: `option` (`series`, `categories`, `horizontal`, `stack`, `x`, `y`, `legend`), `label`, `class`. Axis `format` and series `label` take the same JSON formats; numbers follow the page's `lang`.
- `Explore`: `controls` (each `{ id, label }` with `range: [min, max, step]`, `choice` or `toggle: true`, and `value`, `format`), `frame`, `base`, `label`, `class`. A slider, switch or toggles changing a plot or chart, readout, `stats` and caption; `frame` runs in the browser when a `"use client"` module exports it, else `pack` computes every frame.
- `Stepper`: `captions`, `captionsFirst`, `start`, `label`, `class`, `onStep`, `restartOn` (back to step 1 when it changes).
- `View`: `name`, `param`, `back` for a static view per record; `records` and `render` fill one view from data.
- `Tree`: `items`, `row`, `cols`, `head`; types `TreeItem`, `TreeRow`.
- `Table`: `rows`, `cols` (each `head`, `value`, `format`, `link`, `note`), `state`.
- `Question`: `name`, `legend`, `options`, `multiple`, `checked`, `answer` (a self-check that marks the choice and opens the explanation written inside). Without `options` it takes a written answer.

Frontmatter keys: `title`, `lang`, `labels`, `reply: true`, `scheme: light | dark`.

Math: `$...$` in a sentence and `$$` on lines of their own render to MathML when the page packs (`kit math.css`, with the formula sheet pattern).

Slots: Markdown between a client component's tags is its `children`, rendered once and placed with `{children}`.

CLI: `pack page.mdx -o out.html`; `kit` lists components and features, `kit <Name>` documents one, `kit page` the page conventions, `kit labels` prints every kit text as a frontmatter `labels` block to translate, `kit types > tsconfig.json` then `bun check` typechecks the page's `.ts` and `.tsx` with nothing to install.

### Removed

- HTML as `pack` input, and the `kit:` file references in a page.
- `kit <file>` for the kit scripts that components now write for you (`views.js`, `steps.js`, `charts.js`, `plot.js`); `kit link`, `kit reply` and `kit keep` document the attributes that stay.
- `var kitLabels` in a page script; use the frontmatter `labels`.
