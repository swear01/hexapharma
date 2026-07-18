# Structure

> 狀態以 code-as-truth 與當前 commit gate 為準；本表描述現行責任，不記錄舊 build 驗證數字。

| Path | Responsibility |
|---|---|
| `AGENTS.md` | 專案硬規則、唯一 gate、真人 port、文件 lifecycle。 |
| `docs/` | canonical design、invariants、player guide、plan 與 playtest。 |
| `src/sim/phase0_interfaces.ts` | 完整 `PathStamp` machine、terrain/portal、三場域 state、non-null Production、Game intents。 |
| `src/sim/drug-graph/` | strict EffectMap validation、fixed path traversal、single-layer terrain/portal、preview/execution authority。 |
| `src/sim/mapgen/` | terrain-first seeded radial + motif Atlas、1–8疾病、paired portals、clean/contaminated Cure regions、diverse tiered reference ResearchPrograms、linear prices。 |
| `src/sim/solver/` | dev/test-only whole-Cure-region minimum steps／cost、soundness/quality/balance tool；production dependency graph禁止 import。 |
| `src/sim/rng/`, `hash.ts`, `state.ts` | seeded RNG、program/state hash、replay determinism。 |
| `src/sim/factory-geom.ts` | Pilot/Production footprint、rotated cells與ports；不定義 Research path。 |
| `src/sim/factory-sim/` | SoA runtime、routing/cursors、actual products、throughput/deadlock、cold snapshots。 |
| `src/sim/construction/` | `quoteProductionBuild` paid layout-diff authority。 |
| `src/sim/recipe/` | Factory prototype compilation與bounded diagnostics；不作Research authority。 |
| `src/sim/game.ts` | Research shot/fog、free Pilot、direct paid Production、products/economy/reset。 |
| `src/sim/replay-work.ts` | Save v7 intents與raw-work preflight。 |
| `src/sim/economy/`, `patent/` | per-disease finite demand、實體產品結算與tiered單層Technology。 |
| `src/sim/save/` | Save v7 full/compact/slots/rewind、strict parser、replay/hash、cold runtime、legacy rejection。 |
| `src/blueprint/format.ts` | Blueprint v3 `research-program`／`factory-layout` schema、checksum/content/bounds/geometry validators與materializers。 |
| `src/blueprint/storage.ts` | v3 save-independent Library、quota/dedupe/import/export/delete atomicity。 |
| `src/render/labCamera.ts` | 大型 Atlas camera、pan/zoom/focus/culling。 |
| `src/render/labTerrain.ts`, `labRegions.ts` | Wall-only穿霧、其他terrain/effect discovery gating、overlap Cure/SideEffect與portal pairing visuals。 |
| `src/render/labRenderer.ts` | Atlas、full-path candidate endpoint/program/trail、terrain、overlap features與fog layer；event-driven單幀重繪。 |
| `src/render/factoryTransportTopology.ts` | sim-derived accept/emit edges、cell shape classification、machine port connectivity。 |
| `src/render/factoryRenderer.ts` | Pilot/Production spatial renderer、connected transport與tick animation；event-driven單幀重繪。 |
| `public/assets/lab/` | 原創 Atlas textures與runtime manifest。 |
| `src/ui/App.tsx` | Research Atlas wrapper、candidate endpoint hit-testing、shot-follow camera、已知Cure輪播、combined outcome與progress。 |
| `src/ui/Factory.tsx` | Pilot/Production shared editor、Belt drag、build cost preview、diagnostics/transport controls。 |
| `src/ui/Game.tsx` | F1 Research route strip/costs、F2 optional Pilot、F3 direct Production、$1000 bootstrap、New Game、drawers、paid intents與save shell。 |
| `src/ui/machineLabels.ts`, `effectLabels.ts` | 玩家可讀的machine／一基底disease／outcome文字；不暴露internal IDs或座標。 |
| `src/ui/GameModalPortal.tsx` | 把嵌套destructive confirmations放到shell最上層，避免窄屏nav擷取pointer。 |
| `src/ui/Shop.tsx` | clean/cheap stable product ranking、positive-net single/bulk shipping與finite-demand顯示。 |
| `src/ui/BlueprintLibrary.tsx` | capture Research/Pilot/Production、open Factory in Pilot或paid Production、strict import/export。 |
| `src/ui/checkpointStorage.ts` | Save v7 compact checkpoint、lineage、rewind/recovery。 |
| `test/integration/` | Research、mapgen diversity、fresh-start affordability、optional Pilot、paid Production、finite Market/Technology loop。 |
| `test/e2e/` | world UI、5×5 visibility、endpoint commit/route strip/shot follow、touch/direct construction、Market、Blueprint、Save/New Game、modal freeze與responsive acceptance。 |
| `tools/` | headless sim與whole-region solver minima／mapgen quality/balance sweeps；不進遊戲內自動解。 |

## Module boundaries

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only ResearchProgram / Factory state
Pure TS sim core  → authoritative deterministic transitions
```

- `src/sim/**` 禁止 Pixi／React／DOM。
- GameState 是遊戲 authority；editor history、camera、hover、drawer 是 UI-local state。
- Research PathStamp geometry 與 Pilot/Production FactoryLayout geometry 是兩個 domain；共用操作手感，不共用 payload 或 validator。
- Pilot 與 Production 各 own layout；把 Pilot 建到 Production 仍走 paid Production intent，不 alias。
- transport topology 是 layout 的純 derived view；renderer 不得回寫或虛構 edge。
- Blueprint Library 不是 GameState，也不在 Save/Rewind lineage 內。
- Pixi Application停用auto ticker；React／sim狀態變化才明確要求一幀，隱藏workspace不得持續idle redraw。
- 模組擁有權見 [module-ownership.md](module-ownership.md)。
