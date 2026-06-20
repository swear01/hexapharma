# Structure

> 目標骨架（程式碼尚未 scaffold；Phase 0 開工時建立 `src/`、`package.json` 等）。

| Path | Purpose |
|------|---------|
| `AGENTS.md` | AI agent 硬規則 + docs 指標（薄，base block 由 agents_rule 管理） |
| `docs/` | 活文件：design / invariants / module-ownership / decisions + overview/structure/notes/plan/roadmap |
| `src/sim/` | ★ 純 TS、零渲染依賴、可 headless ★ — 遊戲心臟與唯一可驗證單元 |
| `src/sim/drug-graph/` | 多圖效果引擎：正方格四特徵 / 機器 transform union / 逐格掃動（牆停·危險即死）/ fog / 最終位置判定 |
| `src/sim/mapgen/` | 建構式多圖生成（構造解→長特徵）+ 逐位置難度評分（種子決定）+ 基礎藥價 |
| `src/sim/solver/` | 多圖空間搜尋合法藥方（**僅難度評分 + AI 測試**） |
| `src/sim/factory-sim/` | belt / machine（cost·速度）/ tick / bottleneck |
| `src/sim/recipe/` | 模板 ↔ 產線轉換 + 重排驗證（保持朝向+順序 → 效果不變） |
| `src/sim/economy/` | 訂單/庫存/結算 + 難度分→基礎藥價 + 反退化 |
| `src/sim/patent/` | 天賦樹（含解鎖新成分地圖） |
| `src/sim/save/` | 序列化/反序列化（多存檔 + 回溯） |
| `src/sim/rng/` | 自有 seeded PRNG（**唯一隨機來源**，mapgen 也走它） |
| `src/sim/state.ts` | `SimState` / `step` / `hash` / `replay` |
| `src/render/` | PixiJS v8，只讀 sim、顯式 loop（平面俯視，多圖並列） |
| `src/ui/` | React 疊 canvas（Lab / Factory / Shop / 選單） |
| `src/main.ts` | 組裝三層 |
| `test/integration/` | 跨模組、無畫面（模板→產線→結算） |
| `test/e2e/` | Playwright headless + 截圖快照（`__screenshots__/` 為 baseline，須提交） |
| `test/fixtures/` | 共用 seed / input trace |
| `tools/headless-sim.ts` | CLI：跑模擬 / 印吞吐 / replay / mapgen+solver 批次驗證 |

## Module Boundaries

三層架構，**單向資料流**：UI/渲染只「讀 sim 狀態、送 intent」；只有 sim core 在 tick 裡改狀態。

```
UI（React/DOM）  →  只讀 sim + 發 intent
渲染（PixiJS v8）→  只讀 sim、顯式 loop、嚴禁改任何 sim 數值
Sim Core（純 TS）→  tick-based、固定 seed、完全可 headless 測
```

**鐵律**：`src/sim/**` 不得 import 任何 Pixi / React / DOM。這條讓 core 能在 node headless 跑，是平行測試與可逆性的根本。

每個 sim 模組有 typed interface + 各自測試；模組擁有權見 [module-ownership.md](module-ownership.md)。
