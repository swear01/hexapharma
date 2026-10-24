# Roadmap

> 先完成 headless authority，再接薄 render/UI；每階段以當前 commit 的 `npm run check` 驗收。早期實作紀錄不凌駕現行 design。

## Foundation

### Phase 0 — Drug graph / mapgen / solver

完成 deterministic path/evaluate、seeded RNG/hash、terrain-first constructive generation與 dev/test-only solver minima。

### Phase 1 — Research Atlas

完成 Pixi/React 大型pointy-top axial Atlas、q/r camera picking、fog、terrain/portal 與原創程式化視覺。現行規則是單層；霧下只畫由地勢算出的等高線，所有地表與互動物隱藏至揭露（v2 Step 2）。

### Phase 2 — Factory sim

完成 fixed-capacity SoA runtime、multi-cell machines、belt、splitter/merger、throughput/deadlock、cold snapshot/hash。

### Phase 3 — Economy / Technology / save

完成 Market、Knowledge、shipping contracts、patents、獨立 intent replay debug／開放 checkpoint。當前 wire 是 Save v14（v2 Step 4），早期 schema 不再支援。

### Phase 4 — Direct-operation shell

完成 F1–F3 world shell、drawers、Factory direct manipulation、responsive patterns 與三場域分離。

### Phase 5 — Single-Atlas fixed paths

完成奇形 PathStamp、terrain-aware traversal、radial motifs、Research-only exploration、free Production Plan sandbox 與 actual Production outcomes。

## Current — playable fresh loop and diverse Atlas

- Research machine 只走完整 catalog path；移除所有部分路徑資料與控制。
- Research與Factory authority採pointy-top axial `{q,r}`，direction順序是E／SE／SW／W／NW／NE，dense arrays使用`r * width + q`；Factory footprint／ports有六個60° rotations。
- Research 是stepwise reveal–decide session：一次commit一個完整candidate stamp，當步立即扣款／執行／揭露／evaluate，再決定下一步；不提交batch route。
- 新局只揭露中心radius-two 19-cell hex disk；assay只透露寬廣方向sector，每個stamp立即resolve，結果同時顯示已知 Cure 與 SideEffect。
- Cure自動建立／覆寫每疾病唯一的DiscoveredFormula，Formulas 面板顯示實際steps、累積cost與side effects。
- （v2 Step 2 前）只有 Wall 在霧下仍可見並影響 preview；Abyss、Swamp、Portal、Cure與SideEffect揭露後才影響 preview。
- 單一 Atlas 正常產生 4 種獨立疾病，generator 上限 8 種；default references 依 initial／`zigzag`／`loop`／`straight`＋`crane` 分 tier。
- mapgen 先完成 seeded terrain，再 constructive 地尋找 diverse reference／endpoint；沒有 protected universal corridor。reference endpoint 乾淨，部分同區 Cure cell 帶 SideEffect overlay。
- dev balance 用 solver minima 檢查整個 Cure region、seed/reference diversity與退化，不把 solver 接進遊戲。
- Production 新局即有空 24×12 editor；直接 edit 或套 Factory Blueprint 都按差異付費。
- Production Plan 保持可選、free/no-clock，可按`Commission $N`建到Production；內部state仍可使用pilot命名。
- 正常新局 $1000 必須能不用 hidden fixture 完成 Research → paid build → first sale。
- 依到達難度的分區價格：每個 cure region `price = 60 + 2 × difficulty`，`difficulty = min(120, 最便宜路線成本 + 6 × 窄段 + 2 × 路線旁 Abyss)`（D38）；各疾病 demand 按 `floor(19/20)` 衰減至 0，Market clean／cheap first且只批量出售正 net產品。
- 每疾病shipping contract quota=3；Technology 測試期為免費開關（D42），正式解鎖條件之後再定。
- transport renderer 使用 sim-derived connected topology；Belt drag 支援六鄰接連續hex route。
- Blueprint v4 codec驗證`research-program`，但UI不capture/apply它；generic q/r `factory-layout`可正常建立／套用。Library使用`hexapharma.blueprint-library.v4`。Save v11保存stepwise Research/formulas、non-null Production與結算後 cash。
- 前端改為定向越野地圖語言（紙底墨印、路線紫 overprint、Objective 主線提示），仍是vector-only嚴格俯視2D；Atlas與Factory都render pointy-top hex，但仍保有分離的domain payload／validator。
- UI 刪除不必要常駐文案；詳細操作移到玩家指南。
- 自動 gate只證明 correctness；53346 必須另做人類 fresh-save loop，記錄理解、嘗試、資金、first-sale time與主觀樂趣。
- 完成標準與執行次序見 [plan.md](plan.md)。

## Next — v2

Step 1 已完成（`feat/v2-sim-rules`）：Research 改為規劃後一次試驗、只開圖；朝向與轉向角；沼澤半格；Save v12。Step 2（`feat/v2-mapgen`）：六角 Atlas 地圖生成器重寫（骨架＋BFS 驗證的隘口＋void filling）、黑格、★ 二級療效與 Market 加價、由地勢畫出的霧下等高線；Save v13。Step 4（`feat/v2-machines-pricing`）：8 台前／中／後期機器、依到達難度的分區定價；Save v14。其餘：科技樹；每種基底一張地圖；介面清理。順序與驗收見 [plan.md](plan.md)。

## Later

- 依真人資料調 radial/motif density、terrain比例、Research cost、建造價格、machine throughput、linear price係數與unlock pacing；不得破壞fresh-loop可達性或有限demand。
- 增加 motifs、PathStamps、factory machines、疾病、市場內容與正式美術／聲音。
- 擴充 transport feedback、selection tools 與大型藍圖工作流，但不得引入自動解。
- release candidate 時才建立正式 save migration／deprecation matrix。
- 雲端 Blueprint 分享、帳戶與社群 repository 屬 post-MVP。
