"use client";
/* Explore without a figure (see ../explore.tsx): controls switching a readout, stats or caption, with no plot or chart code. */
import { type ExploreData, ExploreView } from "./explore-view.tsx";

export function Explore(data: ExploreData) {
	return <ExploreView data={data} />;
}
