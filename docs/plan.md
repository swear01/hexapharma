# Plan

## In Progress

- **Lab 空間化 TDD 改造（本輪主線）**：以 [D19](decisions.md) 取代 Recipe-list authority，依下列順序紅→綠→重構；每階段先補 pure/property/integration tests，再改 production，最後補 Playwright 與文件。
  1. **共享 blueprint contract**：定義／驗證 exact `ProductionBlueprint`；Pilot Bench 初期只接受唯一 source、唯一 sink、無 cycle、無 split/merge 的 source→sink 拓撲，確定性推導 `Template.steps`。拒絕 missing/disconnected/ambiguous graph，不猜順序。
  2. **Atlas grid 與尺度**：cell 由 64px 改約 40px；每格 minor、每5格 major、origin axes/coordinates；zoom 時 minor 淡出而 major 保留，grid 不洩漏 fog features。純 camera/grid tests 與固定 screenshot 先行。
  3. **機器 catalog／shape 重做**：現行 translate 效果距離為 3／4／7 格，footprint 為 3–8 格；每台同時具有不同 transform、shape/ports、cost/speed。先守 orientation、world cells/ports、sweep outcome、determinism與catalog boundary，再以玩測調內容數值。
  4. **連通 feature generation**：cure 固定5–9格；side effect／wall／hazard 保留既有5%／4%／3%整數密度但改為連通 biome。property tests 守連通、面積、reference 可解、fog不洩漏、同 seed 逐欄位相等。potency core 以整數資料加入時同步定價／Outcome tests。
  5. **Pilot Bench direct manipulation**：與 Factory 共用 footprint、ports、belt、collision、rotation、ghost/buildability；加入 placement/erase/pipette/history、invalid topology feedback，以及 Atlas↔Bench machine/segment 雙向高亮。Recipe timeline 改成唯讀 breadcrumb/scrubber/Run playhead。
  6. **exact Lab→Factory transfer**：Save 原子驗 blueprint + derived template + outcome + entitlement；Factory 逐欄位接收 layout/tiles/anchors/rotations/ports/routing，不走 template compiler auto-pack。integration/property tests 守 exact equality；進 Factory 後才允許在 effect order contract 下並聯、重排。
  7. **整合與多輪檢查**：更新 screenshot baselines，Playwright 覆蓋 desktop/compact 焦點交換、fog preview、Bench build/run、invalid graph、exact transfer；跑 `npm run check`，再以 `0.0.0.0:53346` 真人玩測完整 Lab→Factory 循環並至少做一輪 UX 修正。
- **平衡刻意後置**：新 catalog／區域 mapgen 穩定後，才重新跑 seed sweep、最短解成本、吞吐、難度與售價。既有「17 個 difficulty-12 outlier」屬舊 catalog 基線，不拿來宣稱新系統平衡；主觀數值可慢慢調，但空間 authority、可讀性與 exact transfer 是本輪 correctness/UX 必修。

## Done

- **Repo 初始化**：agents_rule base + docs/ + 公開 GitHub repo。✅
- **Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）** ✅
  - 凍結契約 `phase0_interfaces.ts`（型別 + 簽名 + INV + DEFAULT_CATALOG）。
  - `rng`（mulberry32）+ `hash`（FNV-1a）。
  - `drug-graph`（orient/supercover sweep/applyStep/evaluate/revealAlong；translate 四關係 順逆垂直偏移；INV-1..8）。
  - `solver`（多圖 BFS；複合難度 = 步數 + 多樣性 + 解耦；INV-13；dev/test 限定）。
  - `mapgen`（production 建構式生成；solver 僅 tests/tools；difficulty price 用 BigInt exact `17/10` rational half-up，d0–58 保持舊值；此機械修正非人工平衡）。
