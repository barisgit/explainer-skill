/* components: the kit's Preact components for .mdx pages: import { Chart } from "kit". Each renders the markup the kit scripts read.
   Chart   an ECharts chart that follows light and dark
   View    a drill-down view at #name or #name/param, with Back, breadcrumbs, previous/next and a contents rail
   Your own components live in .tsx files next to the page. pack renders every component to static HTML; a module whose first
   line is "use client" is also hydrated in the browser, so its state and handlers work. Props from the page into such a component
   must be JSON. */
export { Chart } from "./chart.tsx";
export { View } from "./view.tsx";
