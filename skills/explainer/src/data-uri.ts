/**
 * The files pack embeds, as data: URIs: images and fonts, whether a page references them (`<img src>`, CSS `url()`) or its code
 * imports them (`import icon from "./icon.svg"`).
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { PackError } from "./pack-error.ts";

/** The media type of each file extension pack embeds. */
export const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".otf": "font/otf",
};

/** The extensions of MIME's images and of its fonts, as messages list them: ".png, .jpg, ...". */
export const EMBEDDED = {
	images: Object.keys(MIME)
		.filter((ext) => MIME[ext]?.startsWith("image/"))
		.join(", "),
	fonts: Object.keys(MIME)
		.filter((ext) => MIME[ext]?.startsWith("font/"))
		.join(", "),
};

/** The file at `path` as a base64 data: URI; a PackError for an extension MIME does not list. */
export function dataUri(path: string): string {
	const mime = MIME[extname(path).toLowerCase()];
	if (!mime) {
		throw new PackError(`unsupported asset type: ${path}`);
	}
	return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}
