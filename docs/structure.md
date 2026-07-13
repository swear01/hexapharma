# Structure

> 狀態：✅ 已實作｜🔧 驗證中｜📋 後續。

| Path | 狀態 | Responsibility |
|---|---:|---|
| `AGENTS.md` | ✅ | 專案硬規則、唯一 gate、真人伺服器 port、文件 lifecycle。 |
| `docs/` | 🔧 | active design／overview／invariants／decisions／plan／roadmap／playtest／UI 契約。 |
| `src/sim/phase0_interfaces.ts` | ✅ | sim 共用型別、catalog/shapes、Research/Pilot/Production/GameState/GameIntent 契約。 |
| `src/sim/drug-graph/` | ✅ | translate/scale/swap、supercover sweep、evaluate、preview 與 fog reveal。 |
| `src/sim/mapgen/` | ✅ | seed-pure constructive map generation、連通 regions、difficulty/price。 |
| `src/sim/solver/` | ✅ | dev/test-only soundness 與平衡搜尋；production dependency graph 禁止 import。 |
| `src/sim/rng/`, `hash.ts`, `state.ts` | ✅ | 唯一 seeded RNG、hash、factory replay determinism。 |
| `src/sim/factory-geom.ts` | ✅ | footprint/ports 的共享世界幾何。 |
| `src/sim/factory-sim/` | ✅ | fixed-capacity SoA runtime、routing/cursors、product events、throughput/deadlock diagnostics。 |
| `src/sim/recipe/` | ✅ | 嚴格驗證 Research 唯一線性 source→machines→sink route，推導 deep-frozen descriptor/template。 |
| `src/sim/game.ts` | ✅ | 三場域 reducer、ResearchShot、exact transfers、Production ticks、inventory/economy/deeper reset、replay/hash。 |
| `src/sim/replay-work.ts` | ✅ | 三場域 intents 的 raw replay work preflight。 |
| `src/sim/economy/`, `patent/` | ✅ | 實體藥結算、Knowledge、遞減收益、Technology tree/deeper-level reset。 |
| `src/sim/save/` | ✅ | Save v5 full/compact codecs、semantic replay、slots 與 budget boundaries。 |
| `src/blueprint/format.ts` | ✅ | portable Blueprint v1、strict schema、canonical SHA-256 checksum、layout materialization。 |
| `src/blueprint/storage.ts` | ✅ | 與 save slots 分離的 cross-save Blueprint Library；64 entries/4 MiB bounds。 |
| `src/render/labCamera.ts` | ✅ | `704×512` 局部鏡頭、pan/zoom/focus/culling、origin-aligned minor/5×5 major grid。 |
| `src/render/labRenderer.ts` | ✅ | Effect Atlas Pixi renderer；無玩家 XY 十字軸、opaque fog、revealed features、route/token。 |
| `src/render/factoryRenderer.ts` | ✅ | Research/Pilot/Production 共用的 dumb spatial renderer。 |
| `public/assets/lab/` | ✅ | 原創 atlas raster assets、manifest 與來源/權利說明。 |
| `src/ui/App.tsx` | ✅ | Effect Atlas React wrapper、active layer cameras、手動 focus、無 auto-follow。 |
| `src/ui/Factory.tsx` | ✅ | `research|pilot|production` 共用直接操作 editor；Production 才顯示 transport。 |
| `src/ui/Game.tsx` | ✅ | F1 Research、F2 Pilot、F3 Production，Market/Technology/Blueprint drawers，save/checkpoint shell。 |
| `src/ui/BlueprintLibrary.tsx` | ✅ | capture/import/upload/download/apply/delete Blueprint UI。 |
| `src/ui/checkpointStorage.ts` | ✅ | Save v5 compact checkpoint、lineage、rewind/recovery。 |
| `test/integration/` | ✅ | 無畫面 Research→Pilot→Production→Market→Technology vertical loop。 |
| `test/e2e/` | 🔧 | 三場域、atlas/grid/fog、exact transfer、drawers、Blueprint cross-save、responsive 與 production preview。 |
| `tools/` | ✅ | headless sim 與 balance sweep；不進遊戲內自動解。 |

## Module Boundaries

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only drawing
Pure TS sim core  → authoritative deterministic transitions
```

- `src/sim/**` 禁止 Pixi／React／DOM。
- `GameState` 是遊戲 authority；editor history/camera/hover/drawer 是 UI-local state。
- `FactoryLayout` 是三場域共用的幾何語言；Research/Pilot/Production 各持有自己的 owned layout。
- Blueprint Library 不是 GameState，也不在 Save/Rewind lineage 內。
- 模組擁有權見 [module-ownership.md](module-ownership.md)。
