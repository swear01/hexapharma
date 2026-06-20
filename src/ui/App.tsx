/**
 * HexaPharma — the Lab (Phase 1 minimal visual).
 *
 * React owns all state: the template the player is building, the computed drug
 * states (via the sim functions), and the revealed MultiMap. It hands plain sim
 * state to the dumb PixiJS renderer (src/render). NO sweep/evaluate logic lives
 * here — we only CALL the sim. See AGENTS.md layering rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MultiMap,
  DrugState,
  Machine,
  Template,
  Outcome,
  Rotation,
  Orientation,
  MachineCatalogEntry,
  Transform,
} from "../sim/phase0_interfaces";
import { applyStep, evaluate, revealAlong } from "../sim/drug-graph";
import { createLabRenderer, type LabRenderer } from "../render/labRenderer";
import { mm, start, targets, catalog } from "../fixtures/sampleLevel";

// ───────────────────────────── helpers (display only) ─────────────────────────────

const ROT_LABEL: Record<Rotation, string> = { 0: "0°", 1: "90°", 2: "180°", 3: "270°" };

function isOrientableTranslate(entry: MachineCatalogEntry): boolean {
  return entry.transform.kind === "translate" && entry.orientable;
}

/** Short human label for a transform kind (palette + template list). */
function transformLabel(t: Transform): string {
  if (t.kind === "translate") return `translate ${t.relation} (${t.delta.x},${t.delta.y})`;
  if (t.kind === "scale") return `scale ${t.num}/${t.den}`;
  return `swap ${t.a}↔${t.b}`;
}

/** One template step, described for the ordered list. */
function stepLabel(m: Machine): string {
  const base = transformLabel(m.transform);
  if (m.transform.kind === "translate") {
    return `${m.typeId} · ${base} · rot ${ROT_LABEL[m.orientation.rot]}${m.orientation.flip ? " · flip" : ""}`;
  }
  return `${m.typeId} · ${base}`;
}

// ───────────────────────────── outcome banner ─────────────────────────────

function outcomeText(outcome: Outcome | null, won: boolean): string {
  if (outcome === null) return "Build a template, then press Run.";
  if (outcome.failed) return "FAILED — the drug hit a hazard and spoiled.";
  if (won) return `WIN! All target diseases cured: [${[...outcome.cured].sort((a, b) => a - b).join(", ")}].`;
  const cured = outcome.cured.length ? `cured [${outcome.cured.join(", ")}]` : "cured nothing";
  const se = outcome.sideEffects.length ? `, side-effects [${outcome.sideEffects.join(", ")}]` : "";
  return `Run complete: ${cured}${se}. Not all targets cured yet.`;
}

