/**
 * Regenerates the README's media in `examples/media/` from the packed example pages: the hero clip, a card of each other
 * page's headline and complete opening figure, and animated WebP clips of interactions, each in light and in dark
 * (`<name>-light.webp`, `<name>-dark.webp`) so the README follows the viewer's theme. The gallery index needs none: it
 * draws the pages' own opening figures.
 *
 *   bun run media [--keep] [example ...]    all examples, or only the named ones;
 *                                           --keep leaves the captured frames in a temp directory for inspection
 *
 * Needs Chrome (see CHROME in AGENTS.md) and ffmpeg with libwebp_anim on PATH.
 *
 * Adding an example: append an entry to EXAMPLES; its page is `examples/<name>/index.html`. Adding a clip: append to that
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
import { type Example, type Size, THEMES, type Theme } from "./media/types.ts";

const VIEWPORT: Size = { width: 1440, height: 900 };
/**
 * The hero's window: GitHub shows a README 830 px wide at most, so a page 900 px wide is read there at nearly its own size
 * rather than shrunk until only the headline survives.
 */
const HERO: Size = { width: 900, height: 620 };
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

/** The examples in the gallery's order. Each clip holds its last state long enough to be read before it loops. */
const EXAMPLES: Example[] = [
	{
		name: "battery",
		card: false,
		clips: [
			{
				// The README's hero: the finding, the figure a reader moves, and the decision sent back as a reply.
				name: "hero",
				viewport: HERO,
				width: 1320,
				fps: 10,
				quality: 70,
				actions: [
					{ do: "wait", ms: 2200 },
					{ do: "scroll", to: "section:has(#battery)", ms: 900, hold: 500 },
					{ do: "drag", selector: "#battery", values: [5, 10, 15], ms: 1300, hold: 1400 },
					{ do: "scroll", to: "section:has(> fieldset[data-reply])", ms: 900, hold: 300 },
					{ do: "click", target: "label:has(#size-5_20_kWh)", hold: 700 },
					{ do: "click", target: ".reply-bar .btn.primary", hold: 2400 },
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
	{ name: "electricity-mix", card: true, clips: [] },
	{ name: "node-modules", card: true, clips: [] },
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
	{ name: "dijkstra", card: true, clips: [] },
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

/** Writes each card in `theme`, from the page's top to the end of its opening figure. */
async function cards(examples: Example[], theme: Theme, work: string) {
	const shown = examples.filter((example) => example.card);
	if (shown.length === 0) {
		return;
	}
	await withPage(async (cdp) => {
		for (const example of shown) {
			const png = join(work, `${example.name}-card-${theme}.png`);
			await open(cdp, pageUrl(example), CARD, theme, true);
			const figure = await boxOf(cdp, "[data-overview] :is(.fig, .chart)");
			const height = Math.ceil(figure.y + figure.height + 8);
			if (height > CARD.height) {
				throw new Error(
					`${example.name}: opening figure ends below the ${CARD.height}px card window`,
				);
			}
			await screenshot(cdp, png, { x: 0, y: 0, width: CARD.width, height });
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
	await checkEncoders();
	if (examples.length === EXAMPLES.length) {
		// A full run owns the directory: files from renamed or removed scenes go, so none is published stale.
		rmSync(OUT, { recursive: true, force: true });
	}
	mkdirSync(OUT, { recursive: true });
	const work = mkdtempSync(join(tmpdir(), "explainer-media-"));
	try {
		for (const theme of THEMES) {
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
