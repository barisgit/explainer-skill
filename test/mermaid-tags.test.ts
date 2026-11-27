import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderMermaid } from "../skills/explainer/src/mermaid.ts";
import {
	inPage,
	packAndRun,
	packedMdx,
	packMdx,
	pageContract,
	scratch,
	WIDTHS,
} from "./support.ts";

const dir = scratch();
afterAll(dir.cleanup);

/** The system the battery page draws: wide enough that phones get a top-down copy. */
const SYSTEM = `flowchart LR
	roof["roof panels, 6 kW"] --> inv["hybrid inverter"]
	inv --> house["house"]
	house <--> meter["two-way meter"]
	meter <--> grid["grid"]
	inv <--> bat["5 kWh battery"]`;
const TAGS = "tag:roof=1 tag:inv=2 tag:bat=3 tag:meter=4";

/** An ordered path with a measured value on each stage and on its first edge, its stages tagged too. */
const PATH = `flowchart LR
	file["page file"] -->|418 KB inlined| atob["atob<br>11 ms"]
	atob --> inflate["inflate<br>3 ms"]
	inflate --> run["parse and run<br>17 ms"]`;
const PATH_TAGS = "tag:file=1 tag:atob=2 tag:inflate=3 tag:run=4";

/** Every copy of `source` rendered with the fence meta `meta`, failing the test when it does not render. */
function copies(source: string, meta: string): string[] {
	const diagram = renderMermaid(source, 0, meta);
	if (diagram instanceof Error) {
		throw diagram;
	}
	return [diagram.svg, diagram.phone ?? ""];
}

/** Node `id`'s markup in `svg`: from its group up to the next node's. */
const nodeOf = (svg: string, id: string) =>
	new RegExp(`<g class="pele-node[^"]*" data-id="${id}"[\\s\\S]*?(?=<g class="pele-node|$)`).exec(
		svg,
	)?.[0] ?? "";

/** The message `source` with `meta` fails with, or "rendered". */
function failure(source: string, meta: string): string {
	const diagram = renderMermaid(source, 0, meta);
	return diagram instanceof Error ? diagram.message : "rendered";
}

test("tag:id=n in a flowchart fence's meta draws n as a tag inside that node, in the wide and the phone copy", () => {
	const [wide = "", phone = ""] = copies(SYSTEM, TAGS);

	expect(phone).not.toBe("");
	for (const copy of [wide, phone]) {
		const tags = [
			...copy.matchAll(/<g class="tag" data-id="(\w+)" data-ref="\1" data-tag[^>]*>[\s\S]*?<\/g>/g),
		];
		expect(tags.map((m) => m[1]).sort()).toEqual(["bat", "inv", "meter", "roof"]);
		expect(nodeOf(copy, "inv")).toMatch(
			/<g class="tag"[^>]*>\s*<rect [^>]*\/>\s*<text [^>]*font-size="13"[^>]*>2<\/text>/,
		);
		expect(nodeOf(copy, "house")).toContain("house");
		expect(nodeOf(copy, "house")).not.toContain('class="tag"');
	}
});

test.each([
	{
		name: "a shape definition",
		source: 'flowchart TD\n  a@{ shape: rect, label: "Pump" } --> b',
		id: "a",
	},
	{
		name: "a node whose id another label mentions",
		source: 'flowchart TD\n  a["see b[1]"] --> b["Target"]',
		id: "b",
	},
	{
		name: "a state named only in a transition",
		source: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy",
		id: "Busy",
	},
])("a tag lands on its own node for $name", ({ source, id }) => {
	for (const copy of copies(source, `tag:${id}=7`).filter(Boolean)) {
		expect(copy.match(/<g class="tag" /g)).toHaveLength(1);
		expect(nodeOf(copy, id)).toContain(`<g class="tag" data-id="${id}"`);
	}
});

test("a tagged path keeps its values: a stage's second line and an edge's label", () => {
	for (const copy of copies(PATH, PATH_TAGS).filter(Boolean)) {
		const atob = nodeOf(copy, "atob");
		expect(atob).toMatch(/>2<\/text>/);
		expect(atob).toMatch(/>\s*atob<\/tspan><tspan[^>]*>11 ms</);
		expect(copy).toMatch(/<g class="pele-edge-label"[^>]*>[\s\S]*?>418 KB inlined</);
	}
});

