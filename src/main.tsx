import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./ui/Root";
import "./ui/game.css";

const el = document.getElementById("root");
if (!el) throw new Error("missing #root element");
createRoot(el).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
