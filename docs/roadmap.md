# Roadmap

> 原則：**先做 sim 模組（headless、過閘），再加薄薄一層 render/UI**；不讓 agent 一次做整款。

## Phase definitions

### Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）
- `drug-graph`（正方格四特徵、機器=transform union、逐格掃動、N=1..4、最終位置判定、迷霧）
- `solver`（多圖搜尋）、`mapgen`（建構式 + 難度評分 + 基礎藥價）
- 完整 property test + 不變式 + CLI harness + replay；同時驗證方法論（環境相容的隔離策略、契約、`npm run check`、replay）
- **完成定義**：CLI 給種子 → 1–4 圖可解、難度達標、附藥價；給機器+朝向 → 印各圖結果；求解器任意種子找得到解；property 全綠；replay 可重現

### Phase 1 — 最小可見（看得到謎題）
- PixiJS 固定`704×512`局部研究室 viewport（原創生化地形、迷霧、feature sprites）+ 機器擺放（旋轉/flip）+ active-layer藥物掃動；React 研究室 UI；Playwright smoke + 固定 `toHaveScreenshot` baseline
- **驗證重點**：單層探索教學，解鎖B後的跨圖拉扯 + translate/scale/Phase Exchange 三變換 + 牆當停點/危險即死的手感
- **完成定義**：能在瀏覽器由`63×63`中心的49格可見區開始，手動pan/zoom/follow、揭霧並解藥方；多層時用A–D tabs切換

### Phase 2 — 工廠吞吐配平
- `factory-sim`（tick 推進、processing cost/速度、belt 吞吐、瓶頸偵測；splitter `inDir` + per-tile cursor round-robin；merger `inDirs` 固定優先）+ 質量守恆/無死鎖/吞吐一致不變式 + 渲染層；`recipe` 模板→產線 + 重排驗證
- **完成定義**：Phase 1 藥方鋪成產線 headless 穩定產出；catalog 定義的慢機器形成可見瓶頸；並聯/重排提升吞吐且效果不變；守恆恆成立

### Phase 3 — 經濟 / 存讀檔 / 專利 / 解鎖新地圖
- `economy`（物理庫存、各疾病 sold-counter 遞減/難度分→藥價/結算；目前無訂單系統）、`save`（多存檔 + 回溯 + declared-origin trace replay）、`patent`（解機器/變換/擴廠/揭霧/解鎖新成分地圖）
- **完成定義**：可循環 vertical slice（探索→研發→量產配平→賣→投專利/解新地圖→更深）；多存檔回溯正常；驗證「狂產單一藥物 ≠ 簡單最佳解」

### Phase 3 之後（進行中 / Next）
- **Phase 4 — Spatial Lab / exact prototype transfer（In Progress）**：Lab 改為同步 Effect Atlas + Pilot Bench；約40px adaptive major/minor grid；cure/side-effect/hazard/wall連通區；small 3／medium 4–5／large 6–9+效果尺度與對應 footprint/ports/throughput tradeoff；Bench實體layout為authority，由唯一source→sink拓撲推導唯讀Recipe timeline；保存exact ProductionBlueprint並原位轉入Factory，移除Lab→Factory auto-pack路徑。
- **Phase 4 完成定義**：玩家從 Atlas 探索連通療效區，在 Bench 以真實 footprint／ports 建出可執行原型；timeline 只讀且與拓撲一致；invalid/ambiguous graph 明示拒絕；Lab→Factory 前後 layout 逐欄位相等；desktop/compact Playwright、視覺 baseline、property/integration tests 與 `npm run check` 全過，再以`:53346`完成真人循環玩測與一輪UX修正。
- **之後**：真人完整循環玩測、實際淨利／吞吐／難度平衡與正式內容量。strict mutable factory runtime、存檔 authority、bundle split、Factory interaction redesign，以及 Lab 第一套原創 production atlas 已完成，不再列為技術債；Recipe-list authority 與 auto-pack 則由 Phase 4 明確取代。
- **Pre-release policy**：正式 save format freeze 前不做跨 build migration；breaking update 可淘汰舊開發存檔。進入 release candidate 時才規劃 migration matrix 與相容期。
- **Post-MVP / Next**：更多疾病／原料／非同質機器變換、更多正式美術與上架打磨。Lab 空間化、核心 machine footprint/scale、連通區域與 exact transfer 是 Phase 4 必修，不再歸類為可延後的純內容工作。

## Recently Done

