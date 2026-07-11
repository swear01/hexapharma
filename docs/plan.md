# Plan

## In Progress

- 真人試玩 + 平衡：在 :53346 跑完整循環，調難度曲線/定價/吞吐節奏（不可約的人工判斷）。目前 100-seed sweep 為 100/100 可生成，但 17 個 difficulty-12 樣本達中位淨利/tick 的 4.88×，尚未宣稱平衡完成。
- 出貨品質：持續做真人視覺/UX review。

## Done

- **Repo 初始化**：agents_rule base + docs/ + 公開 GitHub repo。✅
- **Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）** ✅
  - 凍結契約 `phase0_interfaces.ts`（型別 + 簽名 + INV + DEFAULT_CATALOG）。
  - `rng`（mulberry32）+ `hash`（FNV-1a）。
  - `drug-graph`（orient/supercover sweep/applyStep/evaluate/revealAlong；translate 四關係 順逆垂直偏移；INV-1..8）。
  - `solver`（多圖 BFS；複合難度 = 步數 + 多樣性 + 解耦；INV-13；dev/test 限定）。
  - `mapgen`（production 建構式生成；solver 僅 tests/tools；difficulty price 用 BigInt exact `17/10` rational half-up，d0–58 保持舊值；此機械修正非人工平衡）。
