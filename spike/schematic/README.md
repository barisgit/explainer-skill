# Schematic spike (issue #71)

Three ways for an author to get an analog schematic from a short description, each drawn at pack time into one inline SVG by
the engine in `skills/explainer/src/schematic/`, written as a ```schematic fence:

| Page | Dialect | The author writes |
|---|---|---|
| `elk/` | `netlist`, no positions | parts and nodes only; ELK places and routes |
| `grid/` | `netlist`, `@x,y` | parts, nodes and absolute grid positions; the grid router wires the nets |
| `place/` | `netlist`, `pin@Part.pin dx,dy` | parts, nodes and each part's position relative to a pin already placed; the router wires |
| `draw/` | `draw` | elements in drawing order with direction, length and anchors (Schemdraw's model); no router |

Test circuits: the µA723 with fold-back current limiting (TI SLVS057D, figure 6, with figure 4's external NPN pass
transistor) and a one-transistor common-emitter amplifier.

| Circuit | Approach | Lines | Characters | Problems | Bends | Crossings | Render |
|---|---|---:|---:|---:|---:|---:|---:|
| µA723 | elk | 10 | 258 | 0 | 27 | 6 | 32 ms |
| µA723 | grid | 10 | 334 | 0 | 10 | 2 | 5 ms |
| µA723 | place | 10 | 388 | 0 | 10 | 2 | 5 ms |
| µA723 | draw | 34 | 820 | 0 | 8 | 1 | 3 ms |
| CE amp | elk | 11 | 163 | 0 | 11 | 4 | 14 ms |
| CE amp | grid | 11 | 242 | 0 | 2 | 0 | 1 ms |
| CE amp | place | 11 | 294 | 0 | 3 | 0 | 1 ms |
| CE amp | draw | 22 | 514 | 0 | 0 | 0 | 3 ms |

"Problems" is what the engine's own audit finds (wires through parts, parts or labels overlapping, unmeant contacts, nets
drawn in pieces). It misses a label placed far from its part, which the ELK amplifier has.

Run from the repository root:

```sh
bun spike/schematic/measure.ts .evidence/dev spike/schematic/*/page.mdx
(cd spike/schematic/place && bun ../../../skills/explainer/cli.ts pack page.mdx -o ../../../.evidence/pages/place.html)
bun skills/explainer/cli.ts check .evidence/pages/place.html --out .evidence/shots/place
```

The spike imports elkjs from `node_modules`, so `pack` on this branch runs only in a checkout with `bun install`, not from an
installed copy of the skill.
