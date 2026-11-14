/* page: how an .mdx page is written. It imports the kit's components from "kit": import { Chart, View } from "kit".
   Frontmatter: title (default: the text of the #), lang (default en), labels (the kit's own texts, English unless set: kit labels
   prints them all to translate and paste here; pack warns when lang is not English and they are missing), reply: true (the
   reader's notes on a page without a reply Question or data-reply), scheme: light or dark (forces it; else the page follows the system).
   The # and the paragraphs right under it are the masthead, the first one its lede. One that opens with a bold label is the
   reader's next action, set prominently under the lede: **Start:** change one bit (2 minutes). Each ## starts a section; to give one its
   short name in the contents rail, write its heading as <h2 data-nav="Price">The price is 40 €</h2>; four or more such
   sections give a page the rail even without views, so a short page names fewer. A <section> you write
   yourself (class="band", say) is kept as written. A Markdown table is a table.compare: its first column names the rows, a
   right-aligned column (---:) is numeric (class="num"), and on phones each row stacks its cells under the column names.
   Markdown link destinations with spaces use angle brackets, [design](<docs/My Design Doc.md>), or %20. pack and check warn
   when link syntax stays literal outside code; use backticks or <code> for intentional examples. check treats missing #targets
   as problems and missing relative files as warnings: distribute those files beside the exported HTML. External links are not fetched.
   Data and styles are imported files: import plan from "./plan.json", import { rows } from "./data.ts", import "./page.css".
   An imported image or font is a data: URL pack embeds: import icon from "./icon.svg", then <img src={icon} />. Client code must
   import the files it shows: pack fails on a file path written in it, in its props or in a filled view's records, since the
   browser would load that file later, from beside the page. An SVG file a client component draws keeps its own colours in dark.
   Your own components live in .tsx files next to the page; they import kit components from "kit" and hooks from "preact/hooks".
   To typecheck the page's own .ts and .tsx files, run kit types > tsconfig.json beside the page, then bun --check (no install).
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
