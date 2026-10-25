/**
 * Entry for vendor/math.js (`bun run vendor`): remark-math, which reads $...$ and $$...$$ in an .mdx page, and Temml, which
 * renders the TeX to MathML at pack time. Its types for src/ live in vendor/math.d.ts; keep the two in step.
 */
export { default as remarkMath } from "remark-math";
export { default as temml } from "temml";
