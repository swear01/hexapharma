# Module Ownership（模組擁有權地圖）

> 鐵律：同一時間只有**一個** agent / worktree 能改某模組的 **public interface**；其他人對著凍結的介面寫。
> 工作切分對齊模組 / 介面契約。一個任務一個 git worktree（`git worktree add`）。
> 本表記錄「哪個模組現在歸哪條 worktree」——動態，隨工作分派更新。

## 當前分派

| 模組 | 路徑 | 目前 owner / worktree | 狀態 |
|------|------|----------------------|------|
| drug-graph | `src/sim/drug-graph/` | （未分派） | 待開工（Phase 0 首要） |
| mapgen | `src/sim/mapgen/` | （未分派） | 待開工（Phase 0） |
| solver | `src/sim/solver/` | （未分派） | 待開工（Phase 0） |
| factory-sim | `src/sim/factory-sim/` | （未分派） | Phase 2 |
| recipe | `src/sim/recipe/` | （未分派） | Phase 2 |
| economy | `src/sim/economy/` | （未分派） | Phase 3 |
| patent | `src/sim/patent/` | （未分派） | Phase 3 |
| save | `src/sim/save/` | （未分派） | Phase 3 |
| rng / state | `src/sim/rng/`, `src/sim/state.ts` | （未分派） | Phase 0 地基 |
| render | `src/render/` | （未分派） | **最高衝突面 → 工作須序列化** |
| ui | `src/ui/` | （未分派） | Phase 1+ |

## 規則

- 改別人模組的 public interface 之前：先協調，把擁有權移轉到你的 worktree 並更新本表。
- `render/` 是最高衝突面（共享可變 scene graph）；同一時間只排一個 agent，不平行。
- sim 子系統彼此純、介面隔離 → 可安全平行。
- 跨模組整合、跑完整 `npm run check`、解衝突由 **integrator** session 負責。