- **Phase 1 — 研究室視覺（:53346）** ✅：PixiJS + React Lab（palette/旋轉/flip/Run 動畫/結果）+ 依 seed 玩生成關卡；現行版已取代早期多圖並排/debug reveal 表現。
- **中心大圖／局部 atlas／1–4 layer 進程** ✅：新局為單一`63×63` Layer A、start/origin正中央，初始fog radius 3=`49/3969`。Lab固定`704×512`、40px cell約`17×13`局部視野，pan/zoom/follow、A–D tabs、culling、opaque fog、每格minor grid、每5格major grid與origin axes皆已完成。B/C/D deterministic phase starts與A↔B lock語意不變。
- **Phase 2 — 工廠吞吐配平** ✅：`factory-sim`（belt/多格多 port 機器 tick、splitter/merger 真並聯、throughput、bottleneck、deadlock；質量守恆/確定性）+ `state.ts` 工廠 replay + `recipe` 重排不變 + Factory 視覺。splitter 只收 `inDir` 且 per tile cursor round-robin，merger 只收 `inDirs` 且依序固定優先；cursor 進 runtime/snapshot/hash/save。機器 cost/speed 由 catalog 固定；effectRot/effectFlip 與 footprint footRot 分離。
- **Phase 3 — 經濟/存讀檔/專利 + 循環** ✅：single state/head ≤4,096 entries/≤100,000 ticks/≤100,000,000 work；rewind共用aggregate ≤12,000/≤8,192/≤100,000,000。full/compact readers從raw origin+trace preflight；`deserializeSlots`在任何state replay前驗aggregate，`serializeSlots`同界。legacy先history、必要時head-alone；compact另限20/1,250,000 chars。timeline同origin/normalization-aware，跨run replace。
- **早期開發政策**：上述 save correctness 僅限同 content build；跨 build migration／legacy generator 明確不在目前範圍，breaking update 可清除舊 localStorage。正式 freeze 條件見 [development-policy.md](development-policy.md)。
- **2026-07 TDD 計劃書對齊修正** ✅：完整GameState reducer；≤4,096 entries/≤100,000 ticks/≤100,000,000 work，inventory≤24,500、bulk≤100,000。正常`24×12` Pilot reference的100,000-tick trace約85,313,612。public/Game map/factory分層、`24×12 + patent delta`、Int32 side effects、實體產品/R&D/patents與production無solver均完成。
- **strict factory zero-allocation 熱路徑** ✅：`FactoryRuntime`為固定容量SoA，geometry/index冷編譯，buffers全預配置；runtime綁layout + `MultiMap` identity，成功tick原地更新。diagnostics ≤100,000 ticks/≤100,000,000 layout work，init/tick前驗`(area + machines + sources)² × observationTicks`，避免同步`useMemo`鎖UI。throughput serpentine 20×20成功/21×21 fail-fast；outcome 20×20成功/22×22 fail-fast（21×21仍低於cap）。`factoryOutcome`deadlock/首產品 exhaustion throw；throughput真deadlock回`0/1`與null bottleneck，window/work超budget才throw並顯示alert。
- **輸入、錯誤與持久化 authority 補強** ✅：authority inputs owned/frozen；public/Game map/factory、template、inventory、seed/tool bounds完成；patent helpers拒絕invalid tree/state/cash/research，`activeEffects` aggregate用checked safe-integer add。完整save拒絕不一致state；compact inspector從raw trace重算work再replay。storage、analysis、intent/save failures全部顯式UI error；Load/Save/Rewind不踩壞blob。
- **production dependency / bundle 補強** ✅：ESLint在production `src/**`禁止static/dynamic solver import；Lab/Factory Pixi renderer dynamic import、啟動錯誤可見，production build所有chunk <500 kB且無warning。Game map authority每邊≤64／每圖≤4,096；Lab固定viewport + culling，production-preview於`:53348`除四tab lazy-load/零runtime error外直接驗最大`64×64`。Pixi teardown不釋放global pools。
- **固定視覺回歸 baseline** ✅：Lab fogged 與 Factory reset 的 Playwright `toHaveScreenshot` expected snapshots 已納入本輪工作成果與 e2e pixel-diff（目前工作樹未 commit 時不宣稱「已提交」）。
- **工廠遊戲式 UI／互動重做** ✅：以 Big Pharma／shapez 2／Factorio 的互動語言為研究基準、但使用 HexaPharma 原創視覺。完成 viewport shell、persistent HUD、F1–F4 rail、hotbars、inspectors、Market cards、Patent lattice；Factory 完成 drag build/erase、touch tap/pan、wheel anchor zoom、camera reset、rotate/mirror/pipette、clipboard、50-step undo/redo；active-view keyboard isolation、pointer chrome click-through、390/768/1024 responsive reachability與四 view 現行視覺 baseline 有 Playwright，Before／After 比較則保存於 active design 文件。
- **Lab 原創生化貼圖** ✅：`public/assets/lab/manifest.json` 定義 substrate/fog/wall/hazard/side-effect/cure/drug/halo，`README.md` 記錄原創 image generation、處理與權利；renderer只在revealed terrain畫內容，載入失敗可見，不使用競品圖像或debug fallback。
- **Lab route 可讀性** ✅：Run 期間由 sim 逐步 DrugState 畫 active-layer cyan route history；Phase Exchange 前後斷線，避免誤示有掃格／穿牆；halo 僅標目前 token，Reset／recipe edit 清 route，persistent fog 不受影響。
- **Recipe 直接操作與放置預覽（歷史基線，D19 將取代其 authority）** ✅：原本右側 raw-text log 已換成底部水平指令軌與共用 SVG machine pictogram，且 preview/fog-safe sweep 已可重用。插入槽、卡片 reorder 與 Recipe 自有 history 是現行已實作基線；本輪將移除其 authority，timeline 保留為由 Pilot Bench 拓撲推導的唯讀 breadcrumb/scrubber/playhead。
- **整合**：`src/sim/game.test.ts`與integration tests守整局vertical trace；checkpoint/save tests守lineage、cross-run、legacy/full-wire preflight。factory tests守throughput 20×20/21×21 work邊界；recipe tests守outcome 20×20/22×22邊界。Playwright覆蓋Factory analysis alert與固定baseline；production-preview驗最大map canvas。

## Next Up

- 新空間 authority 完成後：以求解器掃新 catalog 的最短解成本/吞吐，調整 difficulty→price 曲線與旗標門檻，最後在 3–4 圖真人循環驗證反退化。
- **Post-MVP roadmap**：更多疾病／原料／非同質 transform、正式美術與上架打磨；不再把機器 footprint 與 Lab 空間化列作可延後的純內容工作。
- 難度分是否納入包圍度、potency core 價差等因子，待真人玩測資料決定；不把主觀曲線工作混稱為程式 correctness。
- 完整路線圖見 [roadmap.md](roadmap.md)。