test("native node roles tint both copies, follow the theme picker and local tokens, and keep text readable", async () => {
	const flow = `${SYSTEM.replace('inv["hybrid inverter"]', 'inv["hybrid inverter"]:::info')}
	class roof,house warn
	class bat ok
	class grid bad`;
	const output = await packedMdx(
		dir,
		"roles",
		`# Power\n\n\`\`\`mermaid ${TAGS}\n${flow}\n\`\`\`\n`,
	);
	expect(readFileSync(output, "utf8")).not.toContain("--_mermaid-");
	for (const viewport of WIDTHS) {
		const looks = await inPage(
			output,
			(cdp) =>
				cdp.evaluate(`(() => {
					const svg = [...document.querySelectorAll(".mermaid > svg")]
						.find((copy) => getComputedStyle(copy).display !== "none");
					const ctx = document.createElement("canvas").getContext("2d");
					const rgb = (el, prop) => {
						ctx.clearRect(0, 0, 1, 1);
						ctx.fillStyle = getComputedStyle(el)[prop];
						ctx.fillRect(0, 0, 1, 1);
						return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
					};
					const luminance = (channels) => channels.map((c) => c / 255)
						.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
						.reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
					const contrast = (a, b) => {
						const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
						return (x + 0.05) / (y + 0.05);
					};
					const nodes = (id) => svg.querySelector('.pele-node[data-id="' + id + '"]');
					const body = (id) => nodes(id).querySelector(":scope > rect");
					const picker = document.querySelector(".scheme-picker");
					const set = (scheme) => { picker.value = scheme; picker.dispatchEvent(new Event("change")); };
					const snapshot = () => {
						const edge = svg.querySelector(".pele-edge > path");
						const ink = rgb(edge, "stroke").join(",");
						const ids = ["inv", "roof", "house", "bat", "grid"];
						const fills = ids.map((id) => rgb(body(id), "fill"));
						const strokes = ids.map((id) => rgb(body(id), "stroke").join(","));
						return {
							fills, strokes,
							textReadable: ids.every((id, i) => [...nodes(id).querySelectorAll(":scope > text")]
								.every((label) => contrast(fills[i], rgb(label, "fill")) >= 4.5)),
							edgesNeutral: [...svg.querySelectorAll(".pele-edge > path:not(.pele-marker)")]
								.every((line) => rgb(line, "stroke").join(",") === ink) && !strokes.includes(ink),
							unassignedPlain: getComputedStyle(body("meter")).fill === "rgba(0, 0, 0, 0)",
						};
					};
					set("light");
					const light = snapshot();
					set("dark");
					const dark = snapshot();
					nodes("inv").style.setProperty("--info", "#e98bce");
					const override = snapshot();
					return {
						light, dark, override,
						tintChanges: light.fills[0].join() !== dark.fills[0].join() &&
							dark.fills[0].join() !== override.fills[0].join(),
						tag: nodes("inv").querySelector("[data-tag]").getAttribute("aria-label"),
					};
				})()`),
			viewport,
		);
		expect(looks).toMatchObject({
			light: {
				textReadable: true,
				edgesNeutral: true,
				unassignedPlain: true,
				strokes: ["52,94,143", "138,90,0", "138,90,0", "24,116,75", "179,50,42"],
			},
			dark: { textReadable: true, edgesNeutral: true, unassignedPlain: true },
			override: { textReadable: true },
			tintChanges: true,
			tag: "2, hybrid inverter",
		});
		expect(looks).toHaveProperty("dark.strokes.0", "159,190,237");
		expect(looks).toHaveProperty("override.strokes.0", "233,139,206");
	}
}, 30_000);

test("a node's tag widens its box by the tag, leaving the label's room as it was", () => {
	const width = (svg: string, id: string) =>
		Number(new RegExp(`data-id="${id}"[^>]*>\\s*<rect [^>]* width="([\\d.]+)"`).exec(svg)?.[1]);
	const [plain = ""] = copies(SYSTEM, "");
	const [tagged = ""] = copies(SYSTEM, "tag:inv=2");

	expect(width(tagged, "inv") - width(plain, "inv")).toBeGreaterThanOrEqual(20);
	expect(width(tagged, "house")).toBe(width(plain, "house"));
});

