/**
 * What a packed page would still load. Every stylesheet, style attribute and URL-bearing SVG attribute of the finished page is
 * read the way the browser reads it: HTML character references are decoded, then the CSS goes through Bun's CSS parser, which
 * prints each reference in one canonical form (`url("...")`, `@import "..."`), whatever escapes the source used. A reference
 * that is not a `#` fragment or a `data:` URI is a load the offline page must not make. What cannot be read that way fails
 * closed: an HTML entity outside the few pack decodes, or CSS the parser rejects.
 */

/** Where a value sits, as the author would find it: `<style>`, `a style attribute`, `<rect fill>`; `block` is its Mermaid block. */
export interface Origin {
	label: string;
	block?: number;
}

/** One problem: what the page loads (`target`, empty for unreadable input) and why it is a problem. */
export interface Load {
	origin: Origin;
	kind: "url" | "import" | "href" | "local" | "entity" | "unreadable";
	target: string;
}

/** SVG presentation attributes whose value may be a url() (SVG 2, Fill/Stroke, Masking, Filter Effects, CSS UI). */
const URL_ATTRIBUTES = new Set([
	"fill",
	"stroke",
	"marker",
	"marker-start",
	"marker-mid",
	"marker-end",
	"clip-path",
	"mask",
	"filter",
	"cursor",
]);
/** Functions that take a URL as a plain string as well as url(). */
const URL_FUNCTIONS = /\b(?:-webkit-)?(?:image-set|image|src)\(/g;
const DECODED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** An attribute value as the browser hands it to CSS; returns the first entity it does not decode instead. */
function decodeEntities(value: string): { text: string } | { entity: string } {
	let unknown = "";
	const text = value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);?/gi, (whole, ref: string) => {
		if (ref.startsWith("#")) {
			const code =
				ref[1]?.toLowerCase() === "x" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
		}
		const known = whole.endsWith(";") ? DECODED[ref] : undefined;
		unknown ||= known === undefined ? whole : "";
		return known ?? whole;
	});
	return unknown ? { entity: unknown } : { text };
}

/** Strings passed to image-set(), image() or src(), at any depth of their argument list. */
function urlStrings(css: string): string[] {
	const found: string[] = [];
	for (const call of css.matchAll(URL_FUNCTIONS)) {
		let depth = 1;
		let end = (call.index ?? 0) + call[0].length;
		while (depth > 0 && end < css.length) {
			const char = css[end++];
			depth += char === "(" ? 1 : char === ")" ? -1 : 0;
		}
		const args = css
			.slice((call.index ?? 0) + call[0].length, end - 1)
			.replace(/url\("(?:[^"\\]|\\.)*"\)/g, "");
		found.push(...[...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? ""));
	}
	return found;
}

/** The loads in canonical CSS, as Bun's printer writes it. */
function cssLoads(css: string, origin: Origin): Load[] {
	const imports = [...css.matchAll(/@import\s+(?:url\()?"((?:[^"\\]|\\.)*)"/g)].map(
		(m) => m[1] ?? "",
	);
	const urls = [
		...[...css.matchAll(/url\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1] ?? ""),
		...urlStrings(css),
	];
	const kept = (target: string) => target.startsWith("#") || /^data:/i.test(target);
	return [
		...imports.map((target): Load => ({ origin, kind: "import", target })),
		...urls
			.filter((target) => !kept(target))
			.map(
				(target): Load => ({
					origin,
					kind: /^(?:[a-z][\w+.-]*:)?\/\//i.test(target) ? "url" : "local",
					target,
				}),
			),
	];
}

interface Source {
	origin: Origin;
	css: string;
}

/** The page's CSS-bearing values (`sources`) and the loads already known without parsing CSS (`loads`). */
class Collected {
	readonly sources: Source[] = [];
	readonly loads: Load[] = [];

	/** A value for the CSS parser, `wrap`ped into a stylesheet; `decode` when the HTML parser decodes its entities. */
	css(origin: Origin, value: string, wrap: (text: string) => string, decode = true): void {
		const decoded = decode ? decodeEntities(value) : { text: value };
		if ("entity" in decoded) {
			this.loads.push({ origin, kind: "entity", target: decoded.entity });
		} else {
			this.sources.push({ origin, css: wrap(decoded.text) });
		}
	}

