# Structure

> 狀態以 code-as-truth 與當前 commit gate 為準；本表描述現行責任，不記錄舊 build 驗證數字。

| Path | Responsibility |
|---|---|
| `AGENTS.md` | 專案硬規則、唯一 gate、真人 port、文件 lifecycle。 |
| `.github/workflows/check.yml` | push/PR 到 `main` 時執行 `npm run check`（tsc、eslint、vitest、e2e）。 |
| `docs/` | canonical design、invariants、player guide、plan 與 playtest。 |
| `src/json-guards.ts` | 共用 JSON object guard；Save v9 與 checkpoint slot envelope 共用。 |
| `src/sim/phase0_interfaces.ts` | 完整 `PathStamp` machine、terrain/portal、三場域 state、non-null Production、Game intents。 |
| `src/sim/drug-graph/` | strict EffectMap validation、fixed path traversal、single-layer terrain/portal、preview/execution authority。 |
| `src/sim/mapgen/` | terrain-first seeded radial + motif Atlas、1–8疾病、paired portals、clean/contaminated Cure regions、diverse tiered reference ResearchPrograms、linear prices。 |
| `src/sim/solver/` | dev/test-only whole-Cure-region minimum steps／cost、soundness/quality/balance tool；production dependency graph禁止 import。 |
| `src/sim/rng/`, `hash.ts`, `state.ts` | seeded RNG、program/state hash、replay determinism。 |
| `src/sim/factory-geom.ts` | Production Plan／Production footprint、rotated cells與ports；不定義 Research path。 |
| `src/sim/factory-sim/` | SoA runtime、routing/cursors、actual products、throughput/deadlock、cold snapshots。 |
| `src/sim/construction/` | `quoteProductionBuild` paid layout-diff authority。 |
| `src/sim/recipe/` | Factory prototype compilation與bounded diagnostics；不作Research authority。 |
| `src/sim/game.ts` | stepwise Research session/fog/formulas、shipping contracts、free Production Plan（內部 pilot）、direct paid Production、products/economy/reset。 |
| `src/sim/replay-work.ts` | Save v9 intents與raw-work preflight。 |
| `src/sim/economy/`, `patent/` | per-disease finite demand、quota-3 shipping contracts、machine patent gates與tiered單層Technology。 |
| `src/sim/save/` | Save v9 full/compact/slots/rewind、strict parser、replay/hash、formula、cold runtime、legacy rejection。 |
| `src/blueprint/format.ts` | Blueprint v3 `research-program`／`factory-layout` schema、checksum/content/bounds/geometry validators與materializers。 |
| `src/blueprint/storage.ts` | v3 save-independent Library、quota/dedupe/import/export/delete atomicity。 |
| `src/render/labCamera.ts` | 大型 Atlas camera、pan/zoom/focus/culling。 |
| `src/render/labTerrain.ts`, `labRegions.ts` | Wall-only穿霧、其他terrain/effect discovery gating、overlap Cure/SideEffect與portal pairing visuals。 |
| `src/render/labRenderer.ts` | vector-only Orbital Wet-Lab Atlas、下一個full-path candidate、executed trail、terrain、overlap features與fog layer；event-driven單幀重繪。 |
| `src/render/factoryTransportTopology.ts` | sim-derived accept/emit edges、cell shape classification、machine port connectivity。 |
| `src/render/factoryRenderer.ts` | Production Plan／Production Orbital Wet-Lab schematic、connected transport與tick animation；event-driven單幀重繪。 |
| `src/ui/App.tsx` | Research Atlas wrapper、candidate endpoint hit-testing、shot-follow camera、已知Cure輪播、combined outcome與progress。 |
| `src/ui/Factory.tsx` | Production Plan／Production shared editor、Belt drag、Commission cost preview、diagnostics/transport controls。 |
| `src/ui/Game.tsx` | F1 stepwise Research／assay sector／formula ribbon、F2 optional Production Plan、F3 direct Production、contract HUD、$1000 bootstrap、New Game、drawers、paid intents與save shell。 |
| `src/ui/machineLabels.ts`, `effectLabels.ts` | 玩家可讀的machine／一基底disease／outcome文字；不暴露internal IDs或座標。 |
| `src/ui/Shop.tsx` | clean/cheap stable product ranking、positive-net single/bulk shipping與finite-demand顯示。 |
| `src/ui/BlueprintLibrary.tsx` | capture Production Plan／Production、open Factory in Production Plan或paid Commission、strict import/export；既有Research cards只可download/delete，不可capture/apply。 |
| `src/ui/checkpointStorage.ts` | Save v9 compact checkpoint、lineage、rewind/recovery。 |
| `test/integration/` | stepwise Research/formula、mapgen diversity、fresh-start affordability、shipping gates、optional Production Plan、paid Production、finite Market/Technology loop。 |
| `test/e2e/` | world UI、5×5 visibility、reveal–decide Research、assay/formula、touch/direct construction、Market/contracts、Blueprint、Save/New Game、modal freeze與responsive acceptance。 |
| `tools/` | headless sim與whole-region solver minima／mapgen quality/balance sweeps；不進遊戲內自動解。 |

## Module boundaries

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only Research session / Factory state
Pure TS sim core  → authoritative deterministic transitions
```

- `src/sim/**` 禁止 Pixi／React／DOM。
- GameState 是遊戲 authority；editor history、camera、hover、drawer 是 UI-local state。
- Research Atlas 與 Factory 都使用正方格，但 PathStamp geometry 與 Production Plan／Production FactoryLayout geometry 是兩個 domain；共用操作手感，不共用 payload 或 validator。
- Production Plan 與 Production 各 own layout；把 Plan Commission 到 Production 仍走 paid Production intent，不 alias。內部 schema 暫保留 `pilot` 命名。
- transport topology 是 layout 的純 derived view；renderer 不得回寫或虛構 edge。
- Blueprint Library 不是 GameState，也不在 Save/Rewind lineage 內。
- Pixi Application停用auto ticker；React／sim狀態變化才明確要求一幀，隱藏workspace不得持續idle redraw。
- 模組擁有權見 [module-ownership.md](module-ownership.md)。
