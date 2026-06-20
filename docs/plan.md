# Plan

## In Progress

- 真人試玩 + 平衡：在 :53346 跑完整循環，調難度曲線/定價/吞吐節奏（不可約的人工判斷）。

## Done

- **Repo 初始化**：agents_rule base + docs/ + 公開 GitHub repo。✅
- **Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）** ✅
  - 凍結契約 `phase0_interfaces.ts`（型別 + 簽名 + INV + DEFAULT_CATALOG）。
  - `rng`（mulberry32）+ `hash`（FNV-1a）。
  - `drug-graph`（orient/supercover sweep/applyStep/evaluate/revealAlong；translate 四關係 順逆垂直偏移；INV-1..8）。
  - `solver`（多圖 BFS；複合難度 = 步數 + 多樣性 + 解耦；INV-13；dev/test 限定）。
  - `mapgen`（建構式生成 + **跨圖張力**（各圖不同原點 + 他圖端點 Hazard，求解器 oracle 驗證解耦）+ 指數定價；INV-9..12 + tension 不變式）。
- **Phase 1 — 研究室視覺（:53346）** ✅：PixiJS 並列畫 2 圖（四特徵 + 迷霧 + 藥物）+ React Lab（palette/旋轉/flip/Run 動畫/結果）+ 依 seed 玩生成關卡 + reveal debug。
- **UI 迷霧探索 + 3–4 圖 + 專利接線** ✅：研究室改為**真實累積探索**——Game 持有每圖 persistent fog（Uint8Array，初始全霧），每次 Run 把 `revealAlong` 揭露的格 union 進去；未揭露格畫成「?」UNKNOWN，Reset 不收回已探索，載入新關卡才重置；保留「Reveal all (debug)」開關（預設關）。labRenderer 以 2-per-row grid 排 N=2..4 圖並按 N 縮小格子。專利接線：`reveal-aid` 在各圖 start 周圍揭一個半徑（= amount，Chebyshev，確定性）；`new-map` 重生**更深**關卡（`nMaps=min(4,nMaps+1)`、N≥3 縮圖到 7×7／6×6、重置 recipe/factory/inventory + 新霧、保留 cash + patents）。起始 N 可用 `?nmaps=`／`?seed=` query 覆蓋（預設 N=2，供深圖試玩 / N-map 測試）；起始現金可用 `?cash=` 覆蓋（整數，預設 START_CASH，供 e2e / 試玩買專利）。Lab level-info 另顯示 `maps N` 與 `revealed R/T`（across 所有圖的已揭格數），供測試判斷揭霧成長與關卡加深。
- **Phase 2 — 工廠吞吐配平** ✅：`factory-sim`（belt/多格多 port 機器 tick、splitter/merger 真並聯、throughput、bottleneck、deadlock；質量守恆/確定性）+ `state.ts`（replay → INV-15）+ `recipe`（模板→產線 + 重排不變 INV-7）+ Factory 視覺（放置多格機器 + footRot 旋轉、splitter/merger 佈線、放慢機器見瓶頸、splitter→兩機器→merger 真並聯提升吞吐）。
- **Phase 3 — 經濟/存讀檔/專利 + 循環** ✅：`economy`（遞減定價 + 反退化 + 帳務守恆）+ `save`（round-trip + 多存檔/回溯）+ `patent`（天賦樹 + 解鎖新地圖）+ 完整循環 UI（Lab→Factory→Shop→Patents）+ 存讀檔。
- **整合**：`test/integration/loop.test.ts` headless 跑通 探索→研究→量產→賣→專利→更深；`npm run check` 全綠（vitest + e2e）。

## Next Up

- 平衡（求解器掃配方/吞吐空間）、反退化實測（3–4 圖 UI/loop 已接，見上）。
- 內容量產（更多疾病/原料/機器變換 = 純資料）；美術打磨；存檔 UI 多槽位/回溯打磨。
- 補強：難度分納入包圍度等因子；更多機器形狀/footprint 內容。
- 完整路線圖見 [roadmap.md](roadmap.md)。
