# Structure

> 狀態：✅ 已實作｜🔧 進行中｜📋 規劃中。

| Path | 狀態 | Purpose |
|------|------|---------|
| `AGENTS.md` | ✅ | AI agent 硬規則 + docs 指標（薄，base block 由 agents_rule 管理） |
| `docs/` | ✅ | 活文件：design / invariants / module-ownership / decisions / development-policy + overview/structure/notes/playtest/plan/roadmap |
| `src/sim/phase0_interfaces.ts` | ✅ | 契約與共用常數：Game/analysis work各100,000,000，rewind aggregate 12,000 ticks/8,192 entries/100,000,000，base`24×12`；`sideEffectId` Int32；defaults frozen |
| `src/sim/drug-graph/` | ✅ | 多圖效果引擎：transform union／supercover掃動／fog／preview authority已完成；療效使用5–9格連通region，現行沒有potency分層，apply/reveal/preview維持同源與整數確定性 |
| `src/sim/mapgen/` | ✅ | 建構式多圖生成與exact difficulty price；cure生長成5–9格，side effect／wall／hazard保留5%／4%／3%整數密度並生長成連通 biome；property tests守面積／連通／reference可解／seed逐欄位相等；production不import solver |
| `src/sim/solver/` | ✅ | 多圖 BFS 搜尋（**僅 tests/tools 驗證與平衡稽核**，D14） |
| `src/sim/rng/` | ✅ | 自有 seeded PRNG（**唯一隨機來源**，mapgen 也走它） |
| `src/sim/hash.ts` | ✅ | FNV-1a（replay/determinism） |
| `src/sim/state.ts` | ✅ | `hashFactory` / `replayFactory`（live `FactoryRuntime` 走 cold snapshot 後 FNV-1a；交付 INV-15） |
| `src/sim/game.ts` | 🔧 Phase 4 | 完整GameState/reducer/replay/hash/bounds已完成；新增Lab committed ProductionBlueprint authority與原子save/transfer validation，保存exact layout + derived Template並逐欄位轉Factory，不得走auto-pack。仍維持canonical clone/deep-freeze、trace/work bounds與factoryTicks cold ownership |
| `src/sim/replay-work.ts` | ✅ | 從 origin + raw intents 估算 map traversal、factory cold/layout/tick、sales 與 patent/map reset replay work；上限運算不 overflow，供 Game/Save/checkpoint replay-before-work 防護 |
| `src/sim/factory-geom.ts` | ✅ | 共用工廠幾何（純）：`rotateVec` / `worldCells` / `worldInPorts` / `worldOutPorts`——把 PlacedMachine 的 LOCAL shape 依 footRot（CW, y-down）+ anchor 解到世界座標，port side =(localSide+footRot)&3。factory-sim 與 factoryRenderer 同源引用（不再各自重複幾何） |
| `src/sim/factory-sim/` | ✅ | public area≤65,536的fixed SoA runtime，hot unit capacity只按carrier tiles + machines配置並綁layout + `MultiMap` identity；routing/cursors進snapshot/hash/save，成功tick零配置。diagnostics ≤100,000 ticks/≤100,000,000 work，init/tick前驗`(area+machines+sources)²×observationTicks`；throughput真deadlock回`0/1`與null bottleneck。serpentine throughput 20×20成功/21×21拒絕；outcome 20×20成功/22×22拒絕，21×21 outcome仍低於cap |
| `src/sim/recipe/` | 🔧 Phase 4 | 現行 template→shape／BFS auto-pack compiler 是歷史基線；production Lab→Factory path 將改為驗證 exact ProductionBlueprint 的唯一、無循環、無split/merge source→sink 拓撲並推導Template。Factory重排仍驗 effect order contract；auto-pack不得再介入Lab transfer |
| `src/sim/economy/` | ✅ | 各疾病 sold counter 的單品售價遞減、實際成本/副作用結算、銷售取得 R&D、帳務守恆；目前沒有訂單系統 |
| `src/sim/patent/` | ✅ | deep-frozen tree；cash+R&D天賦樹；public helpers拒絕invalid tree/effect/state/cash/research，`activeEffects` factory/reveal aggregates用checked safe-integer add並拒overflow |
| `src/sim/save/` | ✅ | 同 content build 內的 full/compact raw origin+trace preflight；single ≤100,000,000 work。`serializeSlots`/`deserializeSlots`共用12,000 ticks/8,192 entries/100,000,000 aggregate，deserialize在任何`parseGameState`前拒超界；full wire cap 5,000,000 chars；不承諾跨 build migration |
| `src/render/labCamera.ts` | ✅ | 固定`704×512`viewport、40px cell、pan、75–225% anchor zoom、focus/clamp、visible bounds與adaptive major/minor grid math已完成 |
| `src/render/labRenderer.ts` | 🔧 | PixiJS v8 Effect Atlas renderer；每格minor／每5格major／origin axes與所有revealed feature的連通fill/border已完成。grid可穿fog但不洩漏feature；route/preview仍共用sim authority。Bench selection segment highlight尚未完成 |
| `public/assets/lab/` | ✅ | 原創 microscopic biochemical atlas：`manifest.json` 是 runtime asset contract，`README.md` 記錄生成來源／權利／遮霧規則；含 substrate、fog、wall、hazard、side-effect、cure、drug、token halo |
| `src/render/factoryRenderer.ts` | ✅ | PixiJS v8 dumb Factory renderer與靜態layer快取已完成；100%地板格為42px，和40px Pilot Bench共享shape/port幾何語言並容納現行3–8格footprint。只畫、不跑sim |
| `src/ui/` | 🔧 Phase 4 | viewport shell與Factory direct editor已完成；Lab改為同步 Effect Atlas + Pilot Bench，Bench共用Factory footprint/ports/belt/collision/ghost/buildability與gesture language。`recipePreview.ts`／pictogram／playhead保留，insert/move/card reorder authority移除；timeline由Bench拓撲推導後只讀。desktop約65/35可交換焦點，compact保留live overview |
| `src/main.tsx` | ✅ | React 進入點（掛載 `Root` → `Game`） |
| `test/e2e/` | 🔧 Phase 4 | 現行shell／Factory／responsive／production-preview coverage已完成；新增Atlas grid/regions、Bench direct build/run/history、invalid topology、雙向highlight、唯讀timeline、desktop/compact focus與exact Lab→Factory transfer。更新代表性screenshot baseline後仍由`npm run check`統一驗收 |
| `test/integration/` | ✅ | 跨模組、無畫面（map→recipe→factory，加上economy/patent/save契約）；整局reducer vertical trace在`src/sim/game.test.ts`；checkpointStorage unit tests另守目前 build 的normalized lineage、different-run canonical replacement與同 wire storage legacy clean recovery |
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