- **Phase 1 — 研究室視覺（:53346）** ✅：PixiJS + React Lab（palette/旋轉/flip/Run 動畫/結果）+ 依 seed 玩生成關卡；現行版已取代早期多圖並排/debug reveal 表現。
- **中心大圖／局部 atlas／1–4 layer 進程** ✅：新局為單一`63×63` Layer A、start/origin正中央，初始fog radius 3=`49/3969`。Lab固定`704×512`、約`11×8`局部視野，支援drag pan、wheel anchor zoom、`F` follow、A–D tabs與viewport culling；未知區用原創opaque biochemical fog，不再畫「?」或並排全圖。B/C/D 使用deterministic near-center phase starts；A↔B Phase Exchange單層鎖定。`new-map`／`new-map-4`／`deep-map-4` 完成1→2→3→4且尺寸維持63。deeper reset 清 recipe/factory/runtime/waste/inventory/fog + `economy.sold`，UI 完整警告且需 confirmation；保留扣款後 cash/R&D、patents 與全域 inventory ID。`?nmaps=`/`?seed=`/`?cash=`/`?research=` 僅覆蓋測試/試玩起始值。
- **Phase 2 — 工廠吞吐配平** ✅：`factory-sim`（belt/多格多 port 機器 tick、splitter/merger 真並聯、throughput、bottleneck、deadlock；質量守恆/確定性）+ `state.ts` 工廠 replay + `recipe` 重排不變 + Factory 視覺。splitter 只收 `inDir` 且 per tile cursor round-robin，merger 只收 `inDirs` 且依序固定優先；cursor 進 runtime/snapshot/hash/save。機器 cost/speed 由 catalog 固定；effectRot/effectFlip 與 footprint footRot 分離。
- **Phase 3 — 經濟/存讀檔/專利 + 循環** ✅：single state/head ≤4,096 entries/≤100,000 ticks/≤100,000,000 work；rewind共用aggregate ≤12,000/≤8,192/≤100,000,000。full/compact readers從raw origin+trace preflight；`deserializeSlots`在任何state replay前驗aggregate，`serializeSlots`同界。legacy先history、必要時head-alone；compact另限20/1,250,000 chars。timeline同origin/normalization-aware，跨run replace。
- **2026-07 TDD 計劃書對齊修正** ✅：完整GameState reducer；≤4,096 entries/≤100,000 ticks/≤100,000,000 work，inventory≤24,500、bulk≤100,000。正常100,000-tick reference約31,000,000。public/Game map/factory分層、`9×6 + patent delta`、Int32 side effects、實體產品/R&D/patents與production無solver均完成。
- **strict factory zero-allocation 熱路徑** ✅：`FactoryRuntime`為固定容量SoA，geometry/index冷編譯，buffers全預配置；runtime綁layout + `MultiMap` identity，成功tick原地更新。diagnostics ≤100,000 ticks/≤100,000,000 layout work，init/tick前驗`(area + machines + sources)² × observationTicks`，避免同步`useMemo`鎖UI。throughput serpentine 20×20成功/21×21 fail-fast；outcome 20×20成功/22×22 fail-fast（21×21仍低於cap）。`factoryOutcome`deadlock/首產品 exhaustion throw；throughput真deadlock回`0/1`與null bottleneck，window/work超budget才throw並顯示alert。
- **輸入、錯誤與持久化 authority 補強** ✅：authority inputs owned/frozen；public/Game map/factory、template、inventory、seed/tool bounds完成；patent helpers拒絕invalid tree/state/cash/research，`activeEffects` aggregate用checked safe-integer add。完整save拒絕不一致state；compact inspector從raw trace重算work再replay。storage、analysis、intent/save failures全部顯式UI error；Load/Save/Rewind不踩壞blob。
- **production dependency / bundle 補強** ✅：ESLint在production `src/**`禁止static/dynamic solver import；Lab/Factory Pixi renderer dynamic import、啟動錯誤可見，production build所有chunk <500 kB且無warning。Game map authority每邊≤64／每圖≤4,096；Lab固定viewport + culling，production-preview於`:53348`除四tab lazy-load/零runtime error外直接驗最大`64×64`。Pixi teardown不釋放global pools。
- **固定視覺回歸 baseline** ✅：Lab fogged 與 Factory reset 的 Playwright `toHaveScreenshot` expected snapshots 已納入本輪工作成果與 e2e pixel-diff（目前工作樹未 commit 時不宣稱「已提交」）。
- **工廠遊戲式 UI／互動重做** ✅：以 Big Pharma／shapez 2／Factorio 的互動語言為研究基準、但使用 HexaPharma 原創視覺。完成 viewport shell、persistent HUD、F1–F4 rail、hotbars、inspectors、Market cards、Patent lattice；Factory 完成 drag build/erase、touch tap/pan、wheel anchor zoom、camera reset、rotate/mirror/pipette、clipboard、50-step undo/redo；active-view keyboard isolation、pointer chrome click-through、390/768/1024 responsive reachability與四 view 現行視覺 baseline 有 Playwright，Before／After 比較則保存於 active design 文件。
- **Lab 原創生化貼圖** ✅：`public/assets/lab/manifest.json` 定義 substrate/fog/wall/hazard/side-effect/cure/drug/halo，`README.md` 記錄原創 image generation、處理與權利；renderer只在revealed terrain畫內容，載入失敗可見，不使用競品圖像或debug fallback。
- **Lab route 可讀性** ✅：Run 期間由 sim 逐步 DrugState 畫 active-layer cyan route history；Phase Exchange 前後斷線，避免誤示有掃格／穿牆；halo 僅標目前 token，Reset／recipe edit 清 route，persistent fog 不受影響。
- **整合**：`src/sim/game.test.ts`與integration tests守整局vertical trace；checkpoint/save tests守lineage、cross-run、legacy/full-wire preflight。factory tests守throughput 20×20/21×21 work邊界；recipe tests守outcome 20×20/22×22邊界。Playwright覆蓋Factory analysis alert與固定baseline；production-preview驗最大map canvas。

## Next Up

- 平衡：針對目前 17 個高難度淨利 outlier 決定「進程獎勵」的可接受區間，再以求解器掃最短解成本/吞吐、調整 difficulty→price 曲線與旗標門檻，最後在 3–4 圖真人循環驗證反退化。
- **Post-MVP roadmap（不是目前 correctness gap）**：內容量產（更多疾病/原料/機器變換 = 純資料）、更多機器形狀/footprint、正式美術與上架打磨。
- **平衡/設計後續**：難度分是否納入包圍度等因子，待真人玩測資料決定；不把這類主觀曲線工作混稱為尚未修好的程式 correctness。
- 完整路線圖見 [roadmap.md](roadmap.md)。
