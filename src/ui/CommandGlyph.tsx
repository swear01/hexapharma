export type CommandKind = "rotate" | "undo" | "redo" | "play" | "pause" | "step" | "center" | "details" | "trash" | "copy" | "paste";

/** Command icons for the bottom bars, in the same legend ink as the top bar. */
export function CommandGlyph({ kind }: { readonly kind: CommandKind }) {
  return (
    <svg className="command-glyph" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      {kind === "rotate" && <path d="M14.5 9A5.5 5.5 0 1 1 12.4 4.7M12.8 1.8v3.3H9.5" />}
      {kind === "undo" && <path d="M4.5 7.5h7a4 4 0 0 1 0 8H8M7.5 4.5l-3 3 3 3" />}
      {kind === "redo" && <path d="M13.5 7.5h-7a4 4 0 0 0 0 8H10M10.5 4.5l3 3-3 3" />}
      {kind === "play" && <path d="M5 3.5 14 9l-9 5.5z" className="is-filled" />}
      {kind === "pause" && <path d="M5 3.5h2.5v11H5zM10.5 3.5H13v11h-2.5z" className="is-filled" />}
      {kind === "step" && <><path d="M3.5 3.5 11 9l-7.5 5.5z" className="is-filled" /><path d="M14 3.5v11" /></>}
      {kind === "center" && <><circle cx="9" cy="9" r="2" /><path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" /></>}
      {kind === "details" && <path d="M2 2.5h14v13H2zM11 2.5v13M13 6h1M13 9h1M13 12h1" />}
      {kind === "trash" && <path d="M2.5 4.5h13M7 4.5v-2h4v2M4.5 4.5l1 11h7l1-11M7.5 7.5v5M10.5 7.5v5" />}
      {kind === "copy" && <path d="M6.5 6.5h9v9h-9zM11.5 6.5v-4h-9v9h4" />}
      {kind === "paste" && <path d="M6.5 3.5H4v12.5h10V3.5h-2.5M6.5 2h5v3h-5zM7 9.5h4M7 12.5h4" />}
    </svg>
  );
}