test.each([
	{
		name: "a tag for no node",
		source: SYSTEM,
		meta: "tag:battery=3",
		message: 'tag:battery names no node; use the id written before its label, as a in a["label"]',
	},
	{
		name: "a tag that is not a number",
		source: SYSTEM,
		meta: "tag:inv=A",
		message: "tag:inv=A is not a number; a tag is 1 to 3 digits, as in tag:inv=2",
	},
	{
		name: "one number on two nodes",
		source: SYSTEM,
		meta: "tag:inv=2 tag:bat=2",
		message: "tag 2 is on inv and bat; give each part its own number",
	},
	{
		name: "one node with two numbers",
		source: SYSTEM,
		meta: "tag:inv=2 tag:inv=5",
		message: "tag:inv is given 2 and 5; give each part one number",
	},
	{
		name: "anything else in the meta",
		source: SYSTEM,
		meta: "title",
		message: 'pack does not read "title" after mermaid; tag nodes with tag:id=number',
	},
	{
		name: "a tag on a sequence diagram",
		source: "sequenceDiagram\n  A->>B: hi",
		meta: "tag:A=1",
		message:
			"tags are drawn on flowchart and state diagram nodes; name the parts in the messages instead",
	},
])("$name fails with what to write instead", ({ source, meta, message }) => {
	expect(failure(source, meta)).toBe(message);
});

test("a mention whose text is its part's tag is drawn as that tag; another number warns, a word stays a term", async () => {
	const { result, output } = await packMdx(
		dir,
		"mentions",
		`# System\n\nThe inverter <span data-ref="inv">2</span> charges the battery <span data-ref="bat">5</span>, and the <span data-ref="house">house</span> uses it.\n\n\`\`\`mermaid ${TAGS}\n${SYSTEM}\n\`\`\`\n\n<table><tbody><tr data-ref="meter"><td data-ref="roof">1</td><td data-ref="bat">7</td><td><span data-ref="inv">2</span></td></tr></tbody></table>\n`,
	);

	expect(result.code).toBe(0);
	expect(result.stdout).toContain('data-ref="bat" says 5, but its drawing tags it 3');
	const html = readFileSync(output, "utf8");
	expect(html).toContain('<span data-ref="inv" data-tag="">2</span>');
	expect(html).toContain('<span data-ref="bat">5</span>');
	expect(html).toContain('<span data-ref="house">house</span>');
	expect(html).toContain(
		'<td data-ref="roof">1</td><td data-ref="bat">7</td><td><span data-ref="inv" data-tag="">2</span></td>',
	);
	expect(result.stdout).not.toContain("says 7");
});

test("one part tagged with two numbers in two drawings fails, naming both; the same number twice packs", async () => {
	const fence = (tags: string) => `\`\`\`mermaid ${tags}\nflowchart LR\n  inv --> bat\n\`\`\`\n`;
	const page = (second: string) =>
		`# Two\n\n${fence("tag:inv=2 tag:bat=3")}\n## Again\n\n${fence(second)}`;
	const { result } = await packMdx(dir, "twice", page("tag:inv=5"));

	expect(result.code).toBe(1);
	expect(result.stderr).toContain(
		"mermaid block 2: tag:inv=5, but mermaid block 1 tags inv 2; give inv the same number in every drawing",
	);
	expect((await packMdx(dir, "same", page("tag:inv=2"))).result.code).toBe(0);
});

test("a tag in the drawing is named by its number and its node's label", async () => {
	const output = await packedMdx(
		dir,
		"named",
		`# Named\n\nThe <span data-ref="atob">2</span> step.\n\n\`\`\`mermaid ${PATH_TAGS}\n${PATH}\n\`\`\`\n`,
	);
	const names = await inPage(output, async (cdp) => {
		await cdp.send("Accessibility.enable");
		const { nodes } = await cdp.send<{ nodes: { name?: { value: string } }[] }>(
			"Accessibility.getFullAXTree",
		);
		return nodes.map((n) => n.name?.value ?? "");
	});

	expect(names).toContain("2, atob 11 ms");
	expect(names).toContain("1, page file");
});

