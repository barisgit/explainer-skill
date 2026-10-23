/**
 * Entry for vendor/mdx.js (`bun run vendor`): the MDX compiler and the two remark plugins pack uses for .mdx pages.
 * Its types for src/ live in vendor/mdx.d.ts; keep the two in step when the export list changes.
 */
export { compile } from "@mdx-js/mdx";
export { default as remarkFrontmatter } from "remark-frontmatter";
export { default as remarkGfm } from "remark-gfm";
