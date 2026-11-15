# Changelog

## Unreleased

Linked parts now share a screen: `.beside` keeps a figure, diagram or code in view while its text scrolls, a `Stepper` steps through a Mermaid diagram by naming its refs, an `Explore` frame sets states on the page's parts, and code fences are coloured at pack time with marks that link to the prose. Questions read as answers, with a recommended choice, a note and an answered count. The kit's look is plainer: a darker dark scheme, three type sizes, figures without panels, and one square control style. A long page asks for the contents rail with `contents: true`, and the masthead can carry the reader's next action. `check` tries the page's kit controls by itself, drags, prints the reply it would send, follows dead links and sweeps inner scrollers.

### Pages that may need a change

- The default look is plainer (#190). Figures, a figure with controls included, have no fill, frame, rounded corners or dot grid: the controls sit right above what they act on, and children of a `.fig` are no longer inset (set `--pad` on the figure to inset them). Sections are set apart by space, not hairlines. Type keeps to three roles, `--size-display` (headlines at `--size-headline`), `--size-text` (17 px) and `--size-label` (13 px, all text in figures and controls, captions, meta lines and navigation). Code keeps its mono face in those roles: inline code is the size of the text around it, and a code block, fenced or hand-written, is set at the label's size, where a fence used to be 0.766em of the text (#176); a page rule that relied on the old sizes, on `--blueprint` or `--grid` (both removed), or on the old rounded `--radius` (now 2 px) may need a look. Segmented choices, buttons, toggles (now square boxes, a checked one edged in ink around its series colour), facets and answer choices share one style: square-ish, a 1 px edge in `--rule-strong`, the chosen or pressed state in ink; the primary button and sliders are ink, links and focus rings stay in the accent. A lit or current SVG part is drawn in the accent instead of glowing.
- Dark is darker (`--bg` #0b0a09, `--surface` #141210, `--sunken` #1c1916), and `--rule-strong` is darker in light (#8f8574) and lighter in dark (#706759), so control edges and axes reach 3:1 on every tone. Page colours tuned against the old tokens may need a look.
- A `Records` block whose tree fits the reading column stays on it (#188). Unset, `width` is now the column when the block offers only the tree and that tree fits, and wide otherwise (a table or a board always takes the wide measure); write `width="wide"` to keep the old width.
- Typecheck a page with `bun --check` after `kit types > tsconfig.json`, not `bun check`, which a repository's own `check` script could silently replace (#158).
- Markup written between an `Explore`'s or a `Controls`'s tags now fails `pack` instead of vanishing: markup per frame belongs in a client component (#153).
- An Explore `readout` takes block content (a `div`, a paragraph) as written; it is now a `div[data-readout]` instead of a `p`, which the browser split around a `div` so the figure vanished. Plain-text and inline readouts look the same; a page rule or script that selected `#id > p` for the readout selects `[data-readout]` (#139).
- Ranking rows are `ol.rank > li > details > summary + .more`: click, Enter and Space open and close the detail without a page script. Replace the old button with the details/summary wrapper and remove `hidden` from `.more`. Titles wrap in a flexible column instead of being capped at 7rem.
- `<div class="beside">` (the text, then a figure, diagram or code fence) stands side by side from 56rem, the text starting with the column like the prose around it and the figure reaching out to `.wide`'s end (a narrow diagram starts beside its text), and the figure stays in view (sticky, below the Reply bar) while the text scrolls; phones stack them (#159, #179).
- `Question` choices are rows in ink with a radio dot or check box, so they read as answers rather than settings (Explore and toolbar switches are segmented rows); phones stack them. A self-check now says Right or Wrong in words and to screen readers (#136, #79, #151).
- `check` fails on a link to an in-page target that does not exist (ids, named anchors and kit view routes count) and warns about a relative file missing beside the checked HTML: distribute those files with it. External links are never fetched (#150, #155).
- `pack` fails on a Chart series type the kit does not bundle in an option it can see, naming the type and what to use instead; `kit Chart` lists the bundled series and components.
- Charts carry no chrome by default: no gridlines or axis ticks, and a quiet baseline on category and time axes; axis labels stay. Turn one back on in the option (`yAxis: { splitLine: { show: true } }`), which keeps the theme's colours (#190).

### What you write differently

- Step through a Mermaid diagram, or light parts anywhere on the page, by naming refs: `<Stepper captions={[...]} refs={["m1", "m2 call"]}>` fades each ref until its first step and lights it on the steps that name it (a sequence diagram's messages are `m1`, `m2`, ...). `data-steps` on a Mermaid block fails `pack` pointing to `refs`. An Explore frame returns `states: { numpy: "imports" }` to set `data-state` on the parts of a ref, which the page's CSS styles. `pack` writes the starting states into the file and fails on a ref no element has (#152, #153).
- Code fences are coloured when the page packs (TypeScript, TSX, JavaScript, JSON, shell, Python, C, VHDL, CSS, HTML, diff, YAML, SQL, Rust, Go and other common languages; any other stays plain), in light and dark with no script. Write `ref:name="text"` after the fence's language (```` ```ts ref:call="api.call" ````) and every `api.call` in the fence carries `data-ref="call"`, lighting with a partner outside the fence (marks in one fence do not link each other). Tabs indent 4 columns, 2 on phones, and a line wrapped on a phone or on paper continues under its own start (`kit code`; #154, #166).
- Mark a `Question`'s recommendation with `recommended="value"` instead of writing it into the label: the choice shows the mark and the reply sends the bare option, adding "(recommended)" when the reader picked it. `note` adds a field under the choices that is kept and sent under the answer, as `Records` reply notes are. With two or more questions the reply bar shows "3 of 16 answered", on a row of its own above the buttons when they leave too little room; a choice counts once the reader makes or confirms it. `Records` reply choices get a 44 px tap height on phones (#136, #79, #151).
- Put the reader's next action under the lede as a masthead paragraph that opens with a bold label (`**Start:** change one bit, 2 minutes`): it reads on from the lede in the same text and ink, instead of as small grey meta (#141).
- A long page without views gets the contents rail, with the current section marked while scrolling, when its frontmatter says `contents: true`; a page with views keeps its rail without asking. `data-nav` on an `h2` (`<h2 data-nav="Price">`) gives a section a shorter entry, and inside an author-written section names that section's entry, the section's own `data-nav` taking precedence (#68).
- `Chart` supports ECharts' `custom` series for shapes drawn by `renderItem`, including ranges and timeline bars; such charts draw in the browser, not at pack time. Options computed only in client code still reach ECharts at runtime, and `check` reports its console errors.
- An `aria-label` names a view link or note target explicitly. Tree-branch notes use the summary's first cell instead of gluing its numbers and descendant rows into the label.
- To restyle a kit-styled element on purpose, add a class the kit does not use to the element and the selector, such as `.chip.verdict`; `pack`'s kit-class warning and `kit theme` say so.
- Saved answers in a `file://` page are browser-local convenience, not a durable record: use reply's "Copy reply" to keep important answers outside the page (#148).
- The guide fits a short first route to the reader's knowledge and time, puts their next action and its size beneath the answer, and puts worked examples before novice practice. It calls for a screen per question with folded reference, readable source images and candidate links, guided controls and comparable states, and decisions beside their evidence with realistic choices, marked recommendations and consistent counts. A homework page walks the deliverables one at a time in the source's order and numbering, works the hard ones through, flags errors in the source and grounds steps in the reader's own tools and starting point; the guide also says how to choose the page's language (#115, #140). It now asks for each hard deliverable at its own scale (or a rule with a way to check it, and a code skeleton for code), keeps what a step needs out of folds, has a claimed source error recomputed and quoted, asks for a tool or toolchain the source did not supply, and with a deadline makes the first step of the first task the next action (#181).
- The guide asks for pages written like a spec: the finding with its number as headline, one sentence of scope and the whole first figure on the first screen, a figure form chosen from each claim with values on the marks, one accent with one meaning, one control per figure only where it answers a question, no caption, meta line or legend that repeats what is shown, no stepper or animation over structure that does not change, and no illustration or circuit that does not bear on the decision. The next-action line is for readers with a task to begin.
- `kit Explore` says what `check --do` targets for each control: `set:#id=value` for a slider, `click:#id-1` for a choice's second option, `click:#id` for a toggle (#182).

### What pack and check report

- A default `check` samples visible kit controls once on the light-desktop overview: up to 12, the first of each kind before the rest in document order, so an early run of Questions cannot crowd out a later stepper or Plot. Each click starts from a fresh load with Keep cleared, and view links with state (`#team?crew?view=table`) count as their view. Findings name the control; one warning reports incomplete coverage under the cap or the shared 8 s budget (cleanup included). These loads add neither scroll sweeps nor PNGs. `--quick` and explicit `--do` skip the sample; use `--do` for other controls or a failing state (#14).
- `check --do reply` prints the exact current reply Markdown, after any answer or note steps, without copying or sending it; `--json` returns `replies` with each action's step, theme, viewport and Markdown. Repack older exports to make their reply text available (#156).
- `check --do drag:x,y-x,y` performs a real left-button drag, including ECharts canvas dataZoom sliders; points are viewport-relative after preceding scrolls, and `hover:<css>` scrolls to its target and hovers its centre. Click and drag notes name event targets, chart containers, observed chart events and hash changes per theme and size, without dumping chart data, and stay in text and JSON when a later settle times out (#19).
- `check` warns when parts sharing a `data-ref`, or a stepper's captions and the parts they light, are more than a screen apart at desktop width, naming the ref or stepper (#159).
- `pack` and `check` warn when Markdown link syntax stays literal outside code: put destinations with spaces in `<angle brackets>` or encode spaces as `%20`, and use code for intentional syntax examples (#150).
- `check` sweeps inner `overflow: auto/scroll` containers on both axes as well as the document, including panels revealed or inserted by document scrolling, and restores their scroll positions. All targets share one 3 s budget per page load; an incomplete sweep warns which ends were not reached, grouped across screens (#15).
- Full-page `check` PNGs put document-sticky boxes at their flow positions and omit viewport-fixed overlays; scoped fixed boxes, SVGs included, stay. Visible author-fixed omissions are grouped warnings in text and JSON; `--do shot:<css>` captures one explicitly. The kit's own Reply bar and contents rail are omitted silently, since first-screen PNGs already show them (#178). Capture keeps interaction state, styles and scroll positions, and defers pending timers and animation frames without dropping them (#45).
- `pack` checks at most 256 combinations of a client `Explore` frame instead of the full control product: the defaults plus an evenly spaced sample including both endpoints. Small products are still checked in full, as are precomputed frames; untested combinations can fail for readers.

### Fixes

- A single unpositioned horizontal legend gets room below an ordinary grid chart on mount, resize and option updates, from ECharts' rendered box (inherited text styles and responsive options included) in live charts and pack's three copies alike. Explicit vertical grid bounds or legend placement win. A Chart whose legend wraps differently across a drawn copy's widths, positioned or not, is left to the script, as Plot already was, and so is uncertifiable legend geometry or text with glyphs outside pack's Geist metrics. Electricity's world chart keeps its drawing with a single-row scrolling legend.
- Swapping chart series with `set(patch, ["series"])` closes any open tooltip first, so the next hover no longer throws in ECharts.
- A Chart that a stepper or an Explore changes tweens from the state on show instead of drawing its series in again from nothing: a series keeps its marks when its `id`, else its name, else its position stays, and the chart then shows what a fresh mount of the new option shows, with the reader's legend toggles and scroll, zoom window and visualMap range kept. A chart's first draw, live or packed, does not animate, whatever the option's root or `baseOption` `animation` says (one set in an active `media` option or on a series still does); reduced motion turns updates off (#189).
- Steppers print every part at full opacity and every caption, whichever step is open on screen.
- Sections inside figures no longer get the page's section gaps. A figure with controls still clips its contents, short of its controls' focus rings, without stopping sticky rows from following the page scroll.
- The contents rail starts below the Reply bar, so the bar no longer covers its first entries and neither overlaps the other at any width (#187).
- Control rows tighten their gaps on phones, so four short toggles stay in one row (#142).
- Fresh `check` loads clear local and session storage from a loaded, script-free file document, after the previous page unloads and before author scripts run, instead of with a new-document preload or origin-wide deletion; explicit `--do reload` keeps saved state, and the control sample no longer clears the screenshot tab's session storage (#145).
- `check` follows full-document navigation during a step's settling and hit feedback without replaying the action or losing the outgoing hit, and a load waits for the requested document's commit and load, not an earlier navigation's (#146, #149).
- A canceled control sample closes its temporary tab even while attachment is still pending (#14).

## v0.12.1

`check` stops Chrome by closing its debugging pipe, so Chrome exits cleanly. On macOS, Chrome ended by a signal left a copy of the whole app (its code-signing clone, about 1,340 files) in the user's temp area on every run; a clean exit removes it. A Chrome that does not exit within 3 s still gets SIGTERM, then SIGKILL.

## v0.12.0

A circuit is a ```schematic fence: a netlist that `pack` places, wires and draws as one SVG.

A page with a `Chart` is about 500 KB smaller: `pack` carries ECharts compressed and the page unpacks it as it loads.

A page where the reader must judge every item now has what it needs: each `Records` row can carry the reader's answer, groups can start open, the block can use the window's width, and the reply lists answers with their notes.

### What an author does differently

- Write each part on a line, nets by name, and where it goes: `Q1 c b e BC547 @0,0`, `R_C vcc c 4.7k b@Q1.c 0,-1 v` (this resistor's `b` pin one unit above Q1's collector). `pack` routes the nets on a grid, adds ground symbols, junction dots and labels, and fails with the line and what to change on a part with no place, an unknown pin, parts on top of each other, a net it cannot route, a label with no room, an IC pin written twice, an `nc` pin that touches anything, or a net that joins one pin or touches another (a part's lead counts as part of its pin). Symbols: resistor, capacitor, electrolytic, inductor, diode, zener, LED, switch, battery, voltage and current source, potentiometer, NPN and PNP, N and P MOSFET, op-amp, IC with named pins, terminals, supply rails and ground. `kit schematic` has the reference.
- Parts link to the prose with `data-ref="R_C"`; a net's name (`vcc`, `gnd`) lights its wires and junctions. Grounds always hang down: a pin on ground that faces up fails `pack` and tells you to turn the part. A label must be nearer its own part than any other. The drawing follows light, dark and a page's tokens, fills the column up to part names at 16 px, shrinks to 10 px text and then scrolls sideways on a phone, and fits the paper in print.
- A page with charts needs no change. The examples with charts go from 1.3 to 1.5 MB to 0.8 to 1.0 MB. ECharts is ready about 100 ms after the page loads (headless Chrome); until then the charts `pack` drew stay in place and the live charts replace them as before. It needs `DecompressionStream` (Chrome 103, Firefox 113, Safari 16.4); an older browser keeps the drawn charts, and a chart `pack` could not draw stays empty.
- Client code that calls `Charts.make` needs no change. Code that reads the `echarts` global directly (not through a chart's `setup`) runs before ECharts exists: wait for `window.echartsReady`.
- `Records` takes `reply: { options: ["Agree", "Change", "Need context"], note: true }` (the choices as a list of labels or `value: label` pairs, as `Question`'s `options`): every record gets those choices and an optional note beside its row, in the tree, table and board. The answers are kept across reloads like any control, and join the reply under the record's label (its leading text columns). No choice starts chosen, so a row the reader skipped shows. An answer stays when the reader changes view or a filter hides its row and brings it back. A block with `reply` carries `keep` and `reply` scripts, also when a client component of yours renders it later (one whose props are written out with no `reply` and no spread brings neither). New label keys `recordsAnswer` and `recordsNote`.
- `open: true` opens every group and every record's detail at load; `open: 1` (or another number up to the depth of `groupBy`) opens that many group levels. The hash writes only what the reader changed from there.
- `width: "full"` spans the window from gutter to gutter, beside the contents rail from the rail to the gutter, centred on the column and with the breadcrumbs where they were; it has no maximum width. Phones are unchanged.
- Records is keyboard-navigable: one Tab stop on the rows, Up, Down, Home and End between rows, Right and Left to open, close and leave a group in the tree, Enter to follow a row's link or fold, `/` to search. A block with a `reply` is always an island, so the keys work there.
- Every reply, from `Question`s and row answers alike, lists the answered items with their choice and note together, and folds the unanswered into one line, `Not answered: ...`. An untouched default is still marked `(default)`. A `data-note` field inside a `data-reply` element is that element's note.
- A `Records` block with no field that has `sum: true` draws no Total row.
- Code blocks wrap on phones, keeping their indentation; wide screens still scroll them.
- `guide.md` and `SKILL.md` say to show every item whole when the reader must judge each one, and to ask the person who asked for the page when the source cannot say what a reader needs.

## v0.11.0

A `Chart` or `Plot` is in the packed page as SVG whenever `pack` can draw it exactly: it shows before the scripts run, with scripts off, and in print. One it cannot (below) appears when the script draws it, as before. One set of `Controls` can drive figures in several sections, and a written `Question` with a model answer inside is a self-check that stays on the page.

### What an author does differently

- Pages keep writing `<Chart option={...} />` and `<Plot option={...} />`, from the page, in an `Explore` or in a client component. `pack` draws each figure three times (a desktop column, half of one, a phone) and the page shows the copy nearest the element's width until the kit script draws it at its own size, without animating over it. Hover values, legends, zoom, `setup` and Explore's frames work as before, on the live chart. New and optional: `height` on `Chart`, `Plot` and `Explore`, the figure's height as a length (`height="clamp(16rem, 34vw, 21rem)"`), which `pack` reads. Size figures with it, not with CSS on `.chart`: the gallery pages moved their `.chart.mix { block-size: ... }` rules into the prop.
- Token colours, `color-mix()` and the tone under the chart stay CSS in the drawing, so it follows light and dark and a page's token overrides with no flash of other colours. Colours ECharts mixes from two of them, as a `visualMap` does, are drawn as those two mixed. Keep palette tokens opaque: `pack` reads a mix only between tokens the option lists together. A chart whose colours `pack` cannot write exactly (a colour function, a token mixed with a literal or translucent colour, `colorAlpha`, `colorLightness`, `colorSaturation`, `colorHue`, a visualMap's `opacity`, a `markArea` beside a translucent colour) is not drawn by `pack`.
- A chart's option functions (formatters) now also run in `pack`. A chart whose functions throw there, because they read the page, is not drawn by `pack` and appears when the script draws it, as before.
- A page rule that may match a figure's element and set its size, padding, border, `all`, `box-sizing` or an animation (or the root font size) leaves that figure to the script, as does a `height` that is not a length in px, rem, vw, vh, `clamp()`, `min()` or `max()`. A Plot's legend that wraps into a different number of rows across the widths a copy is shown at is not drawn either.
- For a layout that changes with the chart's width, write ECharts' `media` queries in the option rather than reading the element's width in a client component: the phone copy follows them, while code that measures the element runs only in the browser.
- A packed page grows by the drawings: about 10 to 20 KB per figure.
- One set of controls can drive several figures and readouts in different sections, with no client component: write `<Controls id="usage" controls={[...]} />` once (the same range, choice and toggle controls as `Explore`), then `<Explore use="usage" label="..." frame={daily} />` in any section after it. Each Explore takes `use` in place of `controls`, shows no row of its own, and keeps everything else (a Plot, a Chart, a readout, stats or a caption; frames `pack` computes or a `"use client"` module exports, `base`, `height`). `frame` gets all the set's values in the order the controls are written, so list the ones most figures read first and let a frame take fewer parameters. The choices are kept across reloads like any control with an id. A `Controls` and its Explores belong in one place: the page outside the Views, or one `View`, or one record of a filled `View` (a reader changes the controls of the place they look at). `pack` fails on a `use` with no `Controls` above it in its place (naming the sets that are), on `use` together with `controls`, on two `Controls` with one id, and on a frame that throws for a combination. Each Explore's precomputed frames still fit 100 KB, so add a control for what changes the figures. Each such figure also shows a quiet line of the chosen values ("7 days · Mac · Breakdown") that links back to the controls, kept in print, and left out on screen when the figure is written right under its own `Controls`; a toggle-only set with every toggle off says so ("Cached off", new label key `off`). `kit Explore` documents it (`kit Controls` prints the same).
- A written `Question` with a model answer inside is a self-check: what the reader writes is kept on the page, stays out of the reply and brings no Reply bar. One with nothing inside still joins the reply. A page that keeps Question answers without a Reply bar gets a Clear answers button at its end once one is saved, which asks before it clears the answers and leaves other controls as the reader set them (new label keys `clearAnswers`, `clearAnswersPrompt`). On a page with a Reply bar, a self-check's answer now brings the bar's Clear too.

## v0.10.0

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
- When Chrome fails to start or stops answering, `check` prints one line naming where it was (the screen, and the `--do` step if one was running) and exits 1 with no report, for example `error: the load event of file:///…/page.html did not come in 10 s (at dark narrow, view #fix/none)`. It used to wait forever.
- A `check` that stops with an error, or is ended by Ctrl-C or SIGTERM, leaves `--out` as it was: the PNGs of a run move there only once it has finished.
- `--tag` takes a name without a path separator; `--tag ../x` is a usage error, since it would write PNGs outside `--out`.
- `--timeout <seconds>` (default 600) limits the whole run, Chrome's start-up included: `error: check passed its 600 s limit at light desktop, view #plan/a, after 324 page(s): raise --timeout for a page with many views or --do steps`.
- Chrome exits with `check` however `check` ends, and its profile and temp files are deleted (also on Ctrl-C or SIGTERM, sent once or twice). Before, every run left a profile of up to 150 MB in the temp directory, and with Google Chrome a `com.google.Chrome.chrome_chrome_url_fetcher_.*` directory, and a `check` killed by a timeout left a Chrome running that used a CPU core.
- Chrome no longer downloads components or models while it checks a page.
- On Linux, a `TMPDIR` too deep for the socket Chrome keeps there (about 50 characters) stops `check` with `error: Chrome cannot start in a temp directory this deep (…): … set TMPDIR to a shorter one, such as /tmp`, instead of Chrome's stack trace.

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