test("a tag and its mention light each other on hover and focus, read at the 13 px label size, and the tag sits beside its label", async () => {
	const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<p>The new <span id="mention" data-ref="inv">2</span> replaces the old one.</p>
<pre class="mermaid" data-meta="${TAGS}">${SYSTEM}</pre>
<pre class="mermaid" data-meta="${PATH_TAGS}">${PATH}</pre>
</main><script src="kit:link.js"></script><script>${pageContract({
		"the shown tag is focusable, an untagged node is not": `(() => {
			const svg = [...document.querySelectorAll(".mermaid > svg")].find((s) => getComputedStyle(s).display !== "none");
			return svg.querySelector('[data-tag][data-ref="inv"]').tabIndex === 0 && svg.querySelector('.pele-node[data-ref="house"]').tabIndex < 0;
		})()`,
		"focusing the tag lights its mention and node": `(() => {
			const svg = [...document.querySelectorAll(".mermaid > svg")].find((s) => getComputedStyle(s).display !== "none");
			svg.querySelector('[data-tag][data-ref="inv"]').focus();
			const lit = document.querySelector("#mention").classList.contains("is-lit") && svg.querySelector('.pele-node[data-ref="inv"]').classList.contains("is-lit");
			document.activeElement.blur();
			return lit;
		})()`,
		"hovering the mention lights the tag": `(() => {
			const mention = document.querySelector("#mention");
			mention.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
			const lit = document.querySelector('svg [data-tag][data-ref="inv"]').classList.contains("is-lit");
			document.querySelector("main").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
			return lit;
		})()`,
		"the mention is a ring at the label size": `(() => {
			const style = getComputedStyle(document.querySelector("#mention"));
			return style.fontSize === "13px" && style.borderTopWidth === "1px" && parseFloat(style.borderTopLeftRadius) >= 9;
		})()`,
		"each shown tag reads at the 13 px label size and keeps its ring inside its node, before its label": `[...document.querySelectorAll(".mermaid > svg")]
			.filter((svg) => getComputedStyle(svg).display !== "none")
			.every((svg) => [...svg.querySelectorAll("[data-tag]")].every((tag) => {
				const node = tag.closest(".pele-node");
				const first = node.querySelector(":scope > text.pele-label tspan") ?? node.querySelector(":scope > text.pele-label");
				const [ring, label, box] = [tag.querySelector("rect"), first, node.querySelector(":scope > rect")].map((el) => el.getBoundingClientRect());
				const px = (text) => parseFloat(getComputedStyle(text).fontSize);
				return px(tag.querySelector("text")) === 13
					&& ring.x >= box.x && ring.y >= box.y && ring.bottom <= box.bottom
					&& ring.right <= label.x + 1 && label.right <= box.right;
			}))`,
	})}</script></body></html>`;

	expect(await packAndRun(dir, "tags", page)).toEqual([]);
}, 30_000);

test.each(["light", "dark"])(
	"in %s, a dimmed edge label keeps its mask opaque while its text dims, in the wide and the phone copy",
	async (scheme) => {
		const page = `<!doctype html><html data-scheme="${scheme}"><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="kit:theme.css"></head><body><main>
<p>The <span id="mention" data-ref="inv">2</span> charges the battery.</p>
<pre class="mermaid" data-meta="${TAGS}">${SYSTEM.replace("inv <--> bat", "inv <-->|surplus, 2.1 kWh| bat")}</pre>
</main><script src="kit:link.js"></script><script>${pageContract({
			"hovering the mention dims each edge label's text but not its mask": `(() => {
				const fill = (g) => getComputedStyle(g.querySelector("text")).fill;
				const before = [...document.querySelectorAll(".pele-edge-label")].map(fill);
				document.querySelector("#mention").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
				const svg = [...document.querySelectorAll(".mermaid > svg")].find((s) => getComputedStyle(s).display !== "none");
				const seen = (el) => { let o = 1; for (let e = el; e && e !== svg.parentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
				const labels = [...svg.querySelectorAll(".pele-edge-label")];
				return svg.classList.contains("has-lit") && (innerWidth < 640) === svg.hasAttribute("data-phone") && labels.length > 0
					&& labels.every((g) => !g.classList.contains("is-lit") && seen(g.querySelector("rect")) === 1
						&& !/rgba\\(.*, 0(\\.\\d+)?\\)$/.test(getComputedStyle(g.querySelector("rect")).fill) && seen(g.querySelector("text")) === 1
						&& fill(g) !== before[[...document.querySelectorAll(".pele-edge-label")].indexOf(g)]);
			})()`,
		})}</script></body></html>`;

		expect(await packAndRun(dir, `dimmed-${scheme}`, page)).toEqual([]);
	},
	30_000,
);
