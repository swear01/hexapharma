import { useCallback, useEffect, useRef, useState } from "react";
import type { FactoryLayout } from "../sim/phase0_interfaces";
import {
  MAX_BLUEPRINT_BYTES,
  blueprintFromLayout,
  materializeBlueprint,
  type BlueprintKind,
} from "../blueprint/format";
import {
  deleteLibraryBlueprint,
  exportLibraryBlueprint,
  importLibraryBlueprint,
  listLibraryBlueprints,
  saveLibraryBlueprint,
  type LibraryBlueprint,
} from "../blueprint/storage";

interface BlueprintLibraryProps {
  readonly researchLayout: FactoryLayout | null;
  readonly pilotLayout: FactoryLayout | null;
  readonly onLoadResearch: (layout: FactoryLayout) => boolean;
  readonly onLoadPilot: (layout: FactoryLayout) => boolean;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readBlueprintUpload(
  file: Pick<File, "size" | "text">,
): Promise<string> {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_BLUEPRINT_BYTES) {
    throw new Error(`Blueprint file exceeds ${MAX_BLUEPRINT_BYTES} bytes`);
  }
  return file.text();
}

export function BlueprintLibrary({
  researchLayout,
  pilotLayout,
  onLoadResearch,
  onLoadPilot,
}: BlueprintLibraryProps) {
  const [entries, setEntries] = useState<readonly LibraryBlueprint[]>([]);
  const [name, setName] = useState("Untitled layout");
  const [json, setJson] = useState("");
  const [status, setStatus] = useState("Loading library…");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listLibraryBlueprints(localStorage);
      setEntries(next);
      setStatus(next.length === 0 ? "Library is empty." : `${next.length} portable blueprint(s).`);
    } catch (error) {
      setStatus(`Library error: ${message(error)}`);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capture = useCallback(async (kind: BlueprintKind, layout: FactoryLayout | null) => {
    if (layout === null) return;
    try {
      const saved = await saveLibraryBlueprint(localStorage, blueprintFromLayout(kind, name, layout));
      setStatus(`Saved “${saved.blueprint.name}” to the cross-save library.`);
      await refresh();
    } catch (error) {
      setStatus(`Could not save blueprint: ${message(error)}`);
    }
  }, [name, refresh]);

  const importJson = useCallback(async (source: string) => {
    try {
      const imported = await importLibraryBlueprint(localStorage, source);
      setJson("");
      setStatus(`Imported “${imported.blueprint.name}”.`);
      await refresh();
    } catch (error) {
      setStatus(`Could not import blueprint: ${message(error)}`);
    }
  }, [refresh]);

  const apply = useCallback((entry: LibraryBlueprint) => {
    try {
      const layout = materializeBlueprint(entry.blueprint);
      const accepted = entry.blueprint.kind === "research-route"
        ? onLoadResearch(layout)
        : onLoadPilot(layout);
      setStatus(accepted
        ? `Loaded “${entry.blueprint.name}” into ${entry.blueprint.kind === "research-route" ? "Research" : "Pilot Plant"}.`
        : `Could not load “${entry.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not materialize blueprint: ${message(error)}`);
    }
  }, [onLoadPilot, onLoadResearch]);

  const exportEntry = useCallback(async (entry: LibraryBlueprint) => {
    try {
      const document = await exportLibraryBlueprint(localStorage, entry.id);
      setJson(document);
      const url = URL.createObjectURL(new Blob([document], { type: "application/json" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${entry.blueprint.name.replace(/[^a-z0-9_-]+/giu, "-") || "blueprint"}.hexapharma.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus(`Exported “${entry.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not export blueprint: ${message(error)}`);
    }
  }, []);

  const remove = useCallback(async (entry: LibraryBlueprint) => {
    try {
      await deleteLibraryBlueprint(localStorage, entry.id);
      setStatus(`Deleted “${entry.blueprint.name}”.`);
      await refresh();
    } catch (error) {
      setStatus(`Could not delete blueprint: ${message(error)}`);
    }
  }, [refresh]);

  return (
    <div className="blueprint-library" data-testid="blueprint-library">
      <div className="panel-kicker">Cross-save · portable v1</div>
      <h1>Blueprint Library</h1>
      <p>Blueprints are separate from save slots. JSON files contain layout data only—no seed, fog, cash, inventory, or patents.</p>

      <section className="panel-section blueprint-capture">
        <h2>Capture current floor</h2>
        <label>
          <span>Name</span>
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-testid="blueprint-name" />
        </label>
        <div className="panel-actions">
          <button type="button" disabled={researchLayout === null} onClick={() => void capture("research-route", researchLayout)} data-testid="blueprint-save-research">Save Research route</button>
          <button type="button" disabled={pilotLayout === null} onClick={() => void capture("pilot-plant", pilotLayout)} data-testid="blueprint-save-pilot">Save Pilot Plant</button>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-heading"><h2>Portable JSON</h2><span>{entries.length}/64</span></div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          data-testid="blueprint-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void readBlueprintUpload(file).then(importJson, (error: unknown) => {
              setStatus(`Could not read blueprint file: ${message(error)}`);
            });
            event.target.value = "";
          }}
        />
        <div className="panel-actions">
          <button type="button" onClick={() => fileRef.current?.click()} data-testid="blueprint-upload">Upload JSON</button>
          <button type="button" disabled={json.trim() === ""} onClick={() => void importJson(json)} data-testid="blueprint-import">Import pasted JSON</button>
        </div>
        <textarea value={json} onChange={(event) => setJson(event.target.value)} placeholder="Paste or inspect a versioned blueprint document" data-testid="blueprint-json" />
      </section>

      <section className="blueprint-list" aria-label="Saved blueprints">
        {entries.map((entry) => (
          <article key={entry.id} className="blueprint-card">
            <div>
              <strong>{entry.blueprint.name}</strong>
              <span>{entry.blueprint.kind === "research-route" ? "Research route" : "Pilot Plant"}</span>
              <small>{entry.blueprint.layout.width}×{entry.blueprint.layout.height} · {entry.blueprint.layout.machines.length} machines</small>
            </div>
            <div className="panel-actions">
              <button type="button" onClick={() => apply(entry)}>Load</button>
              <button type="button" onClick={() => void exportEntry(entry)}>Download</button>
              <button type="button" onClick={() => void remove(entry)} aria-label={`Delete ${entry.blueprint.name}`}>×</button>
            </div>
          </article>
        ))}
      </section>
      <output className="blueprint-status" role="status" data-testid="blueprint-status">{status}</output>
    </div>
  );
}
