# Plan

## In Progress

- **Phase 1 — 最小可見（:53346）**：PixiJS 並列畫 2 圖（四特徵 + 迷霧）+ 機器擺放（旋轉/flip）+ 雙圖同步掃動 + React 研究室 UI + Playwright 截圖 smoke。

## Done

- **Repo 初始化**：agents_rule base + docs/ + 公開 GitHub repo。✅
- **Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）** ✅
  - 工具鏈：TS/vitest/fast-check/eslint（含 sim 確定性 guard）；`npm run check`（tsc + lint + vitest + e2e）。
  - `phase0_interfaces.ts` 凍結契約（型別 + 簽名 + INV-1..15 + DEFAULT_CATALOG）。
  - `rng`（mulberry32，唯一隨機源）+ `hash`（FNV-1a，replay/determinism）。
  - `drug-graph`（orient/sweep/applyStep/evaluate/revealAlong；supercover 對角掃動；translate 四關係 順逆垂直偏移；INV-1..8）。
  - `solver`（多圖 BFS 最小解；INV-13；dev/test 限定）。
  - `mapgen`（建構式生成 + 難度評分 + 指數定價；INV-9..12）。
  - CLI `tools/headless-sim.ts`（gen/run）。
  - **完成定義達成**：`npm run sim gen <seed>` 生出 2 圖、可解、難度達標、附基礎藥價；`run` 印各圖最終位置/療效/失敗；求解器任意種子找得到解；property 全綠；同 seed 逐位元可重現。

## Next Up

- Phase 1 完成定義：能在瀏覽器手動揭霧、解一條需平衡兩圖的最簡藥方（:53346）。
- 之後：Phase 2 工廠吞吐配平（factory-sim/recipe）、Phase 3 經濟/存讀檔/專利。完整路線圖見 [roadmap.md](roadmap.md)。
- 補強：`state.ts` 完整 SimState/replay harness（目前以 hash.ts 支撐）；擴到 3–4 圖；mapgen 主動製造跨圖張力（目前 reference 解多為同步前移，跨圖衝突由引擎支援但生成未強調）。
