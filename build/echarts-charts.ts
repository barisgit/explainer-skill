/**
 * The charts and components both ECharts bundles register (`bun run vendor`): kit/echarts.js, which draws in the browser, and
 * vendor/echarts-ssr.js, which pack draws each chart into the page with. Only those listed here ship; to offer another one,
 * import and register it here, then rebuild. Each entry adds its renderer.
 */
import {
	BarChart,
	BoxplotChart,
	CustomChart,
	HeatmapChart,
	LineChart,
	PieChart,
	RadarChart,
	SankeyChart,
	ScatterChart,
	SunburstChart,
	TreemapChart,
} from "echarts/charts";
import {
	AriaComponent,
	AxisPointerComponent,
	BrushComponent,
	CalendarComponent,
	DatasetComponent,
	DataZoomComponent,
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	MarkPointComponent,
	PolarComponent,
	RadarComponent,
	TitleComponent,
	ToolboxComponent,
	TooltipComponent,
	TransformComponent,
	VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout, UniversalTransition } from "echarts/features";

/** The series names and their installers: registration, bundle docs and pack validation all derive from this registry. */
const charts = {
	line: LineChart,
	bar: BarChart,
	scatter: ScatterChart,
	pie: PieChart,
	heatmap: HeatmapChart,
	treemap: TreemapChart,
	sankey: SankeyChart,
	sunburst: SunburstChart,
	radar: RadarChart,
	boxplot: BoxplotChart,
	custom: CustomChart,
};

/** Shipped in the SSR bundle so an installed pack validates without the build sources or dev dependencies. */
export const seriesTypes = Object.keys(charts);

echarts.use([
	...Object.values(charts),
	AriaComponent,
	AxisPointerComponent,
	BrushComponent,
	CalendarComponent,
	DataZoomComponent,
	DatasetComponent,
	GridComponent,
	LegendComponent,
	MarkAreaComponent,
	MarkLineComponent,
	MarkPointComponent,
	PolarComponent,
	RadarComponent,
	TitleComponent,
	ToolboxComponent,
	TooltipComponent,
	TransformComponent,
	VisualMapComponent,
	LabelLayout,
	UniversalTransition,
]);

export { echarts };
