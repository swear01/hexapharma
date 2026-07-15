import { useCallback, useEffect, useRef, useState } from "react";
import type { FactoryLayout, Template } from "../sim/phase0_interfaces";
import {
  MAX_BLUEPRINT_BYTES,
  blueprintFromFactoryLayout,
  blueprintFromProgram,
  materializeFactoryLayout,
  materializeResearchProgram,
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
  readonly researchProgram: Template;
  readonly pilotLayout: FactoryLayout | null;
  readonly productionLayout: FactoryLayout;
  readonly onLoadResearch: (program: Template) => boolean;
  readonly onLoadPilot: (layout: FactoryLayout) => boolean;
  readonly onBuildProduction: (layout: FactoryLayout) => boolean;
  readonly quoteProduction: (layout: FactoryLayout) => number;
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

export function factoryBlueprintBuildQuote(
  production: FactoryLayout,
  proposed: FactoryLayout,
  quote: (layout: FactoryLayout) => number,
): number | null {
  if (
    production.width !== proposed.width ||
    production.height !== proposed.height ||
    production.tiles.length !== proposed.tiles.length
  ) return null;
  return quote(proposed);
}

export function BlueprintLibrary({
  researchProgram,
  pilotLayout,
  productionLayout,
  onLoadResearch,
  onLoadPilot,
  onBuildProduction,
  quoteProduction,
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
      setStatus(next.length === 0 ? "Library is empty." : `${next.length} blueprint(s).`);
    } catch (error) {
      setStatus(`Library error: ${message(error)}`);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const captureResearch = useCallback(async () => {
    if (researchProgram.steps.length === 0) return;
    try {
      const saved = await saveLibraryBlueprint(localStorage, blueprintFromProgram(name, researchProgram));
      await refresh();
      setStatus(`Saved “${saved.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not save blueprint: ${message(error)}`);
    }
  }, [name, refresh, researchProgram]);
  const capturePilot = useCallback(async () => {
    if (pilotLayout === null) return;
    try {
      const saved = await saveLibraryBlueprint(localStorage, blueprintFromFactoryLayout(name, pilotLayout));
      await refresh();
      setStatus(`Saved “${saved.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not save blueprint: ${message(error)}`);
    }
  }, [name, pilotLayout, refresh]);
  const captureProduction = useCallback(async () => {
    try {
      const saved = await saveLibraryBlueprint(
        localStorage,
        blueprintFromFactoryLayout(name, productionLayout),
      );
      await refresh();
      setStatus(`Saved “${saved.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not save blueprint: ${message(error)}`);
    }
  }, [name, productionLayout, refresh]);

  const importJson = useCallback(async (source: string) => {
    try {
      const imported = await importLibraryBlueprint(localStorage, source);
      setJson("");
      await refresh();
      setStatus(`Imported “${imported.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not import blueprint: ${message(error)}`);
    }
  }, [refresh]);

  const loadResearch = useCallback((entry: LibraryBlueprint) => {
    try {
      const accepted = onLoadResearch(materializeResearchProgram(entry.blueprint));
      setStatus(accepted
        ? `Loaded “${entry.blueprint.name}” into Research.`
        : `Could not load “${entry.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not materialize blueprint: ${message(error)}`);
    }
  }, [onLoadResearch]);
  const loadFactory = useCallback((entry: LibraryBlueprint, destination: "pilot" | "production") => {
    try {
      const layout = materializeFactoryLayout(entry.blueprint);
      const accepted = destination === "pilot" ? onLoadPilot(layout) : onBuildProduction(layout);
      setStatus(accepted
        ? `Loaded “${entry.blueprint.name}” into ${destination === "pilot" ? "Pilot" : "Production"}.`
        : `Could not load “${entry.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not materialize blueprint: ${message(error)}`);
    }
  }, [onBuildProduction, onLoadPilot]);

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
      await refresh();
      setStatus(`Deleted “${entry.blueprint.name}”.`);
    } catch (error) {
      setStatus(`Could not delete blueprint: ${message(error)}`);
    }
  }, [refresh]);

  return (
    <div className="blueprint-library" data-testid="blueprint-library">
      <h1>Blueprints</h1>

      <section className="panel-section blueprint-capture">
        <h2>Save</h2>
        <label>
          <span>Name</span>
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-testid="blueprint-name" />
        </label>
        <div className="panel-actions">
          <button type="button" disabled={researchProgram.steps.length === 0} onClick={() => void captureResearch()} data-testid="blueprint-save-research">Save Research program</button>
          <button type="button" disabled={pilotLayout === null} onClick={() => void capturePilot()} data-testid="blueprint-save-pilot">Save Pilot</button>
          <button type="button" onClick={() => void captureProduction()} data-testid="blueprint-save-production">Save Production</button>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-heading"><h2>Import</h2><span>{entries.length}/64</span></div>
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
        {entries.map((entry) => {
          const factoryLayout = entry.blueprint.kind === "factory-layout"
            ? materializeFactoryLayout(entry.blueprint)
            : null;
          const buildQuote = factoryLayout === null
            ? null
            : factoryBlueprintBuildQuote(productionLayout, factoryLayout, quoteProduction);
          return <article key={entry.id} className="blueprint-card">
            <div>
              <strong>{entry.blueprint.name}</strong>
              <span>{entry.blueprint.kind === "research-program" ? "Research" : "Factory"}</span>
              <small>{entry.blueprint.kind === "research-program"
                ? `${entry.blueprint.program.steps.length} paths`
                : `${entry.blueprint.layout.width}×${entry.blueprint.layout.height} · ${entry.blueprint.layout.machines.length} machines`}</small>
            </div>
            <div className="panel-actions">
              {entry.blueprint.kind === "research-program" ? (
                <button type="button" onClick={() => loadResearch(entry)}>Load in Research</button>
              ) : (
                <>
                  <button type="button" disabled={buildQuote === null} onClick={() => loadFactory(entry, "pilot")}>Open in Pilot</button>
                  <button type="button" disabled={buildQuote === null} onClick={() => loadFactory(entry, "production")}>{buildQuote === null ? "Build unavailable" : `Build $${buildQuote}`}</button>
                </>
              )}
              <button type="button" onClick={() => void exportEntry(entry)}>Download</button>
              <button type="button" onClick={() => void remove(entry)} aria-label={`Delete ${entry.blueprint.name}`}>×</button>
            </div>
          </article>;
        })}
      </section>
      <output className="blueprint-status" role="status" data-testid="blueprint-status">{status}</output>
    </div>
  );
}
