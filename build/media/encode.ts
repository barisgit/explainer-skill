import { copyFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { SCALE } from "./page.ts";
import type { Rect } from "./types.ts";

/** Runs ffmpeg quietly and throws with its message when it fails. */
async function ffmpeg(args: string[]) {
	const proc = Bun.spawn(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", ...args], {
		stderr: "pipe",
	});
	const [log, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) {
		throw new Error(`ffmpeg ${args.join(" ")} failed:\n${log}`);
	}
}

export const sizeOf = (file: string) => statSync(file).size;

/**
 * Encodes frames as a looping animated WebP, each frame lasting until the next was captured (the last for `lastMs`). The
 * frames are already the size they are shown at. The `text` preset keeps edges of small type clean.
 */
export async function encodeClip(
	frames: Array<{ file: string; at: number }>,
	lastMs: number,
	quality: number,
	out: string,
) {
	const list = frames
		.map(
			(f, i) =>
				`file '${f.file}'\nduration ${((frames[i + 1]?.at ?? f.at + lastMs) - f.at) / 1000}`,
		)
		.join("\n");
	const listFile = `${out}.txt`;
	writeFileSync(listFile, `${list}\nfile '${frames.at(-1)?.file}'\n`);
	await ffmpeg([
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		listFile,
		"-fps_mode",
		"vfr",
		"-c:v",
		"libwebp_anim",
		"-preset",
		"text",
		"-quality",
		String(quality),
		"-compression_level",
		"6",
		"-loop",
		"0",
		out,
	]);
	rmSync(listFile);
}

/**
 * Writes the `crop` (CSS pixels of a capture at `SCALE`) of `png` as a WebP `width` pixels wide: a gallery thumbnail,
 * lossy at quality 85 with the `text` preset.
 */
export async function encodeThumb(png: string, crop: Rect, width: number, out: string) {
	const [w, h, x, y] = [crop.width, crop.height, crop.x, crop.y].map((n) => n * SCALE);
	const filter = `crop=${w}:${h}:${x}:${y},scale=${width}:-1:flags=lanczos`;
	await ffmpeg([
		"-i",
		png,
		"-vf",
		filter,
		"-c:v",
		"libwebp",
		"-preset",
		"text",
		"-quality",
		"85",
		out,
	]);
}

/**
 * Writes `png` as `<base>.png` or `<base>.webp`, whichever is smaller, and removes the other so a changed
 * choice leaves no stale file. The WebP is lossy at quality 90 with the `text` preset, which beats the PNG on
 * pages of flat colour and smooth charts. Returns the file kept.
 */
export async function encodeStill(png: string, base: string): Promise<string> {
	const webp = `${base}.webp`;
	const plain = `${base}.png`;
	await ffmpeg(["-i", png, "-c:v", "libwebp", "-preset", "text", "-quality", "90", webp]);
	if (sizeOf(webp) < sizeOf(png)) {
		rmSync(plain, { force: true });
		return webp;
	}
	rmSync(webp);
	copyFileSync(png, plain);
	return plain;
}
