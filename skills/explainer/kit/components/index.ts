/* components: the kit's Preact components for .mdx pages: import { Chart } from "kit". Each renders the markup the kit scripts read.
   Chart   an ECharts chart that follows light and dark
   View    a drill-down view at #name or #name/param, with Back, breadcrumbs, previous/next and a contents rail
   Tree    hierarchical records as rows with their numbers in aligned columns, opened level by level
   Question a question the reader answers in the reply
   Each ## starts a section; to give one its short name in the contents rail (data-nav), write its heading as
   <h2 data-nav="Price">The price is 40 €</h2>. A Markdown table is a table.compare: its first column names the rows, and on
   phones each row stacks its cells under the column names.
   Your own components live in .tsx files next to the page. pack renders every component to static HTML; a module whose first
   line is "use client" is also hydrated in the browser, so its state and handlers work. Props from the page into such a component
   must be JSON. */
export { Chart } from "./chart.tsx";
export { Question } from "./question.tsx";
export { Tree } from "./tree.tsx";
export { View } from "./view.tsx";
