const HEX = "16,3 27.3,9.5 27.3,22.5 16,29 4.7,22.5 4.7,9.5";

export type MapSymbolKind =
  | "start" | "control" | "finish" | "candidate" | "cure" | "sideEffect"
  | "premium" | "contour" | "wall" | "marsh" | "abyss" | "belt" | "inPort" | "outPort" | "source" | "sink";

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
      {kind === "premium" && <><polygon points={HEX} className="fill-cure" /><path d="M16 8.5l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z" className="solid-cure" /></>}
      {kind === "contour" && <path d="M5 21c4-7 9 1 13-5s7-4 9-2M5 26c5-5 10 1 15-3s5-2 7-1M8 13c3-4 7-3 9-6" className="ink-contour" strokeWidth="1.6" />}
      {kind === "wall" && <polygon points={HEX} className="fill-mountain" strokeWidth="1.5" />}
      {kind === "marsh" && <><polygon points={HEX} className="fill-marsh" /><path d="M7 11h8m3 0h7M6 15h11m3 0h6M6 19h5m3 0h12M7 23h10m3 0h5" className="ink-flow" strokeWidth="1.6" /></>}
      {kind === "abyss" && <><polygon points={HEX} className="solid-ink" /><path d="M16 3V0M27.3 9.5l2.6-1.5M27.3 22.5l2.6 1.5M16 29v3M4.7 22.5l-2.6 1.5M4.7 9.5 2.1 8" className="ink-ink" strokeWidth="2" /></>}
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
    ["control", "Step", "A planned machine, numbered in order. Click the last one to remove it."],
    ["candidate", "Planned route", "Predicted on the known map; fog counts as flat ground."],
    ["finish", "Finish", "The run reached a Cure."],
  ] },
  { group: "Terrain", items: [
    ["cure", "Cure", "A step that ends here cures that disease."],
    ["premium", "★ Cure", "Ending here sells for 1.5× the price."],
    ["sideEffect", "Side effect", "Ending here adds a side effect: −$25 per unit sold."],
    ["contour", "Contours", "Seen through fog: something rises or sinks there. Mountain and water look alike."],
    ["wall", "Mountain", "Skips that move. Hidden under fog: your plan may cross it until a Run hits it."],
    ["marsh", "Water", "Each move inside goes only half a cell."],
    ["abyss", "Black ground", "A step that enters it fails the run."],
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
      <p>Click machines (or press 1–9) to plan a route; each machine turns the drug, so later paths rotate. <strong>Run · $N</strong> (Enter) pays once and runs the whole route on the real map, which can differ under fog. The solid line is what happened; only that land is revealed.</p>
      <p>Backspace or <kbd>Ctrl</kbd>+<kbd>Z</kbd> removes the last step; <strong>Clear</strong> empties the plan.</p>
      <h2>Build and ship</h2>
      <p><strong>Plan</strong> is free and has no clock. <strong>Production</strong> is paid and runs; <strong>Commission $N</strong> builds your Plan there. Lay Source → your route’s machines in order → Sink, with belts from each output port to the next input port.</p>
      <p>Ship stock in Market for cash; each unit lowers that disease’s next price. Ship 3 of a disease to fill its contract.</p>
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
        <div><dt><kbd>Enter</kbd></dt><dd>Run the planned route</dd></div>
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