	/** One attribute of an element; `inSvg` when the element is inside an `<svg>`. */
	attribute(
		tag: string,
		name: string,
		value: string,
		inSvg: boolean,
		origin: (label: string) => Origin,
	): void {
		if (name === "style") {
			this.css(origin("a style attribute"), value, (text) => `.v{${text}}`);
		} else if (inSvg && URL_ATTRIBUTES.has(name)) {
			this.css(origin(`<${tag} ${name}>`), value, (text) => `.v{${name}:${text}}`);
		} else if (inSvg && tag !== "a" && /^(?:xlink:)?href$/.test(name)) {
			const decoded = decodeEntities(value);
			const target = "text" in decoded ? decoded.text.trim() : decoded.entity;
			if (!target.startsWith("#") && !/^data:/i.test(target)) {
				this.loads.push({ origin: origin(`<${tag} ${name}>`), kind: "href", target });
			}
		}
	}
}

/** Walks the page once, collecting every style, style attribute and URL-bearing SVG attribute with where it sits. */
async function collect(html: string): Promise<Collected> {
	const found = new Collected();
	let svgDepth = 0;
	let blocks = 0;
	let block = 0;
	const origin = (label: string): Origin => (block ? { label, block } : { label });
	// The style element being read; it is read at its end tag, or at the end of the page when it has none (the browser then
	// reads the rest of the page as its CSS).
	let sheet: { text: string[]; where: Origin; inSvg: boolean } | undefined;
	const readSheet = () => {
		if (sheet) {
			found.css(sheet.where, sheet.text.join(""), (text) => text, sheet.inSvg);
			sheet = undefined;
		}
	};
	await new HTMLRewriter()
		.on("div.mermaid", {
			element(el) {
				blocks++;
				block = blocks;
				el.onEndTag(() => {
					block = 0;
				});
			},
		})
		.on("svg", {
			element(el) {
				svgDepth++;
				el.onEndTag(() => {
					svgDepth--;
				});
			},
		})
		.on("*", {
			element(el) {
				const tag = el.tagName.toLowerCase();
				for (const [name, value] of el.attributes) {
					found.attribute(tag, name, value, svgDepth > 0, origin);
				}
			},
		})
		.on("style", {
			element(el) {
				// In SVG (foreign content) a style element's text is parsed like any text, so its entities are decoded.
				sheet = { text: [], where: origin("<style>"), inSvg: svgDepth > 0 };
				el.onEndTag(readSheet);
			},
			text(chunk) {
				sheet?.text.push(chunk.text);
			},
		})
		.onDocument({ end: readSheet })
		.transform(new Response(html))
		.text();
	return found;
}

/**
 * Every load the packed page would make, and every value pack cannot read well enough to tell. Values are deduplicated and
 * parsed each in its own file, so one value (an unclosed comment, say) cannot hide the next.
 */
export async function findLoads(html: string): Promise<Load[]> {
	const { sources, loads } = await collect(html);
	const files: Record<string, string> = {};
	const origins = new Map<string, Origin>();
	const seen = new Map<string, string>();
	for (const { origin, css } of sources) {
		const key = `${origin.block ?? 0}\n${origin.label}\n${css}`;
		if (seen.has(key)) {
			continue;
		}
		const path = `/pack/${seen.size}.css`;
		seen.set(key, path);
		files[path] = css;
		origins.set(path.slice(1), origin);
	}
	if (!seen.size) {
		return loads;
	}
	const build = await Bun.build({
		entrypoints: Object.keys(files),
		files,
		external: ["*"],
		throw: false,
	});
	const originOf = (path: string) =>
		origins.get(path.replace(/^[./]+/, "")) ?? { label: "a stylesheet" };
	if (!build.success) {
		const errors = build.logs.filter((log) => log.level === "error");
		return [
			...loads,
			...errors.map(
				(log): Load => ({
					origin: originOf(log.position?.file ?? ""),
					kind: "unreadable",
					target: log.message,
				}),
			),
		];
	}
	for (const output of build.outputs) {
		loads.push(...cssLoads(await output.text(), originOf(output.path)));
	}
	return loads;
}
