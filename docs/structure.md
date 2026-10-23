# Structure

> 狀態以 code-as-truth 與當前 commit gate 為準；本表描述現行責任，不記錄舊 build 驗證數字。

| Path | Responsibility |
|---|---|
| `AGENTS.md` | 專案硬規則、唯一 gate、真人 port、文件 lifecycle。 |
| `.github/workflows/check.yml` | push/PR 到 `main` 時執行 `npm run check`（tsc、eslint、vitest、e2e）。 |
| `.github/workflows/pages.yml` | main 上 `check` 成功後，以相對 base build 並部署 GitHub Pages（custom domain `hexapharma.5334601.xyz`）。 |
| `vitest.config.ts`、`test/vitest.setup.ts` | Node test runner 與最小 browser-global setup，讓 Pixi renderer 純函式在 CI Node 20 可載入。 |
| `docs/` | canonical design、invariants、player guide、plan 與 playtest。 |
| `src/json-guards.ts` | 共用 JSON object guard；Save v14 與 checkpoint slot envelope 共用。 |
| `src/sim/hex.ts` | pointy-top axial `{q,r}`、E／SE／SW／W／NW／NE、六鄰接、60° rotation與`r * width + q`索引 authority。 |
| `src/sim/phase0_interfaces.ts` | 完整 `PathStamp` machine、terrain/portal、三場域 state、non-null Production、Game intents。 |
| `src/sim/drug-graph/` | strict EffectMap（含 cureTier／elevation）／DrugState validation、heading-relative fixed path traversal與turn、Swamp半格（doubled coordinates）、single-layer terrain/portal、preview/execution authority、`outcomeOf`（cured／★ premium／side effects）。 |
| `src/sim/mapgen/` | `terrain.ts`：六角 Atlas 的整數 elevation 骨架、noisy 最短路隘口與生成期 bounded BFS 驗證、清理；`features.ts`：hard／void-fill 效果區、★、黑格、副作用；`index.ts`：BFS-tree／sampled constructive references、easy 區、pricing、`generateWithDiagnostics`。1–8疾病、diverse tiered reference ResearchPrograms、linear prices。 |
| `src/sim/solver/` | dev/test-only whole-Cure-region minimum steps／cost、soundness/quality/balance tool；production dependency graph禁止 import。 |
| `src/sim/rng/`, `hash.ts`, `state.ts` | seeded RNG、program/state hash、replay determinism。 |
| `src/sim/factory-geom.ts` | Production Plan／Production axial footprint、六個60° rotated cells與ports；不定義Research path。 |
| `src/sim/factory-sim/` | SoA runtime、routing/cursors、actual products、throughput/deadlock、cold snapshots。 |
| `src/sim/construction/` | `quoteProductionBuild` paid layout-diff authority。 |
| `src/sim/recipe/` | Factory prototype compilation與bounded diagnostics；不作Research authority。 |
| `src/sim/game.ts` | Run-based Research trials（`runResearchTrial`／`lastTrial`）/fog、shipping contracts、free Production Plan（內部 pilot）、direct paid Production、products/economy/reset。 |
| `src/sim/replay-work.ts` | Production 單次 batch 的 bounded work estimate；獨立 replay 的工作量估算。 |
| `src/sim/economy/`, `patent/` | per-disease finite demand、quota-3 shipping contracts、machine patent gates與tiered單層Technology。 |
| `src/sim/save/` | Save v14 full/compact/slots/rewind、plain cold snapshots、bounded strict parser、可執行狀態驗證與舊版本拒絕。 |
| `src/blueprint/format.ts` | Blueprint v4 `research-program`／`factory-layout` schema、checksum/content/bounds/hex-geometry validators與materializers。 |
| `src/blueprint/storage.ts` | v4 save-independent Library、`hexapharma.blueprint-library.v4` namespace、quota/dedupe/import/export/delete atomicity。 |
| `src/render/hexProjection.ts` | Research／Factory共用pointy-top axial pixel projection；不擁有sim座標。 |
| `src/render/labCamera.ts` | 大型 axial Atlas camera、pan/zoom/focus/q-r picking/culling。 |
| `src/render/labTerrain.ts`, `labRegions.ts` | 全部 terrain/effect discovery gating（霧下無地表）、山／水／黑格 visuals、overlap Cure/SideEffect與portal pairing visuals。 |
| `src/render/labContours.ts` | 由 `EffectMap.elevation` 內插的 sign-free 壓縮等高線場＋seeded decoys（renderer-only 浮點）；壓縮／decoy 強度常數。 |
| `src/render/ink.ts` | renderer-only確定性墨線抖動（手繪感）；不得用於port、belt接點、hit-test或文字。 |
| `src/render/labRenderer.ts` | vector-only minimal flat hex Atlas（只畫六角形內）、下一個full-path candidate、executed trail、terrain、relief contours（chunk cache）、overlap features與fog layer；event-driven單幀重繪。 |
| `src/render/factoryTransportTopology.ts` | sim-derived accept/emit edges、cell shape classification、machine port connectivity。 |
| `src/render/factoryRenderer.ts` | Production Plan／Production minimal flat hex schematic、connected transport與tick animation；event-driven單幀重繪。 |
| `src/ui/ResearchWorkspace.tsx` | F1 Research 版面：羅盤、規劃step清單、試驗結果readout、依heading旋轉的machine legend hotbar與`Clear`／`Run · $N` command bar。 |
| `src/ui/objective.ts` | 由contracts／已揭露Cure／stock／layout／patents推導Objective下一步與目標場域的純函式。 |
| `src/ui/FieldGuide.tsx` | Guide與地圖／工廠符號圖例。 |
| `src/ui/game.css`, `research.css`, `factory.css`, `panels.css`, `fonts/` | tokens＋shell與各區域樣式；自帶 Barlow Condensed 600（OFL）。 |
| `src/ui/App.tsx` | Research Atlas wrapper、最後控制點 hit-testing（移除最後一步）、手動camera focus、已知Cure輪播與試驗outcome fit。 |
| `src/ui/Factory.tsx` | Production Plan／Production shared editor、Belt drag、Commission cost preview、diagnostics/transport controls。 |
| `src/ui/Game.tsx` | shell：場域分頁、資源HUD、Objective列、drawers、本地Research規劃與route helpers、F2 optional Production Plan、F3 direct Production、$1000 bootstrap、New Game、paid intents與save shell。 |
| `src/ui/machineLabels.ts`, `effectLabels.ts` | 玩家可讀的machine／一基底disease／outcome文字；不暴露internal IDs或座標。 |
| `src/ui/Shop.tsx` | clean/cheap stable product ranking、positive-net single/bulk shipping與finite-demand顯示。 |
| `src/ui/BlueprintLibrary.tsx` | capture Production Plan／Production、open Factory in Production Plan或paid Commission、strict import/export；既有Research cards只可download/delete，不可capture/apply。 |
| `src/ui/checkpointStorage.ts` | 獨立 checkpoint/history outer v2、inner Save v14 compact checkpoint、`hexapharma.save.v14.checkpoint.${slot}` key、rewind/recovery。 |
| `test/integration/` | Research trial、mapgen diversity、fresh-start affordability、shipping gates、optional Production Plan、paid Production、finite Market/Technology loop。 |
| `test/e2e/` | world UI、radius-two hex visibility、planned-route Research／paid trials、assay、touch/direct construction、Market/contracts、Blueprint、Save/New Game、modal freeze與responsive acceptance。 |
| `tools/` | headless sim與whole-region solver minima／mapgen quality/balance sweeps；不進遊戲內自動解。 |

## Module boundaries

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only Research session / Factory state
Pure TS sim core  → authoritative deterministic transitions
```

- `src/sim/**` 禁止 Pixi／React／DOM。
- GameState 是遊戲 authority；editor history、camera、hover、drawer 是 UI-local state。
- Research Atlas 與 Factory 都使用pointy-top axial `{q,r}`、E／SE／SW／W／NW／NE與dense `r * width + q`索引。PathStamp geometry 與 Production Plan／Production FactoryLayout geometry 仍是兩個domain；共用projection慣例與操作手感，不共用payload或validator。
- Production Plan 與 Production 各 own layout；把 Plan Commission 到 Production 仍走 paid Production intent，不 alias。內部 schema 暫保留 `pilot` 命名。
- transport topology 是 layout 的純 derived view；renderer 不得回寫或虛構 edge。
- Blueprint Library 不是 GameState，也不在 Save/Rewind history 內。
- Pixi Application停用auto ticker；React／sim狀態變化才明確要求一幀，隱藏workspace不得持續idle redraw。
- 模組擁有權見 [module-ownership.md](module-ownership.md)。
