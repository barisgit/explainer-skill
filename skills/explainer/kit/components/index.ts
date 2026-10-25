/* components: the kit's Preact components for .mdx pages: import { Chart, View } from "kit". Each renders the markup the kit scripts read.
   Frontmatter: title (default: the text of the #), lang (default en), labels (the kit's own texts, English unless set: kit labels
   prints them all to translate and paste here), reply: true (notes and kept inputs on a page without a Question or data-reply).
   The # and the paragraphs right under it are the masthead, the first one its lede. Each ## starts a section; to give one its
   short name in the contents rail, write its heading as <h2 data-nav="Price">The price is 40 €</h2>. A <section> you write
   yourself (class="band", say) is kept as written. A Markdown table is a table.compare: its first column names the rows, a
   right-aligned column (---:) is numeric (class="num"), and on phones each row stacks its cells under the column names.
   Data and styles are imported files: import plan from "./plan.json", import { rows } from "./data.ts", import "./page.css".
   Your own components live in .tsx files next to the page; they import kit components from "kit" and hooks from "preact/hooks".
   To typecheck them: bun /path/to/explainer/cli.ts kit types > tsconfig.json, then bun check (Bun only, no install).
   pack renders every component to static HTML; a module whose first line is "use client" is also hydrated in the browser, so its
   state and handlers work. Props from the page into such a component must be JSON. A control such a component renders from its
   state is kept across reloads like any other (kit reply.js): give it an id and set the state in onInput or onChange, which the
   restore and Clear fire too. */
export { Chart } from "./chart.tsx";
export { Plot } from "./plot.tsx";
export { Question } from "./question.tsx";
export { Stepper } from "./stepper.tsx";
export { Tree } from "./tree.tsx";
export { View } from "./view.tsx";
