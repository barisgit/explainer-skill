/**
 * Regenerates the README and gallery media in `examples/media/` from the packed example pages:
 * a gallery thumbnail of each first screen, a hero collage of them, and animated WebP clips of interactions, each in
 * light and in dark (`<name>-light.webp`, `<name>-dark.webp`) so the README and the gallery can follow the viewer's theme.
 *
 *   bun run media [--keep] [example ...]    all examples, or only the named ones (the hero needs all of them);
 *                                           --keep leaves the captured frames in a temp directory for inspection
 *
 * Needs Chrome (see CHROME in AGENTS.md) and ffmpeg with libwebp_anim on PATH.
 *
 * Adding an example: append an entry to EXAMPLES; its page is `examples/<name>/index.html` and it gets a thumbnail
 * and a place in the hero. Adding a clip: append to that example's `clips`; it is written to `<example>-<clip name>-<theme>.webp`.
 * Actions play in order with a cursor dot; see `Action` in media/types.ts.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { record } from "./media/clip.ts";
import { encodeClip, encodeHero, encodeThumb, sizeOf } from "./media/encode.ts";
import { renderHero } from "./media/hero.ts";
import { open, screenshot } from "./media/page.ts";
import { type Example, type Size, THEMES, type Theme } from "./media/types.ts";

const VIEWPORT: Size = { width: 1440, height: 900 };
/**
 * The window of the first screens the thumbnails and the hero show: the pages' 1056 px column with a narrow margin, so the
 * type is larger than at 1440 wide, and the whole of the reply strip with its button at the window's right edge, which a
 * crop of a wider window would cut off.
 */
const STILL: Size = { width: 1120, height: 840 };
/** Gallery thumbnail width in image pixels: a two-column card at the gallery's 1056 px column, at 2x. */
const THUMB_WIDTH = 1040;
/** A clip over this many bytes fails the run: GitHub is slow to show anything larger and the repository grows with each version. */
const CLIP_LIMIT = 2_000_000;

/** What most clips share; an entry in `clips` may override any of it. */
const CLIP = {
	viewport: VIEWPORT,
	width: 1200,
	fps: 12,
	quality: 75,
} as const;

const EXAMPLES: Example[] = [
	{
		name: "fourier-series",
		clips: [
			{
				...CLIP,
				name: "terms",
				scrollTo: ".fig",
				region: { selector: ".fig", pad: 4 },
				actions: [
					{ do: "wait", ms: 400 },
					{ do: "click", target: "label.toggle" },
					{ do: "drag", selector: "#terms", values: [3, 9], ms: 1400 },
					{ do: "click", target: "label.toggle" },
					{ do: "drag", selector: "#terms", values: [9, 40], ms: 2200, travel: 500 },
					{ do: "wait", ms: 1000 },
					{ do: "drag", selector: "#terms", values: [40, 3], ms: 1200, travel: 200 },
					{ do: "wait", ms: 500 },
				],
			},
		],
	},
	{
		name: "dijkstra",
		clips: [
			{
				...CLIP,
				name: "steps",
				scrollTo: "#main",
				region: { selector: "#main", pad: 4, height: 760 },
				actions: [
					{ do: "wait", ms: 400 },
					{ do: "click", target: "label:has(input[name=graph][value=grid])" },
					{ do: "click", target: "label:has(input[name=start][value=E])" },
					{ do: "click", target: '#main [data-go="1"]', hold: 800 },
					{ do: "click", target: '#main [data-go="1"]', travel: 100, hold: 800 },
					{ do: "click", target: '#main [data-go="1"]', travel: 100, hold: 800 },
					{ do: "click", target: '#main [data-go="1"]', travel: 100, hold: 800 },
					{ do: "click", target: '#main [data-go="1"]', travel: 100, hold: 800 },
					{ do: "click", target: '#main [data-go="1"]', travel: 100, hold: 1200 },
				],
			},
		],
	},
	{
		name: "electricity-mix",
		clips: [
			{
				...CLIP,
				name: "coal-ranking",
				scrollTo: ".fig:has(#rank)",
				region: { x: 160, y: 0, width: 1120, height: 700 },
				actions: [
					{ do: "wait", ms: 400 },
					{ do: "click", target: "label:has(input[name=metric][value=twh])", hold: 1800 },
					{ do: "click", target: { bar: { chart: "#rank", index: 0 } }, hold: 2200 },
					{ do: "click", target: "[data-view=place] .back", hold: 1200 },
				],
			},
		],
	},
	{
		name: "password-hashing",
		clips: [
			{
				...CLIP,
				name: "presets",
				scrollTo: ".fig",
				region: { selector: ".fig", pad: 4, height: 700 },
				actions: [
					{ do: "wait", ms: 400 },
					{ do: "click", target: "[data-preset=tiny]", hold: 1500 },
					{ do: "click", target: "[data-preset=fips]", hold: 1500 },
					{ do: "click", target: "[data-preset=noargon]", hold: 1500 },
					{ do: "click", target: "[data-preset=small]", hold: 1200 },
				],
			},
		],
	},
];

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "examples/media");

