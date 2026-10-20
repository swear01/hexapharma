const HEX = "16,3 27.3,9.5 27.3,22.5 16,29 4.7,22.5 4.7,9.5";

export type MapSymbolKind =
  | "start" | "control" | "finish" | "candidate" | "cure" | "sideEffect"
  | "wall" | "marsh" | "abyss" | "portal" | "belt" | "inPort" | "outPort" | "source" | "sink";

/** Legend glyphs; they echo the map and factory renderers' shapes so meaning never rests on colour alone. */
export function MapSymbol({ kind, size = 32 }: { readonly kind: MapSymbolKind; readonly size?: number }) {
  return (
    <svg className={`map-symbol is-${kind}`} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {kind === "start" && <path d="M16 5 27 24H5z" className="ink-course" strokeWidth="2.5" />}
      {kind === "control" && <><circle cx="14" cy="18" r="9" className="ink-course" strokeWidth="2.5" /><text x="26" y="11" className="map-symbol-number">3</text></>}
      {kind === "finish" && <><circle cx="16" cy="16" r="11" className="ink-course" strokeWidth="2.5" /><circle cx="16" cy="16" r="6.5" className="ink-course" strokeWidth="2.5" /></>}
      {kind === "candidate" && <><path d="M4 27 19 12" className="ink-course" strokeWidth="2.5" strokeDasharray="3 4" /><circle cx="23" cy="8" r="5" className="ink-course" strokeWidth="2.5" /></>}
      {kind === "cure" && <><polygon points={HEX} className="fill-cure" /><path d="M14 9h4v5h5v4h-5v5h-4v-5H9v-4h5z" className="solid-cure" /></>}
      {kind === "sideEffect" && <><polygon points={HEX} className="fill-effect" /><g className="solid-effect"><circle cx="16" cy="16" r="1.8" /><circle cx="16" cy="9.5" r="1.8" /><circle cx="21.6" cy="12.8" r="1.8" /><circle cx="21.6" cy="19.2" r="1.8" /><circle cx="16" cy="22.5" r="1.8" /><circle cx="10.4" cy="19.2" r="1.8" /><circle cx="10.4" cy="12.8" r="1.8" /></g></>}
      {kind === "wall" && <><polygon points={HEX} className="solid-ink" /><path d="M16 3V0M27.3 9.5l2.6-1.5M27.3 22.5l2.6 1.5M16 29v3M4.7 22.5l-2.6 1.5M4.7 9.5 2.1 8" className="ink-ink" strokeWidth="2" /></>}
      {kind === "marsh" && <><polygon points={HEX} className="fill-marsh" /><path d="M7 11h8m3 0h7M6 15h11m3 0h6M6 19h5m3 0h12M7 23h10m3 0h5" className="ink-flow" strokeWidth="1.6" /></>}
      {kind === "abyss" && <><polygon points={HEX} className="fill-abyss" strokeWidth="2.5" /><polygon points="16,10 21.2,13 21.2,19 16,22 10.8,19 10.8,13" className="ink-pit" strokeWidth="1.5" /></>}
      {kind === "portal" && <><polygon points={HEX} className="ink-rule" strokeWidth="1.5" /><rect x="11" y="8" width="10" height="16" className="ink-ink" strokeWidth="2" /><path d="M13 16h6m-2.5-3 3 3-3 3" className="ink-ink" strokeWidth="2" /></>}
      {kind === "belt" && <><path d="M3 16h26" className="ink-flow" strokeWidth="4" /><path d="M10 12l4 4-4 4M19 12l4 4-4 4" className="ink-paper" strokeWidth="1.8" /></>}
      {kind === "source" && <path d="M7 7 26 16 7 25z" className="ink-ink" strokeWidth="2" />}
      {kind === "sink" && <><circle cx="16" cy="16" r="11" className="ink-ink" strokeWidth="2" /><circle cx="16" cy="16" r="6.5" className="ink-ink" strokeWidth="2" /></>}
      {kind === "inPort" && <><polygon points={HEX} className="ink-rule" strokeWidth="1.5" /><rect x="12" y="12" width="8" height="8" className="solid-ink" /></>}
      {kind === "outPort" && <><polygon points={HEX} className="ink-rule" strokeWidth="1.5" /><circle cx="16" cy="16" r="4.5" className="ink-ink" strokeWidth="2.5" /></>}
    </svg>
  );
}

