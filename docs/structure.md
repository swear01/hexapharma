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
| `src/sim/hash.ts` | ✅ | FNV-1a（replay/determinism） |
| `src/sim/state.ts` | ✅ | `hashFactory` / `replayFactory`（FNV-1a over FactoryState；init+step 組合；交付 INV-15） |
| `src/sim/factory-geom.ts` | ✅ | 共用工廠幾何（純）：`rotateVec` / `worldCells` / `worldInPorts` / `worldOutPorts`——把 PlacedMachine 的 LOCAL shape 依 footRot（CW, y-down）+ anchor 解到世界座標，port side =(localSide+footRot)&3。factory-sim 與 factoryRenderer 同源引用（不再各自重複幾何） |
| `src/sim/factory-sim/` | ✅ | belt / machine（cost·速度·口）/ tick（process→move→emit→deadlock）/ throughput / bottleneck·deadlock。機器世界幾何走 `factory-geom` |
| `src/sim/recipe/` | ✅ Phase 2 | 模板 → 真實形狀（DEFAULT_SHAPES）+ belt 佈線產線：每步取型別 footprint、正規化 footRot（首個 input port 朝 W）、左→右擺放於 spine、以確定性 BFS（鄰序 E,S,W,N）佈 belt 連 source→m0→…→sink（相鄰口直接交接免 belt）+ 重排驗證（保持朝向+順序 → 效果不變，INV-7） |
| `src/sim/economy/` | 📋 Phase 3 | 訂單/庫存/結算 + 難度分→基礎藥價 + 反退化 |
| `src/sim/patent/` | 📋 Phase 3 | 天賦樹（含解鎖新成分地圖） |
| `src/sim/save/` | 📋 Phase 3 | 序列化/反序列化（多存檔 + 回溯） |
| `src/render/labRenderer.ts` | ✅ | PixiJS v8 Lab 渲染器（只讀 sim；以 2-per-row grid 並列畫 N=2..4 圖、按 N 縮小格子；依 `map.fog` 把未揭露格畫成「?」UNKNOWN） |
| `src/render/factoryRenderer.ts` | ✅ | PixiJS v8 Factory 渲染器（dumb；畫 belt-grid tiles + splitter/merger、`layout.machines` 多格機器 footprint（footRot 旋轉、in/out port 標記、bottleneck 紅框）、Unit token）。只畫、不跑 sim |
| `src/ui/` | ✅ | React 遊戲迴圈：`Game.tsx` 持有單一共享遊戲狀態（genOptions/level、economy、patents、recipe、factory、inventory、**每圖 persistent fog**）並切換分頁 Lab｜Factory｜Shop｜Patents + 常駐 Cash/Save/Load 列；Game 負責累積探索（union `revealAlong` 結果）、`reveal-aid`（各圖 start 周圍揭半徑）與 `new-map`（`nMaps=min(4,+1)`、縮圖、重置產線+新霧、保留 cash/patents）；起始 N 可用 `?nmaps=`／`?seed=` 覆蓋。`App.tsx`（Lab，受控於 `level`+fog，cure≥1 目標可「Save recipe → Factory」；未揭露畫「?」、Run 揭霧、Reset 保留探索、Reveal-all debug 開關）、`Factory.tsx`（受控；預設 recipe→`compileTemplate` 產線，可放置多格機器（footRot 旋轉）+ belt/splitter/merger/source/sink 編輯、single/parallel 預設、Play/Step/Reset 跑 `stepFactory`、`analyzeThroughput` 顯示吞吐/瓶頸、產出回報 inventory）、`Shop.tsx`（呼叫 economy `sellUnit`/`nextUnitPrice` 賣藥）、`Patents.tsx`（呼叫 patent `unlockPatent`/`activeEffects`，new-map 重生較深關卡）。所有 UI 只呼叫 sim、不重做 sim 邏輯 |
| `src/main.tsx` | ✅ | React 進入點（掛載 `Root` → `Game`） |
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
