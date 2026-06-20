# Structure

> 狀態：✅ 已實作｜🔧 進行中（Phase 1/2/3）｜📋 規劃中。

| Path | 狀態 | Purpose |
|------|------|---------|
| `AGENTS.md` | ✅ | AI agent 硬規則 + docs 指標（薄，base block 由 agents_rule 管理） |
| `docs/` | ✅ | 活文件：design / invariants / module-ownership / decisions + overview/structure/notes/plan/roadmap |
| `src/sim/phase0_interfaces.ts` | ✅ | 凍結契約：所有跨模組型別 + 函式簽名 + INV 清單 + `DEFAULT_CATALOG` |
| `src/sim/drug-graph/` | ✅ | 多圖效果引擎：四特徵 / transform union（translate 四關係 順逆垂直偏移 / scale / swap）/ supercover 掃動（牆停·危險即死）/ fog / 最終位置判定 |
| `src/sim/mapgen/` | ✅ | 建構式多圖生成 + 難度評分（種子決定）+ 基礎藥價 |
| `src/sim/solver/` | ✅ | 多圖 BFS 搜尋（**僅難度評分 + AI 測試**，D14） |
| `src/sim/rng/` | ✅ | 自有 seeded PRNG（**唯一隨機來源**，mapgen 也走它） |
| `src/sim/hash.ts` | ✅ | FNV-1a（replay/determinism；完整 `state.ts` 在 Phase 2 補上） |
| `src/sim/state.ts` | 🔧 Phase 2 | `SimState` / `step` / `hash` / `replay`（隨 factory tick loop 一起做，交付 INV-15） |
| `src/sim/factory-sim/` | 🔧 Phase 2 | belt / machine（cost·速度·形狀·口）/ tick / throughput / bottleneck·deadlock |
| `src/sim/recipe/` | 🔧 Phase 2 | 模板 ↔ 產線轉換 + 重排驗證（保持朝向+順序 → 效果不變） |
| `src/sim/economy/` | 📋 Phase 3 | 訂單/庫存/結算 + 難度分→基礎藥價 + 反退化 |
| `src/sim/patent/` | 📋 Phase 3 | 天賦樹（含解鎖新成分地圖） |
| `src/sim/save/` | 📋 Phase 3 | 序列化/反序列化（多存檔 + 回溯） |
| `src/render/labRenderer.ts` | ✅ | PixiJS v8 Lab 渲染器（只讀 sim、並列畫多圖）。Factory/Shop 渲染 Phase 2/3 補 |
| `src/ui/` | ✅/🔧 | React：`App.tsx` Lab（✅）；Factory / Shop / Patents / 選單（Phase 2/3） |
| `src/fixtures/` | ✅ | 給 render/UI 用的關卡 fixture（可解性以 solver 驗證） |
| `src/main.tsx` | ✅ | React 進入點（掛載 `App`） |
| `test/e2e/` | ✅ | Playwright headless + 截圖（`__screenshots__/` 為輸出 artifact，已 gitignore；未來 toHaveScreenshot baseline 才提交） |
| `test/integration/` | 📋 Phase 2+ | 跨模組、無畫面（模板→產線→結算） |
| `tools/headless-sim.ts` | ✅ | CLI：`gen`/`run`（Phase 2 加 factory/replay/loop） |
| `npm run check` | ✅ | 唯一閘（無 `check.sh`；= tsc + lint + vitest + e2e） |

## Module Boundaries

三層架構，**單向資料流**：UI/渲染只「讀 sim 狀態、送 intent」；只有 sim core 在 tick 裡改狀態。

```
UI（React/DOM）  →  只讀 sim + 發 intent
渲染（PixiJS v8）→  只讀 sim、顯式 loop、嚴禁改任何 sim 數值
Sim Core（純 TS）→  tick-based、固定 seed、完全可 headless 測
```

**鐵律**：`src/sim/**` 不得 import 任何 Pixi / React / DOM。這條讓 core 能在 node headless 跑，是平行測試與可逆性的根本。

每個 sim 模組有 typed interface + 各自測試；模組擁有權見 [module-ownership.md](module-ownership.md)。
