/**
 * Entry for vendor/pele.js (`bun run vendor`): pele's core with the diagram types pack draws registered (src/mermaid.ts
 * SUPPORTED), so the other types stay out of the bundle. Its types for src/ live in vendor/pele.d.ts; keep the two in step when
 * the export list changes.
 */

import { register } from "pele/core";
import classDiagram from "pele/diagrams/class";
import er from "pele/diagrams/er";
import flowchart from "pele/diagrams/flowchart";
import sequence from "pele/diagrams/sequence";
import state from "pele/diagrams/state";
import xychart from "pele/diagrams/xychart";

register(flowchart, state, sequence, classDiagram, er, xychart);

export { PeleError, parse, render } from "pele/core";
