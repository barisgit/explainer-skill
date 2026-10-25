/* page: how an .mdx page is written. It imports the kit's components from "kit": import { Chart, View } from "kit".
   Frontmatter: title (default: the text of the #), lang (default en), labels (the kit's own texts, English unless set: kit labels
   prints them all to translate and paste here; pack warns when lang is not English and they are missing), reply: true (the
   reader's notes on a page without a Question or data-reply), scheme: light or dark (forces it; else the page follows the system).
   The # and the paragraphs right under it are the masthead, the first one its lede. Each ## starts a section; to give one its
   short name in the contents rail, write its heading as <h2 data-nav="Price">The price is 40 €</h2>. A <section> you write
   yourself (class="band", say) is kept as written. A Markdown table is a table.compare: its first column names the rows, a
   right-aligned column (---:) is numeric (class="num"), and on phones each row stacks its cells under the column names.
   Data and styles are imported files: import plan from "./plan.json", import { rows } from "./data.ts", import "./page.css".
   Your own components live in .tsx files next to the page; they import kit components from "kit" and hooks from "preact/hooks".
   To typecheck the page's own .ts and .tsx files, run kit types > tsconfig.json beside the page, then bun check (no install).
   pack renders every component to static HTML; a module whose first line is "use client" is also hydrated in the browser, so its
   state and handlers work. Props from the page into such a component must be JSON, or functions a "use client" module exports
   (a formatter, Explore's frame). Markdown written between its tags is its children, rendered once as static HTML that it
   places with {children}, so a section's prose stays in the page; a ## first in them starts the section the component is in.
   A control with an id keeps its value across
   reloads (kit keep); in such a component, set its state in onInput or onChange, which the restore and Clear fire too. */
export { Chart } from "./chart.tsx";
export { Explore } from "./explore.tsx";
export { Plot } from "./plot.tsx";
export { Question } from "./question.tsx";
export { Stepper } from "./stepper.tsx";
export { Table } from "./table.tsx";
export { Tree, type TreeItem, type TreeRow } from "./tree.tsx";
export { View } from "./view.tsx";
