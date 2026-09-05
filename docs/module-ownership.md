# Module Ownership（模組擁有權地圖）

> 鐵律：同一時間只有**一個** agent 能改某模組的 **public interface**；其他人對著凍結的介面寫。
> 工作切分對齊模組 / 介面契約。有 worktree hook 時一任務一 worktree；目前 runner 是 shared main tree，故只平行不相交檔案，重疊檔案與公共介面由 integrator 序列化。
> 本表記錄目前模組 owner——動態，隨工作分派更新；它不假裝每個環境都有 worktree。

## 當前分派

| 模組 | 路徑 | 目前 owner | 狀態 |
|------|------|----------|------|
| rng / hash | `src/sim/rng/`, `src/sim/hash.ts` | integrator | ✅ 完成（Phase 0 地基） |
| shared hex contract | `src/sim/hex.ts`, `src/sim/phase0_interfaces.ts`（geometry API） | integrator | ✅ frozen pointy-top axial `{q,r}`／六方向 contract |
| drug-graph / Research path terrain types | `src/sim/drug-graph/`, `src/sim/phase0_interfaces.ts`（path/terrain API） | integrator | ✅ numeric PathStamp／six-neighbor traversal |
| solver | `src/sim/solver/` | integrator（agent 交付） | ✅ axial search／whole-region goals |
| mapgen | `src/sim/mapgen/`、`tools/balance.ts` | integrator（agent 交付） | ✅ axial generation／strict-prefix-safe references／balance |
| factory geometry | `src/sim/factory-geom.ts` | integrator（agent 交付） | ✅ six 60° footprint／port rotations |
| factory-sim | `src/sim/factory-sim/` | integrator（agent 交付） | ✅ six-neighbor runtime／validation／snapshot |
| Production construction quote | `src/sim/construction/` | integrator | ✅ q/r layout diff quote |
| recipe | `src/sim/recipe/` | integrator（agent 交付） | ✅ axial Factory prototype／BFS／adjacency |
| state.ts | `src/sim/state.ts` | integrator（agent 交付） | ✅ q/r hash／snapshot authority |
| whole-game state | `src/sim/game.ts`, `src/sim/phase0_interfaces.ts` | integrator（agent 交付） | ✅ stepwise Research／Factory q/r integration |
| whole-game migration tests | `src/sim/game.test.ts`, `src/sim/single-atlas.test.ts`, `src/sim/state.test.ts`, `test/integration/loop.test.ts` | integrator（agent 交付） | ✅ true-hex fixtures／replay／loop |
| replay work | `src/sim/replay-work.ts` | integrator（agent 交付） | ✅ Save v10 intents/work preflight |
| economy | `src/sim/economy/` | integrator（agent 交付） | ✅ finite per-disease demand／eventual zero gross |
| save | `src/sim/save/` | integrator（agent 交付） | ✅ Save v10／Formula／hex authority schema |
| patent | `src/sim/patent/` | integrator（agent 交付） | ✅ cash+Knowledge、機器／擴廠／actual-trail sensor；無layer progression |
| render | `src/render/` | integrator（agent 交付） | ✅ shared projection／Lab／Factory pointy-top renderers |
| ui shell/workspaces | `src/ui/Game.tsx`、`src/ui/App.tsx` | integrator | ✅ q/r Research camera／picking／six-sector caller |
| UI chrome | `src/ui/game.css` | integrator（agent 交付） | ✅ flat neutral pixel-adjacent stylesheet |
| factory UI | `src/ui/Factory.tsx`、`src/ui/factoryEditor.ts` | integrator | ✅ pointy-top picking／hex-line gestures／six rotations |
| checkpoint storage | `src/ui/checkpointStorage.ts`, `src/ui/checkpointStorage.test.ts` | integrator（agent 交付） | ✅ outer v2／inner Save v10 versioned checkpoints |
| blueprint portable format | `src/blueprint/` | integrator（agent 交付） | ✅ v4 ResearchProgram／generic q/r FactoryLayout codec |
| browser acceptance | `test/e2e/` | integrator（agent 交付） | ✅ Research／Factory／save／Blueprint true-hex acceptance |
| active docs | `README.md`, `docs/` | integrator | ✅ true-hex／Save v10／Blueprint v4 truth sync |

## 規則

- 改別人模組的 public interface 之前：先協調，把擁有權移轉給你並更新本表。
- `render/` 是最高衝突面（共享可變 scene graph）；同一時間只排一個 agent，不平行。
- sim 子系統彼此純、介面隔離 → 可安全平行。
- 跨模組整合、跑完整 `npm run check`、解衝突由 **integrator** session 負責。
- **環境註記**：本輪在 `~/.agent-worktrees/hexapharma-a238/true-hex` 整合；subagent 共用該 worktree，所以仍以不相交檔案平行、公共介面由 integrator 序列化，最後統一跑閘。
