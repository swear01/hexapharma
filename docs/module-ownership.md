# Module Ownership（模組擁有權地圖）

> 鐵律：同一時間只有**一個** agent / worktree 能改某模組的 **public interface**；其他人對著凍結的介面寫。
> 工作切分對齊模組 / 介面契約。一個任務一個 git worktree（`git worktree add`）。
> 本表記錄「哪個模組現在歸哪條 worktree」——動態，隨工作分派更新。

## 當前分派

| 模組 | 路徑 | 目前 owner | 狀態 |
|------|------|----------|------|
| rng / hash | `src/sim/rng/`, `src/sim/hash.ts` | integrator | ✅ 完成（Phase 0 地基） |
| drug-graph | `src/sim/drug-graph/` | integrator（agent 交付） | ✅ 完成（46 tests, INV-1..8） |
| solver | `src/sim/solver/` | integrator（agent 交付） | ✅ 完成（INV-13） |
| mapgen | `src/sim/mapgen/` | integrator（agent 交付） | ✅ 完成（INV-9..12 + 定價） |
| render | `src/render/` | integrator（agent 交付中） | 🔧 Phase 1 進行中（:53346 視覺） |
| ui | `src/ui/` | integrator（agent 交付中） | 🔧 Phase 1 進行中 |
| factory-sim | `src/sim/factory-sim/` | （未分派） | Phase 2 |
| recipe | `src/sim/recipe/` | （未分派） | Phase 2 |
| economy | `src/sim/economy/` | （未分派） | Phase 3 |
| patent | `src/sim/patent/` | （未分派） | Phase 3 |
| save | `src/sim/save/` | （未分派） | Phase 3 |
| state.ts（完整 SimState/replay）| `src/sim/state.ts` | （未分派） | Phase 2+（目前用 hash.ts 支撐 replay/determinism）|

## 規則

- 改別人模組的 public interface 之前：先協調，把擁有權移轉給你並更新本表。
- `render/` 是最高衝突面（共享可變 scene graph）；同一時間只排一個 agent，不平行。
- sim 子系統彼此純、介面隔離 → 可安全平行。
- 跨模組整合、跑完整 `npm run check`、解衝突由 **integrator** session 負責。
- **環境註記**：本機 agent **worktree 隔離不可用**（無 WorktreeCreate hook）。因此 agent 均在主工作樹執行；平行只能用於檔案不相交（disjoint dir）的任務，否則序列化由 integrator 逐一交付 + 過閘。Phase 0 sim 鏈（drug-graph→solver→mapgen）本就是相依鏈，故序列執行。
