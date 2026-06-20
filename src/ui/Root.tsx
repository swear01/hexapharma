/**
 * HexaPharma — top-level view switcher between the Lab (Phase 1) and the
 * Factory (Phase 2). Each view owns its own state + Pixi renderer; switching
 * mounts one or the other. See AGENTS.md layering rule.
 */
import { useState } from "react";
import { App } from "./App";
import { Factory } from "./Factory";

type View = "lab" | "factory";

export function Root() {
  const [view, setView] = useState<View>("lab");

  const tab: React.CSSProperties = {
    padding: "8px 18px",
    border: "1px solid #b8c2cc",
    borderBottom: "none",
    borderRadius: "8px 8px 0 0",
    background: "#eef2f6",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "Arial, sans-serif",
    fontWeight: 600,
    color: "#475260",
  };
  const activeTab: React.CSSProperties = { background: "#fff", color: "#1d6fe0" };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 0, borderBottom: "1px solid #b8c2cc" }}>
        <button
          type="button"
          onClick={() => setView("lab")}
          style={{ ...tab, ...(view === "lab" ? activeTab : {}) }}
          data-testid="view-lab"
        >
          Lab
        </button>
        <button
          type="button"
          onClick={() => setView("factory")}
          style={{ ...tab, ...(view === "factory" ? activeTab : {}) }}
          data-testid="view-factory"
        >
          Factory
        </button>
      </div>
      <div style={{ paddingTop: 16 }}>{view === "lab" ? <App /> : <Factory />}</div>
    </div>
  );
}
