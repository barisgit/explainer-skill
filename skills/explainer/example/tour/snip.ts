/* Snip, a fictional link shortener: the measured numbers its tour draws. page.mdx imports them when it packs. */

/** Median milliseconds a redirect spends in each api stage, by whether the cache held the link. */
export const redirect = {
	stages: ["Rate limit", "Look up", "Queue click", "Respond"],
	hit: [0.3, 1.2, 0.2, 0.4],
	miss: [0.3, 9.8, 0.2, 0.4],
};

/** Share of redirects the Redis cache answers, against how many links it holds (thousands). */
export const hitRate: [number, number][] = [
	[10, 0.61],
	[25, 0.78],
	[50, 0.88],
	[100, 0.94],
	[200, 0.97],
	[400, 0.98],
];

/** Clicks the stats worker writes per batch, by hour of a weekday. */
export const batches = {
	hours: ["00", "04", "08", "12", "16", "20"],
	clicks: [40, 15, 310, 520, 460, 280],
};
