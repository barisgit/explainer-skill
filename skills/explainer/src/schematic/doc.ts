/** What `kit schematic` prints: the dialect of a ```schematic block, as an author needs it. */
export const SCHEMATIC_DOC = `\`\`\`schematic fences hold a circuit as a netlist: one part per line, the nets it joins stated by name, and where it goes.
pack places the parts, wires the nets with a grid router and draws one SVG that follows light and dark. The wiring is the netlist, so the drawing cannot disagree with the circuit.

  title Common-emitter amplifier
  Q1 c b e BC547 @0,0
  R_C vcc c 4.7k b@Q1.c 0,-1 v
  R1 vcc b 47k a@R_C.a -8,0 v
  C1 in b 10 µF b@Q1.b -8,0

Line:  NAME [kind] NODES... [VALUE...] [PLACE] [h|v|r90|r180|r270|flip]
  NAME      R1, Q1, C_E: a unique name; _ and {...} set subscripts in labels (V_{CC}). Its first letter is its kind, as in SPICE (R C L D V I Q M, U or X for an IC), or write a kind after it.
  kind      resistor capacitor electrolytic inductor diode zener led switch battery vsource isource  (nodes: a b; a is the anode or +)
            potentiometer (a b w)   npn pnp (c b e)   nmos pmos (d g s)   opamp (- + out)   port vdd vss (one node, labelled by its value)
            ic: U1 ic LM358 left IN=a right OUT=y top VCC=vcc bottom GND=0   (pins listed per side, top to bottom or left to right; "A B"=net quotes names; a bare name is a pin left open)
  VALUE     the rest of the words, under the name: 4.7k, 100 nF, BC547.
  PLACE     @x,y puts the part on the sheet (grid units of 10; y grows downwards): the first part, say.
            pin@Part.pin dx,dy puts the part's pin dx,dy from a pin of another part, in either order of lines: "b@Q1.c 0,-1" is one unit above Q1's collector.
            With no pin before @, the part's origin goes there: a two-terminal's pin a, a transistor's base or gate, an IC's top-left corner.
            Pins that land on the same point are joined without a wire.
  turn      h (a left, b right; the default) or v (a on top); two-terminals and transistors also take r90 r180 r270 and flip. An IC does not turn.
Nets: names are yours; 0, gnd or GND is ground, drawn as a ground symbol at each pin (data-ref "gnd"); nc leaves a pin open on purpose: it touches nothing. A net that joins one pin is an error.
Comments start with #.

Place a chain of parts with each one's pin on the last one's (a@R1.b), a stage by offsets from its transistor, and let the router run the rest. Leave two units or more between parts that need a wire.
pack fails on a part with no place, an unknown part or pin, parts on top of each other, a net it cannot route, a wire through a part, a label with no room beside its part and a net that falls in pieces, each naming its line and what to change.

Linking: each part carries data-ref=NAME, each wire and junction the data-ref of its net and of the parts it joins, every ground "gnd":
  <span data-ref="R_C">the collector resistor</span>   lights the part and the wires touching it; <span data-ref="vcc">the supply rail</span> lights the net (kit link).
Size: the drawing fills the column up to part names at body size (16 px), never larger. Phones: it shrinks no further than 10 px text and then scrolls sideways; print fits it to the paper. To resize one, set --schematic-max (widest) or --schematic-min (narrowest before it scrolls) on its svg.`;
