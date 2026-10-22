/**
 * Regenerates the README and gallery media in `examples/media/` from the packed example pages:
 * a gallery thumbnail of each first screen, a hero collage of them, and animated WebP clips of interactions.
 *
 *   bun run media [--keep] [example ...]    all examples, or only the named ones (the hero needs all of them);
 *                                           --keep leaves the captured frames in a temp directory for inspection
 *
 * Needs Chrome (see CHROME in AGENTS.md) and ffmpeg with libwebp_anim on PATH.
 *
 * Adding an example: append an entry to EXAMPLES; its page is `examples/<name>/index.html` and it gets a thumbnail
 * and a place in the hero. Adding a clip: append to that example's `clips`; it is written to `<example>-<clip name>.webp`.
 * Actions play in order with a cursor dot; see `Action` in media/types.ts.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withPage } from "../skills/explainer/src/chrome.ts";
import { record } from "./media/clip.ts";
import { encodeClip, encodeStill, encodeThumb, sizeOf } from "./media/encode.ts";
import { CROP, renderHero, tileTheme } from "./media/hero.ts";
import { open, screenshot } from "./media/page.ts";
import type { Example, Size } from "./media/types.ts";

const STILL_VIEWPORT: Size = { width: 1440, height: 900 };
/** Gallery thumbnail width in image pixels: a two-column card at the gallery's 1056 px column, at 2x. */
const THUMB_WIDTH = 1040;
/** A clip over this many bytes fails the run: GitHub is slow to show anything larger and the repository grows with each version. */
const CLIP_LIMIT = 2_000_000;

/** What most clips share; an entry in `clips` may override any of it. */
const CLIP = {
	theme: "light",
	viewport: STILL_VIEWPORT,
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
				theme: "dark",
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

/** Output files with their sizes, in the order written. */
const written: Array<{ file: string; bytes: number }> = [];

function note(file: string) {
	written.push({ file: file.replace(`${ROOT}/`, ""), bytes: sizeOf(file) });
}

const pageUrl = (example: Example) =>
	`file://${join(ROOT, "examples", example.name, "index.html")}`;

/**
 * Screenshots the first screen of every example in its hero theme and writes the gallery thumbnail from it; returns
 * the PNGs, in `examples` order, that the hero is built from.
 */
async function stills(examples: Example[], work: string): Promise<string[]> {
	const pngs: string[] = [];
	await withPage(async (cdp) => {
		await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
		for (const example of examples) {
			const png = join(work, `${example.name}.png`);
			await open(cdp, pageUrl(example), STILL_VIEWPORT, tileTheme(EXAMPLES.indexOf(example)), true);
			await screenshot(cdp, png);
			const thumb = join(OUT, `${example.name}-thumb.webp`);
			await encodeThumb(png, CROP, THUMB_WIDTH, thumb);
			note(thumb);
			pngs.push(png);
		}
	});
	return pngs;
}

/** Records and encodes every clip of `example`, each in a Chrome of its own because its page time is paused. */
async function clips(example: Example, work: string) {
	for (const clip of example.clips) {
		const dir = join(work, `${example.name}-${clip.name}`);
		const frames = await withPage(async (cdp) => {
			await Promise.all(["Page", "Runtime"].map((domain) => cdp.send(`${domain}.enable`)));
			await open(cdp, pageUrl(example) + (clip.hash ?? ""), clip.viewport, clip.theme, false);
			return await record(cdp, clip, dir);
		});
		const out = join(OUT, `${example.name}-${clip.name}.webp`);
		await encodeClip(frames, 1000 / clip.fps, clip.quality, out);
		note(out);
		console.log(`${clip.name}: ${frames.length} frames`);
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
	mkdirSync(OUT, { recursive: true });
	const work = mkdtempSync(join(tmpdir(), "explainer-media-"));
	try {
		const tiles = await stills(examples, work);
		for (const example of examples) {
			await clips(example, work);
		}
		if (examples.length === EXAMPLES.length) {
			await withPage(async (cdp) => {
				await cdp.send("Page.enable");
				const hero = join(work, "hero.png");
				await renderHero(cdp, tiles, STILL_VIEWPORT, work, hero);
				note(await encodeStill(hero, join(OUT, "hero")));
			});
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
	const heavy = written.filter(
		({ file, bytes }) => file.includes("-") && file.endsWith(".webp") && bytes > CLIP_LIMIT,
	);
	if (heavy.length) {
		throw new Error(`over ${CLIP_LIMIT} bytes: ${heavy.map((h) => h.file).join(", ")}`);
	}
}

await main(process.argv.slice(2));
