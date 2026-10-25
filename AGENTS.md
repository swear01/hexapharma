# BEGIN agents_rule-base
# Agent Rules

## Core Rules

- Default to autonomous execution: make and carry out the least-risky reasonable decisions for routine, reversible, in-scope work without asking.
- Own the requested outcome end to end. Do not stop after discovery, planning, partial implementation, or a progress update; continue through verification and safe in-scope fixes until complete or genuinely blocked.
- Necessary supporting changes to code, tests, fixtures, configuration, generated artifacts, and documentation are in scope. Unrelated refactors, cleanup, and features are not.
- Ask only for a concrete, material problem—missing input, a user-owned decision, or an unrequested destructive, irreversible, paid, or external action; never skip a required step for lack of approval—ask instead.
- Before asking, diagnose the issue and complete all safe, reversible, equivalent, in-scope work. If no concrete material problem exists, choose a reasonable default and continue.
- Do not ask merely because the work crosses files, functions, tests, fixtures, configuration, dependencies, or tools. Do not ask again for an action the user already explicitly requested or authorized.
- For substantive tasks, inspect relevant local files and instructions before modifying them; use authoritative docs or web sources when current or external facts matter. Explicit, trivial, unambiguous edits may proceed directly.
- If authoritative guidance is unavailable, use verified local evidence when sufficient; never invent code, paths, functions, APIs, behavior, or verification results.
- Equivalent tools and implementation methods may be substituted without asking when they preserve behavior, security, data safety, verification strength, target, and material cost. Otherwise report the issue and the decision needed.
- Never return dummy results, skip required verification, hide failures, or silently downgrade the requested scope.
- Retry an operation once when the failure appears transient; otherwise diagnose it and continue with safe, equivalent, in-scope alternatives when available.
- Match existing style, names, and patterns; keep changes minimal and add no dependencies or comments unless necessary for the requested result.
- Change requested behavior directly; do not add unrequested compatibility options.
- Before merging a PR, trigger a GitHub bot review with `github-pr-review-loop`; merge once it passes on the latest head. Local review is supplementary.

## Completion

- Run the smallest relevant verification that can prove the outcome, including live behavior when applicable; fix safe failures caused by the change.
- Never claim an unrun check passed. Report the concrete problem, safe alternatives tried, and exact decision needed when genuinely blocked.

## Memory and Documentation

- After substantive work, check for new durable, verified knowledge; use `shared-memory` only when there is useful knowledge to record.
- Update active docs only when durable behavior, API, CLI, or configuration changes; scan only affected documentation.
- Refresh and query-check QMD only when memory changes. Use `agents_rule archive` for intentional documentation archiving and `git mv` for tracked moves.
- Report files changed, documentation status, verification performed, and remaining risks or blockers.
# END agents_rule-base

# HexaPharma

Big Pharma 的工廠 + Potion Craft 的地圖。確定性 sim core（純 TS）＋薄渲染層。詳見 `docs/design.md`。

## Gate（宣告完成前必跑，唯一驗收標準）

`npm run check` → `tsc --noEmit && npm run lint && vitest run && npm run e2e`
（`e2e` = `playwright test`, headless, against a throwaway dev server on :53347）

## Playtest 伺服器（真人測試）

要給使用者真人測試 / demo 時，dev 或 preview server **必須**綁 **`0.0.0.0:53346`**（Vite：`--host 0.0.0.0 --port 53346 --strictPort`）。這是 Oracle Cloud 上**唯一**開白名單的 port——換任何其他 port 使用者從外部連不上。`--strictPort`：port 被佔用就直接報錯，**禁止**靜默 fallback 到別的 port。

## Hard Rules（HexaPharma 專屬，AI 推不出來的才放這）

- **code-as-truth**：不用引擎視覺編輯器、不用 scene 檔。所有內容是資料，runtime 生成 + 程式碼畫出。
- **sim core 是純的**：`src/sim/**` **禁** import Pixi / React / DOM，必須能在 node headless 跑。
- **sim/mapgen 確定性**：禁 `Math.random()`（走 `rng`）、禁 `Date.now()`/`performance.now()`（時間 = tick 計數）。不得依賴 `Set`/`Map` 迭代順序做有副作用邏輯。離散量用整數；比例（scale）用有理數（分子/分母），**不用 float**。
- **mapgen 純由 seed 決定**：同 seed → 逐欄位相等的地圖 + 難度 + 藥價。
- **熱迴圈禁 `new`**：每 tick 的熱迴圈用 object pool / TypedArray，不在迴圈內 `new` 物件或產生新陣列。冷路徑（Lab/UI）照常。
- **求解器只 dev/test 用**：**絕不**接進遊戲內自動解。人類手動解謎是樂趣核心。
- **早期存檔政策**：正式 release candidate 前不維護跨 build 存檔相容、legacy generator 或 migration chain；save correctness 只保證同 content build。見 `docs/development-policy.md`。
- **模組擁有權**：同時只有一個 agent 改某模組 public interface；其他人對凍結介面寫，別動別人的 public interface。見 `docs/module-ownership.md`。
- **bug 回報**：一律附 `seed + tick 區間 + input trace`（+ 違反的不變式 / 壞掉的 tick）。

## Project Docs

- Design（canonical）：`docs/design.md`
- Overview：`docs/overview.md` ｜ Structure：`docs/structure.md` ｜ Notes：`docs/notes.md`
- Plan：`docs/plan.md` ｜ Roadmap：`docs/roadmap.md`
- Invariants：`docs/invariants.md` ｜ Module ownership：`docs/module-ownership.md` ｜ Decisions：`docs/decisions.md`
- Early development policy：`docs/development-policy.md`
