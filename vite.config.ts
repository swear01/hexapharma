import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev + preview bind 0.0.0.0:53346 — the only port whitelisted on Oracle Cloud
// for real-person playtesting. strictPort: fail loudly rather than fall back to a
// port the user can't reach. See AGENTS.md "Playtest 伺服器".
export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", port: 53346, strictPort: true },
  preview: { host: "0.0.0.0", port: 53346, strictPort: true },
});
