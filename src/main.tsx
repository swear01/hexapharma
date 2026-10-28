import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Game } from "./ui/Game";
import { deleteObsoleteSaves } from "./ui/checkpointStorage";
import "./ui/game.css";
import "./ui/research.css";
import "./ui/factory.css";
import "./ui/panels.css";

try {
  deleteObsoleteSaves(localStorage);
} catch {
  // Unreadable storage is reported when the game reads its slot.
}

const el = document.getElementById("root");
if (!el) throw new Error("missing #root element");
createRoot(el).render(
  <StrictMode>
    <Game />
  </StrictMode>,
);
