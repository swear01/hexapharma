# Module Ownership（模組擁有權地圖）

> 鐵律：同一時間只有**一個** agent 能改某模組的 **public interface**；其他人對著凍結的介面寫。
> 工作切分對齊模組 / 介面契約。有 worktree hook 時一任務一 worktree；目前 runner 是 shared main tree，故只平行不相交檔案，重疊檔案與公共介面由 integrator 序列化。
> 本表記錄目前模組 owner——動態，隨工作分派更新；它不假裝每個環境都有 worktree。

## 當前分派

| 模組 | 路徑 | 目前 owner | 狀態 |
|------|------|----------|------|
| rng / hash | `src/sim/rng/`, `src/sim/hash.ts` | integrator | ✅ 完成（Phase 0 地基） |
| drug-graph / Research path terrain types | `src/sim/drug-graph/`, `src/sim/phase0_interfaces.ts`（path/terrain API） | integrator | ✅ Cure／SideEffect overlay authority |
| solver | `src/sim/solver/` | integrator（agent 交付） | ✅ 完成（INV-13） |
| mapgen | `src/sim/mapgen/`、`tools/balance.ts` | integrator（agent 交付） | ✅ seeded disease diversity／terrain-relevant constructive generation |
| factory-sim | `src/sim/factory-sim/` | integrator（agent 交付） | ✅ fixed PathStamp hot-loop authority |
| Production construction quote | `src/sim/construction/` | integrator | ✅ paid layout-diff authority |
| recipe | `src/sim/recipe/` | integrator（agent 交付） | ✅ Factory prototype compilation／outcome analysis；非Research authority |
| state.ts | `src/sim/state.ts` | integrator（agent 交付） | ✅ 完成（hashFactory / replayFactory，INV-15） |
| whole-game state | `src/sim/game.ts`, `src/sim/phase0_interfaces.ts` | integrator | ✅ multi-disease bootstrap／progression authority |
| whole-game migration tests | `src/sim/game.test.ts`, `src/sim/single-atlas.test.ts`, `src/sim/state.test.ts`, `test/integration/loop.test.ts` | integrator（agent 交付） | ✅ full paths／paid build／replay authority |
| replay work | `src/sim/replay-work.ts` | integrator（agent 交付） | ✅ Save v7 intents/work preflight |
| economy | `src/sim/economy/` | integrator（agent 交付） | ✅ finite per-disease demand／eventual zero gross |
| save | `src/sim/save/` | integrator（agent 交付） | ✅ Save v7 non-null Production／paid build migration |
| patent | `src/sim/patent/` | integrator（agent 交付） | ✅ cash+Knowledge、機器／擴廠／actual-trail sensor；無layer progression |
| render | `src/render/`、`public/assets/lab/` | integrator | ✅ Cure／SideEffect overlay readability |
| ui shell/workspaces | `src/ui/Game.tsx`、`src/ui/App.tsx`、`src/ui/game.css` | integrator（agent 交付） | ✅ direct Research preview／cost／sequence readability |
| factory UI | `src/ui/Factory.tsx`、`src/ui/factoryEditor.ts` | integrator | ✅ direct manipulation／paid build flow |
| checkpoint storage | `src/ui/checkpointStorage.ts`, `src/ui/checkpointStorage.test.ts` | integrator（agent 交付） | ✅ Save v7/ResearchProgram migration |
| blueprint portable format | `src/blueprint/` | integrator（agent 交付） | ✅ v3 ResearchProgram／generic FactoryLayout codec |
| browser acceptance | `test/e2e/` | integrator（agent 交付） | ✅ direct interactions／visibility／paid Production／Blueprint v3／Save v7 acceptance |
| active docs | `README.md`, `docs/`（`module-ownership.md` 除外） | integrator（agent 交付） | ✅ multi-disease／finite-demand／fresh-loop truth sync |

## 規則

- 改別人模組的 public interface 之前：先協調，把擁有權移轉給你並更新本表。
- `render/` 是最高衝突面（共享可變 scene graph）；同一時間只排一個 agent，不平行。
- sim 子系統彼此純、介面隔離 → 可安全平行。
- 跨模組整合、跑完整 `npm run check`、解衝突由 **integrator** session 負責。
- **環境註記**：目前 agent **worktree 隔離不可用**（無 WorktreeCreate hook），所有本輪變更仍在 shared/uncommitted 主工作樹；平行只用於檔案不相交（disjoint files）的任務，重疊檔案由 integrator 序列化並在最後跑閘。這是當前執行模式，不推翻未來可用 hook 時的一任務一 worktree 政策。
