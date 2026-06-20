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
- **Phase 2 — 工廠吞吐配平** ✅：`factory-sim`（belt/machine tick、throughput、bottleneck、deadlock；質量守恆/確定性）+ `state.ts`（replay → INV-15）+ `recipe`（模板→產線 + 重排不變 INV-7）+ Factory 視覺（放慢機器見瓶頸、並聯提升吞吐）。
- **Phase 3 — 經濟/存讀檔/專利 + 循環** ✅：`economy`（遞減定價 + 反退化 + 帳務守恆）+ `save`（round-trip + 多存檔/回溯）+ `patent`（天賦樹 + 解鎖新地圖）+ 完整循環 UI（Lab→Factory→Shop→Patents）+ 存讀檔。
- **整合**：`test/integration/loop.test.ts` headless 跑通 探索→研究→量產→賣→專利→更深；`npm run check` 全綠（vitest + e2e）。

## Next Up

- 平衡（求解器掃配方/吞吐空間）、反退化實測；擴到 3–4 圖（型別已支援 N）。
- 內容量產（更多疾病/原料/機器變換 = 純資料）；美術打磨；存檔 UI 多槽位/回溯打磨。
- 補強：機器形狀/多 port（目前 1×1）、factory 內 splitter/merger、難度分納入包圍度等因子。
- 完整路線圖見 [roadmap.md](roadmap.md)。
