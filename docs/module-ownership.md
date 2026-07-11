# Module Ownership（模組擁有權地圖）

> 鐵律：同一時間只有**一個** agent 能改某模組的 **public interface**；其他人對著凍結的介面寫。
> 工作切分對齊模組 / 介面契約。有 worktree hook 時一任務一 worktree；目前 runner 是 shared main tree，故只平行不相交檔案，重疊檔案與公共介面由 integrator 序列化。
> 本表記錄目前模組 owner——動態，隨工作分派更新；它不假裝每個環境都有 worktree。

## 當前分派

| 模組 | 路徑 | 目前 owner | 狀態 |
|------|------|----------|------|
| rng / hash | `src/sim/rng/`, `src/sim/hash.ts` | integrator | ✅ 完成（Phase 0 地基） |
| drug-graph | `src/sim/drug-graph/` | integrator（agent 交付） | ✅ 完成（INV-1..8） |
| solver | `src/sim/solver/` | integrator（agent 交付） | ✅ 完成（INV-13） |
| mapgen | `src/sim/mapgen/` | integrator（agent 交付） | ✅ 完成（INV-9..12 + exact BigInt rational pricing + GenOptions/catalog authority） |
| factory-sim | `src/sim/factory-sim/` | integrator（agent 交付） | ✅ 完成（strict SoA zero-allocation / layout+MultiMap identity / routing+cursors / cold snapshot / 100,000-tick + 100,000,000-work pre-init diagnostic bound / throughput deadlock語意） |
| recipe | `src/sim/recipe/` | integrator（agent 交付） | ✅ 完成（模板→產線 + 重排不變 INV-7） |
| state.ts | `src/sim/state.ts` | integrator（agent 交付） | ✅ 完成（hashFactory / replayFactory，INV-15） |
| whole-game state | `src/sim/game.ts`, `src/sim/replay-work.ts`, `src/sim/phase0_interfaces.ts` | integrator（agent 交付） | ✅ 完成（owned/frozen authority inputs、Game map≤64/side/≤4,096、預設1×63中心fog、base factory entitlement、origin + normalized 100,000-tick/100,000,000-work trace/replay/hash、per-intent runtime ownership clone、24,500 physical inventory、declared-origin validator） |
| economy | `src/sim/economy/` | integrator（agent 交付） | ✅ 完成（遞減定價 + 實際成本/副作用 + R&D + 帳務守恆） |
| save | `src/sim/save/` | integrator（agent 交付） | ✅ 完成（full/compact raw-work preflight；single 100,000,000；serialize/deserializeSlots共用12,000/8,192/100,000,000 aggregate；legacy replay-before-work封堵） |
| patent | `src/sim/patent/` | integrator（agent 交付） | ✅ 完成（frozen tree；invalid authority rejection；activeEffects checked aggregate overflow；cash+R&D、鎖機/擴廠/揭霧、1→2→3→4 reset含`deep-map-4`） |
| render | `src/render/`、`public/assets/lab/` | integrator（agent 交付） | ✅ 完成（Lab固定704×512 active-layer viewport/culling、camera pure helpers、原創biochemical atlas + SoA Factory renderer、static layer cache、multi-Application-safe teardown） |
| ui | `src/ui/` | integrator（agent 交付） | ✅ 完成（Lab pan/zoom/F follow/A–D tabs/Phase Exchange lock、stale guards/authority labels/confirmations、intent+save+analysis error alerts、renderer split、compact checkpoint same-origin normalized lineage/cross-run replace/migration/recovery；真人 :53346） |

## 規則

- 改別人模組的 public interface 之前：先協調，把擁有權移轉給你並更新本表。
- `render/` 是最高衝突面（共享可變 scene graph）；同一時間只排一個 agent，不平行。
- sim 子系統彼此純、介面隔離 → 可安全平行。
- 跨模組整合、跑完整 `npm run check`、解衝突由 **integrator** session 負責。
- **環境註記**：目前 agent **worktree 隔離不可用**（無 WorktreeCreate hook），所有本輪變更仍在 shared/uncommitted 主工作樹；平行只用於檔案不相交（disjoint files）的任務，重疊檔案由 integrator 序列化並在最後跑閘。這是當前執行模式，不推翻未來可用 hook 時的一任務一 worktree 政策。
