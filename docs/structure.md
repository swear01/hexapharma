# Structure

> 狀態：✅ implemented and verified。2026-07-14完整`npm run check`通過。

| Path | 狀態 | Responsibility / migration |
|---|---:|---|
| `AGENTS.md` | ✅ | 專案硬規則、唯一 gate、真人 port、文件 lifecycle。 |
| `docs/` | ✅ | single-Atlas/PathStamp canonical design、invariants、plan、playtest 與 migration truth。 |
| `src/sim/phase0_interfaces.ts` | ✅ | `PathStamp`/`ResearchProgram`/terrain/portal、contract-free Pilot/Production、Game intents。production Game強制single Atlas，舊Research layout不是active authority。 |
| `src/sim/drug-graph/` | ✅ | fixed PathStamp traversal、prefix calibration、single-layer terrain/portal、preview/execution authority。 |
| `src/sim/mapgen/` | ✅ | seeded radial + motif constructive Atlas、paired portals、reference ResearchProgram、quality metrics。 |
| `src/sim/solver/` | ✅ | dev/test-only soundness/quality/balance tool；production dependency graph禁止 import。 |
| `src/sim/rng/`, `hash.ts`, `state.ts` | ✅ | seeded RNG、program/state hash、replay determinism。 |
| `src/sim/factory-geom.ts` | ✅ | Pilot/Production footprint/ports 的共享世界幾何；不定義 Research PathStamp。 |
| `src/sim/factory-sim/` | ✅ | SoA runtime、routing/cursors、actual product events、throughput/deadlock；無contract assumption。 |
| `src/sim/recipe/` | ✅ | Factory prototype compilation；不作Research/commission/Blueprint authority。 |
| `src/sim/game.ts` | ✅ | ResearchProgram execution/fog、independent Pilot sandbox、exact no-contract commission、Production outcomes/economy/reset。 |
| `src/sim/replay-work.ts` | ✅ | Save v6 intents/raw work preflight。 |
| `src/sim/economy/`, `patent/` | ✅ | 實體藥結算與single-Atlas technology；無contract/layer progression。 |
| `src/sim/save/` | ✅ | Save v6 full/compact/slots/rewind、strict parser、raw-work/semantic replay/hash、cold runtime與v5 rejection。 |
| `src/blueprint/format.ts` | ✅ | wire/ruleset v2 kind-specific `research-program`/`pilot-plant` schema、strict checksum/content/calibration/bounds/geometry validators與materializers。 |
| `src/blueprint/storage.ts` | ✅ | v2 save-independent Library、quota/dedupe/import/export/delete atomicity。 |
| `src/render/labCamera.ts` | ✅ | single large Atlas camera、pan/zoom/focus/culling；無active-layer cameras。 |
| `src/render/labRenderer.ts` | ✅ | single Atlas、PathStamp preview/program/trail、wall/abyss/swamp/portal/fog；無 Route Floor/multi-layer controls。 |
| `src/render/factoryRenderer.ts` | ✅ | Pilot/Production dumb spatial renderer。 |
| `public/assets/lab/` | ✅ | 原創Atlas assets與程式化terrain/portal；無legacy hazard vocabulary。 |
| `src/ui/App.tsx` | ✅ | single Research Atlas wrapper、PathStamp tools/progress；無 A–D layer tabs/Route Floor tutorial。 |
| `src/ui/Factory.tsx` | ✅ | Pilot/Production shared editor；Pilot diagnostics非 gate，Production transport only。Research 不再使用此 editor。 |
| `src/ui/Game.tsx` | ✅ | F1 single Research、F2 independent Pilot、F3 commissioned Production；contract-free intents/drawers/save shell。 |
| `src/ui/BlueprintLibrary.tsx` | ✅ | capture/apply兩種 payload、strict import/export、cross-save Library。 |
| `src/ui/checkpointStorage.ts` | ✅ | Save v6 compact checkpoint、lineage、rewind/recovery。 |
| `test/integration/` | ✅ | 解耦 Research exploration、no-contract Pilot→Production、Market/Technology loop。 |
| `test/e2e/` | ✅ | single Atlas/PathStamp/no-layer UI、Pilot sandbox/exact commission、Blueprint kinds、v6 save、responsive/screenshots；33 tests。 |
| `tools/` | ✅ | single-Atlas headless sim與mapgen quality/balance sweeps；不進遊戲內自動解。 |

## Module Boundaries

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only ResearchProgram / Factory state
Pure TS sim core  → authoritative deterministic transitions
```

- `src/sim/**` 禁止 Pixi／React／DOM。
- `GameState` 是遊戲 authority；editor history/camera/hover/drawer 是 UI-local state。
- Research `PathStamp` geometry 與 Pilot/Production `FactoryLayout` geometry 是兩個明確 domain；共用操作手感，不共用 validator 或 payload。
- Pilot/Production 可各 own FactoryLayout；commission 是明示 exact copy，不 alias。
- Blueprint Library 不是 GameState，也不在 Save/Rewind lineage 內。
- 模組擁有權見 [module-ownership.md](module-ownership.md)。