/** Output files with their sizes, in the order written; `clip` marks the ones held to `CLIP_LIMIT`. */
const written: Array<{ file: string; bytes: number; clip: boolean }> = [];

function note(file: string, clip = false) {
	written.push({ file: file.replace(`${ROOT}/`, ""), bytes: sizeOf(file), clip });
}

const pageUrl = (example: Example) =>
	`file://${join(ROOT, "examples", example.name, "index.html")}`;

/**
 * Screenshots the first screen of every example in `theme` and writes its gallery thumbnail; returns the PNGs, in
 * `examples` order, that the hero of that theme is built from.
 */
async function stills(examples: Example[], theme: Theme, work: string): Promise<string[]> {
	const pngs: string[] = [];
	await withPage(async (cdp) => {
		for (const example of examples) {
			const png = join(work, `${example.name}-${theme}.png`);
			await open(cdp, pageUrl(example), STILL, theme, true);
			await screenshot(cdp, png);
			const thumb = join(OUT, `${example.name}-thumb-${theme}.webp`);
			await encodeThumb(png, THUMB_WIDTH, thumb);
			note(thumb);
			pngs.push(png);
		}
	});
	return pngs;
}

/** Writes the hero collage of the `tiles` PNGs, all of one theme. */
async function hero(tiles: string[], theme: Theme, work: string) {
	const png = join(work, `hero-${theme}.png`);
	const out = join(OUT, `hero-${theme}.webp`);
	await withPage((cdp) => renderHero(cdp, tiles, STILL, work, png));
	await encodeHero(png, out);
	note(out);
}

/** Records and encodes every clip of `example` in `theme`, each in a Chrome of its own because its page time is paused. */
async function clips(example: Example, theme: Theme, work: string) {
	for (const clip of example.clips) {
		const name = `${example.name}-${clip.name}-${theme}`;
		const dir = join(work, name);
		const frames = await withPage(async (cdp) => {
			await open(cdp, pageUrl(example) + (clip.hash ?? ""), clip.viewport, theme, false);
			return await record(cdp, clip, dir);
		});
		const out = join(OUT, `${name}.webp`);
		await encodeClip(frames, 1000 / clip.fps, clip.quality, out);
		note(out, true);
		console.log(`${name}: ${frames.length} frames`);
	}
}

async function main(args: string[]) {
	const keep = args.includes("--keep");
	const names = args.filter((a) => a !== "--keep");
	const examples = names.length ? EXAMPLES.filter((e) => names.includes(e.name)) : EXAMPLES;
	if (examples.length === 0) {
		throw new Error(
			`no example named ${names.join(", ")}; known: ${EXAMPLES.map((e) => e.name).join(", ")}`,
		);
	}
	if (examples.length === EXAMPLES.length) {
		// A full run owns the directory: files from renamed or removed scenes go, so none is published stale.
		rmSync(OUT, { recursive: true, force: true });
	}
	mkdirSync(OUT, { recursive: true });
	const work = mkdtempSync(join(tmpdir(), "explainer-media-"));
	try {
		for (const theme of THEMES) {
			const tiles = await stills(examples, theme, work);
			for (const example of examples) {
				await clips(example, theme, work);
			}
			if (examples.length === EXAMPLES.length) {
				await hero(tiles, theme, work);
			}
		}
	} finally {
		if (keep) {
			console.log(`frames and stills kept in ${work}`);
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
