/* page: how an .mdx page is written. It imports the kit's components from "kit": import { Chart, View } from "kit".
   Frontmatter: title (default: the text of the #), lang (default en), labels (the kit's own texts, English unless set: kit labels
   prints them all to translate and paste here; pack warns when lang is not English and they are missing), reply: true (the
   reader's notes on a page without a reply Question or data-reply), replyTo (the URL serve prints, so a copy opened from a file or
   an email sends its reply back), contents: true (the contents rail of the page's sections, for
   a long page; views inside views get it anyway), scheme: light or dark (forces it; else the page follows the system),
   display: condensed (poster capitals for the # and ##: kit display).
   The # and the paragraph right under it are the masthead: the headline states the finding, the lede what it rests on. Each ##
   starts a section; to give one a short name in the contents rail, write its heading as
   <h2 data-nav="Price">The price is 40 €</h2>. A ### in a section is a topic indented under it in the rail (data-nav works there
   too), so a long page groups its rail by ## chapters. A <section> you write
   yourself (class="band", say) is kept as written. A Markdown table is a table.compare: its first column names the rows, a
   right-aligned column (---:) is numeric (class="num"), and on a phone that it does not fit it scrolls sideways, its first column
   staying in view.
   Computed destinations use <a href={...}>; braces in Markdown destinations fail pack. Destinations with spaces use angle brackets, [design](<docs/My Design Doc.md>), or %20. pack and check warn
   when link syntax stays literal outside code; use backticks or <code> for intentional examples. check treats missing #targets
   as problems and missing relative files as warnings: distribute those files beside the exported HTML. External links are not fetched.
   Data and styles are imported files: import plan from "./plan.json", import { rows } from "./data.ts", import "./page.css".
   An imported image or font is a data: URL pack embeds: import icon from "./icon.svg", then <img src={icon} />. Client code must
   import the files it shows: pack fails on a file path written in it, in its props or in a filled view's records, since the
   browser would load that file later, from beside the page. An SVG file a client component draws keeps its own colours in dark.
   Your own components live in .tsx files next to the page; they import kit components from "kit" and hooks from "preact/hooks".
   To typecheck the page's own .ts and .tsx files, run kit types > tsconfig.json beside the page, then bun --check (no install); the first command only prepares the config, the second reports type errors or success. MDX expressions are not typechecked.
   pack renders every component to static HTML; a module whose first line is "use client" is also hydrated in the browser, so its
   state and handlers work. Props from the page into such a component must be JSON, or functions a "use client" module exports
   (a formatter, Explore's frame). Markdown written between its tags is its children, rendered once as static HTML that it
   places with {children} exactly once, so a section's prose stays in the page; a ## first in them starts the section the
   component is in. Chart and Plot may sit in them; your own client components go inside the component instead.
   A control with an id keeps its value across reloads (kit keep); in such a component, set its state in onInput or onChange
   with a functional update (setState((s) => ...)), which the restore and Clear fire too. */
export { Chart } from "./chart.tsx";
export { Controls, Explore } from "./explore.tsx";
export { Plot } from "./plot.tsx";
export { Question } from "./question.tsx";
export { Records, type RecordsProps } from "./records.tsx";
export { Stepper } from "./stepper.tsx";
export { Table } from "./table.tsx";
export { View } from "./view.tsx";
