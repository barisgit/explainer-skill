"use client";
/* Explore with a Chart (see ../explore.tsx): its own client module, so only a page whose Explore draws a Chart carries ECharts. */
import { Chart } from "../chart.tsx";
import { type ExploreData, ExploreView } from "./explore-view.tsx";

export function Explore(data: ExploreData) {
	return (
		<ExploreView
			data={data}
			figure={(option) => (
				<Chart
					option={option as ChartOption}
					label={data.label}
					{...(data.class ? { class: data.class } : {})}
					{...(data.height ? { height: data.height } : {})}
				/>
			)}
		/>
	);
}