- **2026-07 TDD 計劃書對齊修正** ✅：Game single authority/head≤4,096 entries/≤100,000 ticks/≤100,000,000 work，正常`24×12` Pilot reference的100,000-tick trace約85,313,612。full/compact raw-work preflight；rewind/legacy/slots共用12,000 ticks/8,192 entries/100,000,000 aggregate，deserializeSlots先aggregate後state replay，serializeSlots同界。compact另限20/1,250,000 chars；timeline/cross-run/legacy recovery完成。
- **strict factory runtime / routing / authority bounds** ✅：fixed SoA runtime綁layout + `MultiMap` identity，routing cursor進snapshot/hash/save，成功tick零配置。public mapgen/factory各≤65,536 cells；Game map≤64/side/≤4,096、factory≤256/side/≤4,096；base entitlement`24×12 + patent delta`。`sideEffectId`為Int32；public patent invalid state與effect aggregate overflow顯式reject。
- **build、UI authority 與 renderer lifecycle** ✅：renderer dynamic import/error可見；Lab無stale outcome，Factory分標sink outcomes/waste。diagnostics在init/tick前驗100,000,000-unit layout-work cap，避免大layout同步鎖UI；exhaustion顯示alert，throughput真deadlock回`0/1`與null bottleneck。Lab固定`704×512` + culling；production-preview守最大`64×64`。chunks <500 kB；StrictMode teardown安全。
- **持久化/analysis regression coverage** ✅：checkpoint tests守raw-work preflight、normalization-aware same-origin lineage、different-run canonical replacement、mixed-legacy invalid/head-only recovery與24,500-item compact/full-wire-cap分離；Playwright守Factory analysis alert；production-preview實際載入最大Game-authorized `64×64` map。
- **固定視覺回歸** ✅：Lab fogged + Factory reset 的 Playwright `toHaveScreenshot` expected baselines 已納入本輪工作成果與 e2e pixel diff；在目前未 commit 工作樹不宣稱已提交。
- **直接操作 UI** ✅：全螢幕 shell、HUD、F1–F4 rail、hotbars、inspectors、Market cards、Patent lattice；Factory 支援 drag build/erase、touch tap/pan、wheel zoom、Q/R/H/V、clipboard 與 50-step history。active-view key isolation、modal focus、compact HUD／world reachability與 chrome click-through 由 Playwright 守住；Before／After 與競品差異見 `ui-interaction.md`。
- **Recipe 指令軌／預覽（歷史基線）** ✅：Lab hotbar、pictogram、逐格 candidate route、fog-safe preview、scrub/playhead與50-step history已完成；Phase 4重用 preview/pictogram/playhead，但以Pilot Bench topology取代插入槽、drag reorder與Recipe-list authority。
- **設計對齊大改** ✅：把工廠那半做真——機器多格形狀 + 多 port + footRot 空間打包、傳送帶 splitter/merger 真分流匯流、真並聯吞吐（measured，非 heuristic）；Lab改為預設1張`63×63`中心開場、局部viewport與原創生化fog/貼圖；map patents 依序1→2→3→4且尺寸固定，後續layer phase offsets讓A↔B交換有實際意義。

- **Phase 3 — 經濟/存讀檔/專利 + 完整循環** ✅：economy（遞減定價+反退化+帳務守恆）、save（round-trip+多存檔/回溯）、patent（天賦樹+解鎖新地圖）、循環 UI（Lab→Factory→Shop→Patents）。headless 整合測試跑通整條循環。
- **Phase 2 — 工廠吞吐配平** ✅：factory-sim（tick/throughput/bottleneck/deadlock）、state.ts（replay INV-15）、recipe（模板→產線+重排不變 INV-7）、Factory 視覺。
- **核心修正** ✅：補回 offset（第四種關係）+ supercover 對角掃動；求解器複合難度；mapgen單層/跨圖建構與phase starts；Lab玩生成關卡。
- **Phase 1 — 最小可見（:53346）** ✅：PixiJS v8局部active-layer atlas、React研究室UI、A–D切換、Playwright headless smoke + 固定screenshot baseline；手動可探索並解藥方達WIN。
- **Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解** ✅：drug-graph / solver / mapgen / rng / hash + 凍結契約 + CLI；difficulty price以BigInt exact 17/10 rational half-up（d0–58舊值不變，非平衡調整）；seed parser只收完整uint32，balance sweep≤100,000且超限fail-fast。
- 工具鏈：TS6 / Vite8 / React19 / PixiJS8 / vitest4(+fast-check) / Playwright；`npm run check` = tsc + lint(+sim 確定性 guard) + vitest + `playwright test`。Playwright 預設 headless；Chromium e2e 用 dev `:53347`，production-preview project 先 build 並在 `:53348` 驗四 tab lazy load/零 runtime errors。
- Repo 初始化：agents_rule base block + CLAUDE.md symlink + docs/ 活文件；本輪 baseline/regression/修正描述為目前工作成果，是否已 commit/push 以 `git status`/Git 歷史為準。
