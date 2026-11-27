/**
 * Regenerates the README's media in `examples/media/` from the packed example pages: the hero clip, cut from several
 * pages, a card of each page's headline and complete opening figure, and animated WebP clips of interactions, each in light and in dark
 * (`<name>-light.webp`, `<name>-dark.webp`) so the README follows the viewer's theme. The gallery index needs none: it
 * draws the pages' own opening figures.
 *
 *   bun run media [--keep] [hero | example ...]    everything, or only the hero or the named examples;
 *                                           --keep leaves the captured frames in a temp directory for inspection
 *
 * Needs Chrome (see CHROME in AGENTS.md) and ffmpeg with libwebp_anim on PATH.
 *
 * Adding an example: add an entry to EXAMPLES in the gallery's order; its page is `examples/<name>/index.html`. Adding a clip: append to that
 * example's `clips`; it is written to `<example>-<clip name>-<theme>.webp`. Actions play in order with a cursor dot; see
 * `Action` in media/types.ts.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { record } from "./media/clip.ts";
import { checkEncoders, encodeCard, encodeClip, sizeOf } from "./media/encode.ts";
import { boxOf, open, screenshot } from "./media/page.ts";
import {
	type Example,
	type Frame,
	type Reel,
	type Size,
	THEMES,
	type Theme,
} from "./media/types.ts";

const VIEWPORT: Size = { width: 1440, height: 900 };
/**
 * The hero's window: GitHub shows a README 830 px wide at most, so a page 900 px wide is read there at nearly its own size
 * rather than shrunk until only the headline survives.
 */
const HERO_SIZE: Size = { width: 900, height: 680 };
/** A card's window: enough width for the opening comparison, cropped below its figure rather than through it. */
const CARD: Size = { width: 600, height: 1000 };
/** A clip over this many bytes fails the run: GitHub is slow to show anything larger and the repository grows with each version. */
const CLIP_LIMIT = 2_000_000;

/** What most clips share; an entry in `clips` may override any of it. */
const CLIP = {
	viewport: VIEWPORT,
	width: 1200,
	fps: 12,
	quality: 75,
} as const;

/**
 * The README's hero: what four pages do under the pointer, cut together. A B-tree lookup steps down the tree, a real data
 * set answers a heatmap and a day picker, the theme picker turns a package treemap over, and a click opens the package.
 * Each scene holds its last state long enough to be read.
 */
const HERO: Reel = {
	name: "hero",
	viewport: HERO_SIZE,
	width: 1320,
	fps: 10,
	quality: 70,
	scenes: [
		{
			page: "btree-index",
			actions: [
				{ do: "wait", ms: 1200 },
				{ do: "click", target: '[data-stepper] [data-go="1"]', hold: 1300 },
				{ do: "click", target: '[data-stepper] [data-go="1"]', travel: 250, hold: 1300 },
				{ do: "click", target: '[data-stepper] [data-go="1"]', travel: 250, hold: 1800 },
			],
		},
		{
			page: "negative-prices",
			scrollTo:
				'section:has(> .chart[aria-label^="Share of hours with a negative price by month"]) > h2',
			actions: [
				{ do: "wait", ms: 2200 },
				{ do: "scroll", to: "#day-controls", ms: 900, hold: 200 },
				{ do: "click", target: 'label:has(> [id="day-3"])', hold: 1400 },
				{ do: "click", target: 'label:has(> [id="day-0"])', hold: 2000 },
			],
		},
		{
			page: "node-modules",
			actions: [
				{ do: "wait", ms: 1200 },
				{
					do: "select",
					target: ".scheme-picker",
					value: { light: "dark", dark: "light" },
					hold: 1600,
				},
				{ do: "click", target: "[data-overview] .chart", at: [0.06, 0.14], hold: 2000 },
			],
		},
	],
};

/** The examples in the gallery's order. Each clip holds its last state long enough to be read before it loops. */
const EXAMPLES: Example[] = [
	{ name: "btree-index", card: true, clips: [] },
	{ name: "negative-prices", card: true, clips: [] },
	{ name: "node-modules", card: true, clips: [] },
	// The map is wider than tall and fits beside its list only on a desktop screen; narrower, the phone copy is drawn.
	{ name: "litestream-tour", card: { window: VIEWPORT }, clips: [] },
	// The opening is the needs and the matrix under them, whose six columns need a wider window than a card's.
	{
		name: "saas-database",
		card: { window: { width: 1100, height: 1000 }, until: "[data-overview] table.compare" },
		clips: [],
	},
	{ name: "battery", card: true, clips: [] },
	{
		name: "i2c-pull-ups",
		card: true,
		clips: [
			{
				...CLIP,
				name: "values",
				scrollTo: "section:has(#r-0)",
				region: { selector: "section:has(#r-0)", pad: 4 },
				actions: [
					{ do: "wait", ms: 600 },
					{ do: "click", target: "label:has(#r-14)", hold: 1500 },
					{ do: "click", target: "label:has(#r-0)", hold: 1500 },
					{ do: "click", target: "label:has(#r-6)", hold: 1500 },
				],
			},
		],
	},
	{
		name: "fourier-series",
		card: true,
		clips: [
			{
				...CLIP,
				name: "terms",
				scrollTo: "section:has(#k)",
				region: { selector: "section:has(#k)", pad: 4 },
				actions: [
					{ do: "wait", ms: 600 },
					{ do: "drag", selector: "#k", values: [1, 9], ms: 1400 },
					{ do: "drag", selector: "#k", values: [9, 200], ms: 2600, travel: 300, hold: 1500 },
				],
			},
		],
	},
	{
		name: "echarts-compressed",
		card: true,
		clips: [
			{
				...CLIP,
				name: "linked",
				viewport: { width: 1440, height: 1100 },
				scrollTo: "section:has(> .mermaid)",
				region: { selector: "section:has(> .mermaid)", pad: 4 },
				actions: [
					{ do: "wait", ms: 600 },
					{ do: "hover", target: 'section:has(> .mermaid) p [data-ref="atob"]', hold: 1300 },
					{ do: "hover", target: 'section:has(> .mermaid) p [data-ref="inflate"]', hold: 1300 },
					{ do: "hover", target: 'section:has(> .mermaid) p [data-ref="run"]', hold: 1500 },
				],
			},
		],
	},
	{ name: "electricity-mix", card: true, clips: [] },
	{ name: "dijkstra", card: true, clips: [] },
];

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "examples/media");

