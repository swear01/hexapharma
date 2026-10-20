import { useCallback, useEffect, useRef, useState } from "react";
import type { FactoryLayout } from "../sim/phase0_interfaces";
import {
  MAX_BLUEPRINT_BYTES,
  blueprintFromFactoryLayout,
  materializeFactoryLayout,
} from "../blueprint/format";
import {
  deleteLibraryBlueprint,
  exportLibraryBlueprint,
  importLibraryBlueprint,
  listLibraryBlueprints,
  saveLibraryBlueprint,
  type LibraryBlueprint,
} from "../blueprint/storage";
import { createPortal } from "react-dom";

interface BlueprintLibraryProps {
  readonly pilotLayout: FactoryLayout | null;
  readonly productionLayout: FactoryLayout;
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
  pilotLayout,
  productionLayout,
  onLoadPilot,
  onBuildProduction,
  quoteProduction,
}: BlueprintLibraryProps) {
  const [entries, setEntries] = useState<readonly LibraryBlueprint[]>([]);
  const [name, setName] = useState("Untitled layout");
  const [json, setJson] = useState("");
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryBlueprint | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);

  const closeDeleteConfirmation = useCallback((restoreFocus = true) => {
    setPendingDelete(null);
    if (restoreFocus) window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (pendingDelete === null) return;
    deleteConfirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeDeleteConfirmation();
      } else if (event.key === "Tab") {
        event.preventDefault();
        if (document.activeElement === deleteConfirmRef.current) deleteCancelRef.current?.focus();
        else deleteConfirmRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeDeleteConfirmation, pendingDelete]);

  const refresh = useCallback(async () => {
    try {
      const next = await listLibraryBlueprints(localStorage);
      setEntries(next);
      setLoaded(true);
    } catch (error) {
      setStatus(`Library error: ${message(error)}`);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const loadFactory = useCallback((entry: LibraryBlueprint, destination: "pilot" | "production") => {
    try {
      const layout = materializeFactoryLayout(entry.blueprint);
      const destinationLabel = destination === "pilot" ? "Plan" : "Production";
      const accepted = destination === "pilot" ? onLoadPilot(layout) : onBuildProduction(layout);
      setStatus(accepted
        ? `Loaded “${entry.blueprint.name}” into ${destinationLabel}.`
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

      <section className="panel-section blueprint-capture" aria-label="Save a blueprint">
        <label className="game-field">
          <span>Name</span>
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-testid="blueprint-name" />
        </label>
        <div className="panel-actions">
          <button type="button" disabled={pilotLayout === null} onClick={() => void capturePilot()} data-testid="blueprint-save-pilot">Save Plan</button>
          <button type="button" onClick={() => void captureProduction()} data-testid="blueprint-save-production">Save Production</button>
        </div>
      </section>

      <section className="panel-section blueprint-list" aria-labelledby="blueprint-list-title">
        <div className="panel-heading"><h2 id="blueprint-list-title">Library</h2><span className="blueprint-count">{entries.length}/64</span></div>
        {loaded && entries.length === 0 && (
          <p className="panel-empty">No blueprints yet. Save your Plan or Production above, or import a shared .json file below. The Library is kept across saves and new games.</p>
        )}
        {entries.map((entry) => {
          const factoryLayout = entry.blueprint.kind === "factory-layout"
            ? materializeFactoryLayout(entry.blueprint)
            : null;
          const buildQuote = factoryLayout === null
            ? null
            : factoryBlueprintBuildQuote(productionLayout, factoryLayout, quoteProduction);
          const reasonId = `blueprint-reason-${entry.id}`;
          return <article key={entry.id} className="blueprint-card">
            <div className="blueprint-card-title">
              <strong>{entry.blueprint.name}</strong>
              <span>{entry.blueprint.kind === "research-program"
                ? `Research · ${entry.blueprint.program.steps.length} ${entry.blueprint.program.steps.length === 1 ? "step" : "steps"}`
                : `Factory · ${entry.blueprint.layout.width}×${entry.blueprint.layout.height} · ${entry.blueprint.layout.machines.length} ${entry.blueprint.layout.machines.length === 1 ? "machine" : "machines"}`}</span>
            </div>
            <div className="panel-actions">
              {entry.blueprint.kind === "factory-layout" && (
                <>
                  <button type="button" disabled={buildQuote === null} aria-describedby={buildQuote === null ? reasonId : undefined} onClick={() => loadFactory(entry, "pilot")}>Open in Plan</button>
                  <button type="button" disabled={buildQuote === null} aria-describedby={buildQuote === null ? reasonId : undefined} onClick={() => loadFactory(entry, "production")}>{buildQuote === null ? "Commission" : `Commission $${buildQuote}`}</button>
                </>
              )}
              <button type="button" onClick={() => void exportEntry(entry)}>Download</button>
              <button
                type="button"
                className="blueprint-delete"
                onClick={(event) => {
                  deleteTriggerRef.current = event.currentTarget;
                  setPendingDelete(entry);
                }}
                aria-label={`Delete ${entry.blueprint.name}`}
              >Delete</button>
            </div>
            {buildQuote === null && entry.blueprint.kind === "factory-layout" && (
              <small id={reasonId} className="blueprint-reason">
                Built for a {entry.blueprint.layout.width}×{entry.blueprint.layout.height} floor; Production is {productionLayout.width}×{productionLayout.height}.
              </small>
            )}
          </article>;
        })}
      </section>

      <section className="panel-section blueprint-import" aria-labelledby="blueprint-import-title">
        <h2 id="blueprint-import-title">Import</h2>
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
        <textarea value={json} onChange={(event) => setJson(event.target.value)} placeholder="Paste blueprint JSON" aria-label="Blueprint JSON" data-testid="blueprint-json" />
        <div className="panel-actions">
          <button type="button" disabled={json.trim() === ""} onClick={() => void importJson(json)} data-testid="blueprint-import">Import pasted JSON</button>
          <button type="button" onClick={() => fileRef.current?.click()} data-testid="blueprint-upload">Upload file</button>
        </div>
      </section>
      <output className="blueprint-status" role="status" data-testid="blueprint-status">{status}</output>
      {pendingDelete !== null && createPortal(
        <div
          className="game-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteConfirmation();
          }}
        >
          <section
            className="game-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="blueprint-delete-title"
            aria-describedby="blueprint-delete-warning"
            data-testid="blueprint-delete-confirm"
          >
            <h2 id="blueprint-delete-title">Delete blueprint?</h2>
            <p id="blueprint-delete-warning">
              Permanently remove “{pendingDelete.blueprint.name}” from the cross-save Library.
            </p>
            <div className="modal-actions">
              <button
                ref={deleteCancelRef}
                type="button"
                onClick={() => closeDeleteConfirmation()}
              >Cancel</button>
              <button
                ref={deleteConfirmRef}
                type="button"
                className="danger-action"
                onClick={() => {
                  const entry = pendingDelete;
                  closeDeleteConfirmation(false);
                  void remove(entry);
                }}
              >Delete blueprint</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