const LEGEND: readonly { readonly group: string; readonly items: readonly (readonly [MapSymbolKind, string, string])[] }[] = [
  { group: "Your course", items: [
    ["start", "Start", "Every run begins here."],
    ["control", "Step", "A machine you ran, numbered in order."],
    ["candidate", "Candidate leg", "Preview of the next step; nothing is spent yet."],
    ["finish", "Finish", "The run reached a Cure and became a formula."],
  ] },
  { group: "Terrain", items: [
    ["cure", "Cure", "A step that ends here cures that disease."],
    ["sideEffect", "Side effect", "Ending here adds a side effect: −$25 per unit sold."],
    ["wall", "Wall", "Skips that move. The only terrain shown through fog."],
    ["marsh", "Marsh", "Entering costs two moves, so the step ends sooner."],
    ["abyss", "Abyss", "A step that enters it fails the run."],
    ["portal", "Portal", "One-way jump to its paired exit; the step continues there."],
  ] },
  { group: "Factory", items: [
    ["source", "Source", "Starts units into the line."],
    ["belt", "Belt", "Carries units the way its chevrons point."],
    ["inPort", "Input port", "Where a machine takes units in."],
    ["outPort", "Output port", "Where a machine sends units out. Hollow ports are not connected."],
    ["sink", "Sink", "Collects finished units into stock."],
  ] },
];

export function FieldGuide() {
  return (
    <section className="help-panel">
      <h1>Field guide</h1>
      <h2>Research</h2>
      <p>Pick a machine to preview its leg, then press <strong>Run · $N</strong> (Enter) or click the hollow control. Each step costs cash and prints the land it crosses. <strong>End run</strong> stops without a refund; the printed map stays.</p>
      <p>A run that ends on a Cure is saved as formula <span className="nowrap">F-01</span>, <span className="nowrap">F-02</span>… in Formulas.</p>
      <h2>Build and ship</h2>
      <p><strong>Plan</strong> is free and has no clock. <strong>Production</strong> is paid and runs; <strong>Commission $N</strong> builds your Plan there. Lay Source → the formula’s steps in order → Sink, with belts from each output port to the next input port.</p>
      <p>Ship stock in Market for cash and Knowledge; each unit lowers that disease’s next price. Ship 3 of a disease to fill its contract. Contracts and Knowledge unlock Technology.</p>
      <h2>Legend</h2>
      {LEGEND.map(({ group, items }) => (
        <section key={group} className="legend-group" aria-label={group}>
          <h3>{group}</h3>
          <dl className="legend-list">
            {items.map(([kind, name, meaning]) => (
              <div key={kind}>
                <dt><MapSymbol kind={kind} />{name}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <h2>Controls</h2>
      <dl className="legend-keys">
        <div><dt><kbd>F1</kbd>–<kbd>F3</kbd></dt><dd>Research · Plan · Production</dd></div>
        <div><dt><kbd>M</kbd> <kbd>T</kbd> <kbd>B</kbd></dt><dd>Market · Technology · Blueprints</dd></div>
        <div><dt><kbd>Enter</kbd></dt><dd>Run the candidate step</dd></div>
        <div><dt><kbd>F</kbd></dt><dd>Find the next control</dd></div>
        <div><dt><kbd>R</kbd> <kbd>Q</kbd></dt><dd>Rotate · pick a tool</dd></div>
        <div><dt><kbd>Space</kbd> <kbd>.</kbd></dt><dd>Play/pause · single tick</dd></div>
        <div><dt><kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd></dt><dd>Undo · redo</dd></div>
        <div><dt><kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd></dt><dd>Copy · cut · paste</dd></div>
        <div><dt><kbd>Ctrl</kbd>+<kbd>S</kbd> · <kbd>Esc</kbd></dt><dd>Save · close</dd></div>
      </dl>
      <p>Drag to pan, scroll to zoom, right-click to erase. Touch: one finger builds or moves; two fingers pan.</p>
    </section>
  );
}