/** Output files with their sizes, in the order written; `clip` marks the ones held to `CLIP_LIMIT`. */
const written: Array<{ file: string; bytes: number; clip: boolean }> = [];

function note(file: string, clip = false) {
	written.push({ file: file.replace(`${ROOT}/`, ""), bytes: sizeOf(file), clip });
}

const pageUrl = (name: string) => `file://${join(ROOT, "examples", name, "index.html")}`;

/** Writes each card in `theme`, from the page's top to the end of its opening figure. */
async function cards(examples: Example[], theme: Theme, work: string) {
	const shown = examples.filter((example) => example.card);
	if (shown.length === 0) {
		return;
	}
	await withPage(async (cdp) => {
		for (const example of shown) {
			const png = join(work, `${example.name}-card-${theme}.png`);
			const { window = CARD, until = "[data-overview] :is(.fig, .chart, .mermaid)" } =
				typeof example.card === "object" ? example.card : {};
			await open(cdp, pageUrl(example.name), window, theme, true);
			const figure = await boxOf(cdp, until);
			const height = Math.ceil(figure.y + figure.height + 16);
			if (height > window.height) {
				throw new Error(
					`${example.name}: opening figure ends below the ${window.height}px card window`,
				);
			}
			await screenshot(cdp, png, { x: 0, y: 0, width: window.width, height });
			const out = join(OUT, `${example.name}-card-${theme}.webp`);
			await encodeCard(png, out);
			note(out);
		}
	});
}

/** Records and encodes every clip of `example` in `theme`, each in a Chrome of its own because its page time is paused. */
async function clips(example: Example, theme: Theme, work: string) {
	for (const clip of example.clips) {
		const name = `${example.name}-${clip.name}-${theme}`;
		const dir = join(work, name);
		const frames = await withPage(async (cdp) => {
			await open(cdp, pageUrl(example.name) + (clip.hash ?? ""), clip.viewport, theme, false);
			return await record(cdp, clip, dir, theme);
		});
		const out = join(OUT, `${name}.webp`);
		await encodeClip(frames, 1000 / clip.fps, clip.quality, out);
		note(out, true);
		console.log(`${name}: ${frames.length} frames`);
	}
}

/** Records the hero's scenes in `theme`, each page in a Chrome of its own, and encodes them as one clip, cut in order. */
async function hero(theme: Theme, work: string) {
	const frames: Frame[] = [];
	for (const [i, scene] of HERO.scenes.entries()) {
		const dir = join(work, `${HERO.name}-${theme}-${i}`);
		const shot = await withPage(async (cdp) => {
			await open(cdp, pageUrl(scene.page) + (scene.hash ?? ""), HERO.viewport, theme, false);
			return await record(
				cdp,
				{ ...HERO, ...(scene.scrollTo && { scrollTo: scene.scrollTo }), actions: scene.actions },
				dir,
				theme,
			);
		});
		const last = frames.at(-1);
		const offset = last ? last.at + 1000 / HERO.fps : 0;
		frames.push(...shot.map((frame) => ({ file: frame.file, at: frame.at + offset })));
	}
	const out = join(OUT, `${HERO.name}-${theme}.webp`);
	await encodeClip(frames, 1000 / HERO.fps, HERO.quality, out);
	note(out, true);
	console.log(`${HERO.name}-${theme}: ${frames.length} frames`);
}

async function main(args: string[]) {
	const keep = args.includes("--keep");
	const names = args.filter((a) => a !== "--keep");
	const examples = names.length ? EXAMPLES.filter((e) => names.includes(e.name)) : EXAMPLES;
	const withHero = names.length === 0 || names.includes(HERO.name);
	if (examples.length === 0 && !withHero) {
		throw new Error(
			`no example named ${names.join(", ")}; known: ${HERO.name}, ${EXAMPLES.map((e) => e.name).join(", ")}`,
		);
	}
	await checkEncoders();
	if (names.length === 0) {
		// A full run owns the directory: files from renamed or removed scenes go, so none is published stale.
		rmSync(OUT, { recursive: true, force: true });
	}
	mkdirSync(OUT, { recursive: true });
	const work = mkdtempSync(join(tmpdir(), "explainer-media-"));
	try {
		for (const theme of THEMES) {
			if (withHero) {
				await hero(theme, work);
			}
			await cards(examples, theme, work);
			for (const example of examples) {
				await clips(example, theme, work);
			}
		}
	} finally {
		if (keep) {
			console.log(`frames and cards kept in ${work}`);
		} else {
			rmSync(work, { recursive: true, force: true });
		}
	}
	for (const { file, bytes } of written) {
		console.log(`${(bytes / 1024).toFixed(0).padStart(6)} KB  ${file}`);
	}
	const heavy = written.filter(({ clip, bytes }) => clip && bytes > CLIP_LIMIT);
	if (heavy.length) {
		throw new Error(`over ${CLIP_LIMIT} bytes: ${heavy.map((h) => h.file).join(", ")}`);
	}
}

await main(process.argv.slice(2));
