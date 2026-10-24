import { statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Frame } from "./types.ts";

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
 * frames are already the size they are shown at. The `text` preset keeps edges of small type clean. The ffmpeg frame list
 * is written next to the frames, in the temporary work directory, so a failed encode leaves nothing in `examples/media/`.
 */
export async function encodeClip(frames: Frame[], lastMs: number, quality: number, out: string) {
	const list = frames
		.map(
			(f, i) =>
				`file '${f.file}'\nduration ${((frames[i + 1]?.at ?? f.at + lastMs) - f.at) / 1000}`,
		)
		.join("\n");
	const listFile = join(dirname(frames[0]?.file ?? out), "frames.txt");
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
}

/** Encodes one PNG as a lossy WebP with the `text` preset, which keeps small type clean, optionally through an ffmpeg filter. */
async function encodeWebp(png: string, quality: number, out: string, filter?: string) {
	await ffmpeg([
		"-i",
		png,
		...(filter ? ["-vf", filter] : []),
		"-c:v",
		"libwebp",
		"-preset",
		"text",
		"-quality",
		String(quality),
		out,
	]);
}

/** Writes `png` as a WebP `width` pixels wide: a gallery thumbnail. */
export async function encodeThumb(png: string, width: number, out: string) {
	await encodeWebp(png, 85, out, `scale=${width}:-1:flags=lanczos`);
}

/** Writes the hero collage `png` as a WebP, keeping its transparent background. */
export async function encodeHero(png: string, out: string) {
	await encodeWebp(png, 90, out);
}
