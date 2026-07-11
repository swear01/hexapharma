# Structure

> 狀態：✅ 已實作｜🔧 進行中｜📋 規劃中。

| Path | 狀態 | Purpose |
|------|------|---------|
| `AGENTS.md` | ✅ | AI agent 硬規則 + docs 指標（薄，base block 由 agents_rule 管理） |
| `docs/` | ✅ | 活文件：design / invariants / module-ownership / decisions + overview/structure/notes/playtest/plan/roadmap |
| `src/sim/phase0_interfaces.ts` | ✅ | 契約與共用常數：Game/analysis work各100,000,000，rewind aggregate 12,000 ticks/8,192 entries/100,000,000，base`9×6`；`sideEffectId` Int32；defaults frozen |
| `src/sim/drug-graph/` | ✅ | 多圖效果引擎：四特徵 / transform union（translate 四關係 順逆垂直偏移 / scale / swap）/ supercover 掃動（牆停·危險即死）/ fog / 最終位置判定 |
| `src/sim/mapgen/` | ✅ | 建構式多圖生成；完整 GenOptions 決定關卡。difficulty price 以 BigInt exact `10×(17/10)^d` rational half-up + `3×refCost`（d0–58 保持舊輸出、非平衡調整）；production 不 import solver |
| `src/sim/solver/` | ✅ | 多圖 BFS 搜尋（**僅 tests/tools 驗證與平衡稽核**，D14） |
| `src/sim/rng/` | ✅ | 自有 seeded PRNG（**唯一隨機來源**，mapgen 也走它） |
| `src/sim/hash.ts` | ✅ | FNV-1a（replay/determinism） |
| `src/sim/state.ts` | ✅ | `hashFactory` / `replayFactory`（live `FactoryRuntime` 走 cold snapshot 後 FNV-1a；交付 INV-15） |
| `src/sim/game.ts` | ✅ | 完整 `GameState` + pure intent reducer；canonical clone/deep-freeze authority inputs；self-declared origin + normalized trace（no-op省略、連續ticks/layout/same-disease sales合併；≤4,096 entries/≤100,000 ticks/≤100,000,000 weighted work）/replay/hash；Game map ≤32 per side/≤1,024 cells、factory ≤256 per side/≤4,096 cells、inventory ≤24,500、bulk ≤100,000；base `9×6 + patent delta` setFactory authority；每個 factoryTicks cold ownership clone；實體成品/銷售、探索/專利與 core-reachability validator |
| `src/sim/replay-work.ts` | ✅ | 從 origin + raw intents 估算 map traversal、factory cold/layout/tick、sales 與 patent/map reset replay work；上限運算不 overflow，供 Game/Save/checkpoint replay-before-work 防護 |
| `src/sim/factory-geom.ts` | ✅ | 共用工廠幾何（純）：`rotateVec` / `worldCells` / `worldInPorts` / `worldOutPorts`——把 PlacedMachine 的 LOCAL shape 依 footRot（CW, y-down）+ anchor 解到世界座標，port side =(localSide+footRot)&3。factory-sim 與 factoryRenderer 同源引用（不再各自重複幾何） |
| `src/sim/factory-sim/` | ✅ | public area≤65,536的fixed SoA runtime，綁layout + `MultiMap` identity；routing/cursors進snapshot/hash/save，成功tick零配置。diagnostics ≤100,000 ticks/≤100,000,000 work，init/tick前驗`(area+machines+sources)²×observationTicks`；throughput真deadlock回`0/1`與null bottleneck。serpentine throughput 20×20成功/21×21拒絕；outcome 20×20成功/22×22拒絕，21×21 outcome仍低於cap |
| `src/sim/recipe/` | ✅ Phase 2 | 模板 → 真實形狀（DEFAULT_SHAPES）+ belt 佈線產線：每步取型別 footprint、正規化 footRot（首個 input port 朝 W）、左→右擺放於 spine、以確定性 BFS（鄰序 E,S,W,N）佈 belt 連 source→m0→…→sink（相鄰口直接交接免 belt）+ 重排驗證（保持朝向+順序 → 效果不變，INV-7） |
| `src/sim/economy/` | ✅ | 各疾病 sold counter 的單品售價遞減、實際成本/副作用結算、銷售取得 R&D、帳務守恆；目前沒有訂單系統 |
| `src/sim/patent/` | ✅ | deep-frozen tree；cash+R&D天賦樹；public helpers拒絕invalid tree/effect/state/cash/research，`activeEffects` factory/reveal aggregates用checked safe-integer add並拒overflow |
| `src/sim/save/` | ✅ | full/compact raw origin+trace preflight；single ≤100,000,000 work。`serializeSlots`/`deserializeSlots`共用12,000 ticks/8,192 entries/100,000,000 aggregate，deserialize在任何`parseGameState`前拒超界；full wire cap 5,000,000 chars |
| `src/render/labRenderer.ts` | ✅ | PixiJS v8 Lab渲染器（只讀sim；2-per-row畫N=2..4圖；preferred cell依N為32/26/22px，再按實際dimensions縮小，Game canvas ≤980×980且default snapshots不變；依`map.fog`畫「?」UNKNOWN；同map identity重用static layers） |
| `src/render/factoryRenderer.ts` | ✅ | PixiJS v8 Factory 渲染器（dumb；直接 indexed 讀 `FactoryRuntime` SoA，畫 belt-grid、機器、bottleneck 與 token；同 immutable layout/bottleneck 重用靜態 layer）。只畫、不跑 sim |
| `src/ui/` | ✅ | viewport game shell、HUD/nav rail/hotbar/inspector/card lattice；Factory direct editor（drag build/erase、touch pan/tap、wheel zoom、pipette、clipboard、50-step history）與純 camera/grid/gesture/history helpers。visited views保留mount，但active guard隔離hotkeys。另含checkpoint同-origin lineage/cross-run replace、compact budgets、legacy recovery與可見錯誤 |
| `src/main.tsx` | ✅ | React 進入點（掛載 `Root` → `Game`） |
| `test/e2e/` | ✅ | Playwright Chromium對dev`:53347`跑完整smoke/regression、game shell／active-key isolation／drag build+erase／clipboard+history／compact responsive reachability、Factory bounded-analysis alert與固定screenshot baseline；production-preview先build、對`:53348`切四view驗dynamic chunks/零runtime errors，另載入2-map最寬與4-map最大32×32 authority驗canvas ≤980×980。Playwright預設headless；`*.spec.ts-snapshots/`是expected images，`__screenshots__/`只是artifact |
| `test/integration/` | ✅ | 跨模組、無畫面（map→recipe→factory，加上economy/patent/save契約）；整局reducer vertical trace在`src/sim/game.test.ts`；checkpointStorage unit tests另守normalized lineage、different-run canonical replacement與mixed-legacy clean recovery |
| `test/tools/` | ✅ | CLI 邊界測試：headless seed 拒 partial/fractional/blank/out-of-uint32 並 canonicalize `-0`；balance count 1..100,000、超限在 loop 前 fail-fast；任一 seed/unknown machine 分析失敗必須 nonzero |
| `tools/headless-sim.ts` | ✅ | CLI 僅有 `gen` / `run`；seed argument 必須完整轉為 uint32 safe integer（`-0`→`0`），不使用會接受 `14junk` 的 partial parser；其他 replay/loop 驗證由 Vitest harness 提供 |
| `tools/balance.ts` | ✅ | 離線難度/價格/吞吐 sweep；count practical cap = 100,000 seeds，invalid/超限在配置 seed loop 前 fail-fast，任何 seed 分析失敗使報告 nonzero |
| `npm run check` | ✅ | 唯一閘（無 `check.sh`；= tsc + lint + vitest + `playwright test`）；e2e webServer 另含 production build + preview smoke，CLI 不加額外 headless flag |

## Module Boundaries

三層架構，**單向資料流**：UI/渲染只「讀 sim 狀態、送 intent」；只有 sim core 在 tick 裡改狀態。

```
UI（React/DOM）  →  只讀 sim + 發 intent
渲染（PixiJS v8）→  只讀 sim、顯式 loop、嚴禁改任何 sim 數值
Sim Core（純 TS）→  tick-based、固定 seed、完全可 headless 測
```

**鐵律**：`src/sim/**` 不得 import 任何 Pixi / React / DOM。這條讓 core 能在 node headless 跑，是平行測試與可逆性的根本。

每個 sim 模組有 typed interface + 各自測試；模組擁有權見 [module-ownership.md](module-ownership.md)。
