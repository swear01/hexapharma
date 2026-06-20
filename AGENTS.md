# BEGIN agents_rule-base
# Agent Rules

## Core Rules

### Stay On Task
Execute ONLY what was requested. If unclear, STOP and ASK. Do NOT assume.
One task at a time. After completing the task, STOP.

### Search First, Never Guess
NEVER fabricate code, file paths, function names, or API behavior from memory.
BEFORE writing or editing, read the existing code first.
BEFORE answering about code, search with Grep or Glob.
BEFORE answering about libraries, APIs, or tools, search the web or official docs.
BEFORE answering about anything time-sensitive (current versions, recent changes,
live data, pricing, compatibility) — do a web search. Never rely on memory alone.
If you don't know, use tools — codebase search AND web search. Do NOT guess.

### Code Quality
Match existing code style, naming, and patterns.
No new libraries unless asked. No comments unless asked.
Keep changes minimal.

### No-Useless Options
When changing behavior, change it — do not keep the old behavior as an option.
Never add flags, parameters, or config options that were not explicitly requested.
If you are about to add an "option to preserve old behavior," stop: just change the behavior.

## No Silent Fallback

### Banned Behaviors
- Silently replacing a failing API/model/library/tool with another
- Returning dummy/mock/empty/default results as if valid
- Broad catch-and-continue (`except Exception`, `catch (error)`, etc.)
- Skipping tests, linters, type checks, or verifiers
- Downgrading implementation scope just to finish
- Hiding failures behind "best effort"

### Allowed Behaviors
- Retry the exact same operation once if transient
- Propose a fallback, but STOP before implementing it
- Use fallback only when explicitly approved by the user

### When Blocked, Report
1. What failed
2. Exact command/tool/API that failed
3. Relevant error output
4. Fallback considered but NOT implemented
5. Decision needed from user

## Docs Lifecycle

- Active docs live under `docs/`.
- Historical docs live under `archive/` (mirrors original path).
- Every behavior/API/CLI/config change must update the relevant active doc.
- Obsolete docs must be archived, not left active.
- Archived docs must not be treated as current truth.
- Active docs must not link to archived docs as active references.

Docs must be fully updated before every commit. No exceptions.

If no docs update is needed, explicitly report:

    Docs checked; no documentation update required.

## Archive Policy

**Archive vs Delete:**
- Archive: doc has historical value (old API, past decision, superseded design)
- Delete: doc is simply wrong, redundant, or never useful — `git rm` it directly

Do not archive to avoid decisions. Archiving inflates repo size; delete what has no value.

Use `agents_rule archive <file>` to archive docs. Do NOT manually move files.

Archive header prepended automatically:

    > Archived: YYYY-MM-DD
    > Reason: <reason>
    > Replacement: <replacement-or-none>
    > Status: historical only; do not use as active truth.

Archives live under `archive/` at project root, preserving original path:

    docs/api.md  →  archive/docs/api.md

The `archive/` tree is excluded from ripgrep by default.

When searching, prefer `rg` over `grep` — it respects `.rgignore` automatically.
If `grep` must be used, always exclude archive/:

    grep -r --exclude-dir=archive ...

## Verification Policy

- Run the smallest relevant verification command before declaring done.
- Never claim tests passed unless they actually ran and passed.
- If verification cannot run, explain exactly why.

Final response must include:
- Files changed
- Docs updated, or: `Docs checked; no documentation update required.`
- Verification command run and result
- Remaining risks

## Git-Safe Move Policy

All tracked file moves MUST use `git mv`. Direct `mv`/`rename` on tracked files is forbidden.

For docs archiving: always use `agents_rule archive`. This ensures the move is recorded as a rename in Git, not delete+add.

Expected `git status` after archiving:

    R  docs/old.md -> archive/docs/old.md
# END agents_rule-base

# HexaPharma

Big Pharma 的工廠 + Potion Craft 的地圖。確定性 sim core（純 TS）＋薄渲染層。詳見 `docs/design.md`。

## Gate（宣告完成前必跑，唯一驗收標準）

`npm run check` → `tsc --noEmit && lint && vitest run && playwright test --headless`

> 工具鏈尚未 scaffold（Phase 0 建立 `package.json`）。在那之前，跑已存在的對應子集。

## Hard Rules（HexaPharma 專屬，AI 推不出來的才放這）

- **code-as-truth**：不用引擎視覺編輯器、不用 scene 檔。所有內容是資料，runtime 生成 + 程式碼畫出。
- **sim core 是純的**：`src/sim/**` **禁** import Pixi / React / DOM，必須能在 node headless 跑。
- **sim/mapgen 確定性**：禁 `Math.random()`（走 `rng`）、禁 `Date.now()`/`performance.now()`（時間 = tick 計數）。不得依賴 `Set`/`Map` 迭代順序做有副作用邏輯。離散量用整數；比例（scale）用有理數（分子/分母），**不用 float**。
- **mapgen 純由 seed 決定**：同 seed → 逐欄位相等的地圖 + 難度 + 藥價。
- **熱迴圈禁 `new`**：每 tick 的熱迴圈用 object pool / TypedArray，不在迴圈內 `new` 物件或產生新陣列。冷路徑（Lab/UI）照常。
- **求解器只 dev/test 用**：**絕不**接進遊戲內自動解。人類手動解謎是樂趣核心。
- **模組擁有權**：同時只有一個 agent 改某模組 public interface；其他人對凍結介面寫，別動別人的 public interface。見 `docs/module-ownership.md`。
- **bug 回報**：一律附 `seed + tick 區間 + input trace`（+ 違反的不變式 / 壞掉的 tick）。

## Project Docs

- Design（canonical）：`docs/design.md`
- Overview：`docs/overview.md` ｜ Structure：`docs/structure.md` ｜ Notes：`docs/notes.md`
- Plan：`docs/plan.md` ｜ Roadmap：`docs/roadmap.md`
- Invariants：`docs/invariants.md` ｜ Module ownership：`docs/module-ownership.md` ｜ Decisions：`docs/decisions.md`
