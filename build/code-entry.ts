/**
 * Entry for vendor/refractor.js (`bun run vendor`): refractor, Prism's grammars producing hast, which pack colours code fences
 * with. refractor's common languages (C, C++, C#, CSS, diff, Go, HTML and XML, Java, JavaScript, JSON, Kotlin, Markdown,
 * Python, Rust, shell, SQL, TypeScript, YAML and more) plus JSX, TSX and VHDL. Its types for src/ live in vendor/refractor.d.ts.
 */
import { refractor } from "refractor";
import tsx from "refractor/tsx";
import vhdl from "refractor/vhdl";

refractor.register(tsx);
refractor.register(vhdl);

export { refractor };