// ───────────────────────────── component ─────────────────────────────

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);

  // Player-built recipe.
  const [steps, setSteps] = useState<readonly Machine[]>([]);
  // Pending orientation for the NEXT orientable translate machine added.
  const [rot, setRot] = useState<Rotation>(0);
  const [flip, setFlip] = useState<boolean>(false);

  // What the renderer currently shows.
  const [shownMap, setShownMap] = useState<MultiMap>(mm);
  const [shownDrug, setShownDrug] = useState<DrugState>(start);

  // Result of the last Run.
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState<boolean>(false);

  const won = useMemo(() => {
    if (outcome === null || outcome.failed) return false;
    const cured = new Set(outcome.cured);
    return targets.every((t) => cured.has(t));
  }, [outcome]);

  // Cancel token so a Reset (or unmount) stops an in-flight animation.
  const runIdRef = useRef(0);

  // ── mount / unmount the Pixi renderer ─────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let local: LabRenderer | null = null;
    void (async () => {
      const r = await createLabRenderer(mm);
      if (disposed) {
        r.destroy();
        return;
      }
      local = r;
      rendererRef.current = r;
      if (mountRef.current) mountRef.current.appendChild(r.canvas);
      r.render(mm, start);
    })();
    return () => {
      disposed = true;
      runIdRef.current++; // cancel any running animation
      rendererRef.current = null;
      if (local) local.destroy();
    };
  }, []);

  // ── repaint whenever shown state changes ──────────────────────────────────
  useEffect(() => {
    rendererRef.current?.render(shownMap, shownDrug);
  }, [shownMap, shownDrug]);

  // ── palette / template editing ────────────────────────────────────────────
  const addMachine = useCallback(
    (entry: MachineCatalogEntry) => {
      if (running) return;
      const orientation: Orientation = isOrientableTranslate(entry)
        ? { rot, flip }
        : { rot: 0, flip: false };
      const machine: Machine = {
        typeId: entry.typeId,
        transform: entry.transform,
        orientation,
      };
      setSteps((s) => [...s, machine]);
    },
    [running, rot, flip],
  );

  const removeLast = useCallback(() => {
    if (running) return;
    setSteps((s) => s.slice(0, -1));
  }, [running]);

  const clearTemplate = useCallback(() => {
    if (running) return;
    setSteps([]);
  }, [running]);

  // ── Run: reveal fog, animate the drug across BOTH maps, then evaluate ──────
  const run = useCallback(() => {
    if (running || steps.length === 0) return;
    setRunning(true);
    setOutcome(null);

    const t: Template = { steps };
    // Reveal fog along every sweep path (sim does the work).
    const revealed = revealAlong(mm, start, t);
    setShownMap(revealed);
    setShownDrug(start);

    // Precompute the per-step drug states by folding applyStep (sim only).
    const frames: DrugState[] = [start];
    let s = start;
    for (const m of steps) {
      s = applyStep(mm, s, m);
      frames.push(s);
    }

    const myRun = ++runIdRef.current;
    let k = 0;
    const tick = () => {
      if (runIdRef.current !== myRun) return; // cancelled by reset/unmount
      k++;
      const frame = frames[k];
      if (frame !== undefined) setShownDrug(frame);
      if (k < frames.length - 1) {
        window.setTimeout(tick, 260);
      } else {
        setOutcome(evaluate(mm, start, t));
        setRunning(false);
      }
    };
    window.setTimeout(tick, 260);
  }, [running, steps]);

  // ── Reset: back to start, fog restored, empty template ────────────────────
  const reset = useCallback(() => {
    runIdRef.current++; // cancel any in-flight animation
    setRunning(false);
    setSteps([]);
    setRot(0);
    setFlip(false);
    setOutcome(null);
    setShownMap(mm);
    setShownDrug(start);
  }, []);

  // ───────────────────────────── render ─────────────────────────────

  const btn: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #b8c2cc",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };
  const sectionTitle: React.CSSProperties = { margin: "0 0 6px", fontSize: 14, color: "#475260" };

  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        color: "#1d242c",
        maxWidth: 980,
        margin: "0 auto",
        padding: 16,
      }}
    >
      <h1 style={{ margin: "0 0 4px" }}>HexaPharma Lab</h1>
      <p style={{ margin: "0 0 14px", color: "#5a6470" }}>
        Place machines into a template, then Run to sweep the drug across both effect
        maps. Cure all targets ({targets.join(", ")}) to win.
      </p>

      {/* canvas */}
      <div
        ref={mountRef}
        data-testid="lab-canvas"
        style={{
          display: "inline-block",
          border: "1px solid #d4dce4",
          borderRadius: 8,
          overflow: "hidden",
          lineHeight: 0,
        }}
      />

      {/* status / outcome */}
      <div
        data-testid="status"
        role="status"
        style={{
          margin: "12px 0",
          padding: "10px 12px",
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          background: outcome?.failed ? "#fdeaea" : won ? "#e7f7ef" : "#eef2f6",
          color: outcome?.failed ? "#a11d1d" : won ? "#15724a" : "#3a4450",
          border: `1px solid ${outcome?.failed ? "#f3c4c4" : won ? "#bce6d2" : "#d9e0e7"}`,
        }}
      >
        {outcomeText(outcome, won)}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* palette */}
        <div style={{ flex: "1 1 320px" }}>
          <h2 style={sectionTitle}>Machine palette</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {catalog.map((entry) => (
              <button
                key={entry.typeId}
                type="button"
                onClick={() => addMachine(entry)}
                disabled={running}
                style={btn}
                title={transformLabel(entry.transform)}
                data-testid={`palette-${entry.typeId}`}
              >
                + {entry.typeId}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <h2 style={sectionTitle}>Orientation (for orientable translate machines)</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => setRot((r) => ((r + 1) % 4) as Rotation)}
                disabled={running}
                style={btn}
                data-testid="rotate"
              >
                Rotate ↻ ({ROT_LABEL[rot]})
              </button>
              <button
                type="button"
                onClick={() => setFlip((f) => !f)}
                disabled={running}
                style={{ ...btn, background: flip ? "#e7f0ff" : "#fff" }}
                data-testid="flip"
              >
                Flip: {flip ? "on" : "off"}
              </button>
            </div>
          </div>
        </div>

        {/* template */}
        <div style={{ flex: "1 1 320px" }}>
          <h2 style={sectionTitle}>Template ({steps.length} step{steps.length === 1 ? "" : "s"})</h2>
          <ol
            data-testid="template-list"
            style={{
              margin: 0,
              paddingLeft: 22,
              minHeight: 60,
              maxHeight: 180,
              overflowY: "auto",
              fontSize: 13,
              border: "1px solid #e1e7ed",
              borderRadius: 6,
              padding: "8px 8px 8px 28px",
              background: "#fafcfe",
            }}
          >
            {steps.length === 0 ? (
              <li style={{ listStyle: "none", marginLeft: -16, color: "#8a94a0" }}>
                (empty — add machines from the palette)
              </li>
            ) : (
              steps.map((m, i) => <li key={i}>{stepLabel(m)}</li>)
            )}
          </ol>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={removeLast}
              disabled={running || steps.length === 0}
              style={btn}
              data-testid="remove-last"
            >
              Remove last
            </button>
            <button
              type="button"
              onClick={clearTemplate}
              disabled={running || steps.length === 0}
              style={btn}
              data-testid="clear"
            >
              Clear
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={run}
              disabled={running || steps.length === 0}
              style={{
                ...btn,
                background: "#1d6fe0",
                color: "#fff",
                borderColor: "#1862c6",
                fontWeight: 700,
                padding: "8px 18px",
              }}
              data-testid="run"
            >
              {running ? "Running…" : "Run"}
            </button>
            <button
              type="button"
              onClick={reset}
              style={{ ...btn, padding: "8px 18px" }}
              data-testid="reset"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
