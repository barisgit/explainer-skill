/* The page's numbers. Sizes are measured from kit/echarts.js exactly as skills/explainer/src/kit.ts carries it; the unpack timings
   are the ones AGENTS.md ("ECharts ships compressed") records. Run `bun measure.ts` to rewrite data.json; it also stops when
   page.mdx's load path, which holds these numbers as text, has drifted from them. */
import { readFileSync, writeFileSync } from "node:fs";
import { brotliCompressSync, constants, deflateRawSync, gzipSync } from "node:zlib";
import { leadingComment, pageFile } from "../../skills/explainer/src/kit.ts";

const path = new URL("../../skills/explainer/kit/echarts.js", import.meta.url).pathname;
const file = readFileSync(path, "utf8");
// What pack compresses: the file without its licence comment, which stays readable in the page.
const source = Buffer.from(file.slice(leadingComment(file).length));
const kb = (bytes: number) => Math.round(bytes / 1000);
const base64 = (bytes: number) => Math.ceil(bytes / 3) * 4;

const deflate = deflateRawSync(source, { level: 9 }).length;
const gzip = gzipSync(source, { level: 9 }).length;
const brotli = brotliCompressSync(source, {
	params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;
const packed = deflateRawSync(source, { level: 9 });
// Bytes written as Latin-1 text, inlined in a UTF-8 page: a byte of 0x80 or more takes two.
const latin1 = packed.length + packed.filter((byte) => byte >= 0x80).length;

const data = {
	plain: kb(Buffer.byteLength(file)),
	binary: kb(deflate),
	packed: kb(pageFile(path).deflate?.length ?? 0),
	saved: kb(Buffer.byteLength(file)) - kb(pageFile(path).deflate?.length ?? 0),
	gzip: kb(base64(gzip)),
	brotli: kb(base64(brotli)),
	latin1: kb(latin1),
	unpackMs: { atob: 11, inflate: 3, run: 17 },
};
writeFileSync(new URL("data.json", import.meta.url), `${JSON.stringify(data, null, "\t")}\n`);

const page = readFileSync(new URL("page.mdx", import.meta.url), "utf8");
const expected = [
	`${data.packed} KB inlined`,
	`${data.binary} KB`,
	`${data.plain} KB`,
	"atob<br>11 ms",
	"inflate<br>3 ms",
	"parse and run<br>17 ms",
];
const missing = expected.filter((text) => !page.includes(text));
if (missing.length) {
	throw new Error(`page.mdx lacks: ${missing.join(", ")}`);
}
console.log(data);
