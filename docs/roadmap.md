# Roadmap

> 先完成 headless authority，再接薄 render/UI；每階段以當前 commit 的 `npm run check` 驗收。早期實作紀錄不凌駕現行 design。

## Foundation

### Phase 0 — Drug graph / mapgen / solver

完成 deterministic path/evaluate、seeded RNG/hash、terrain-first constructive generation與 dev/test-only solver minima。

### Phase 1 — Research Atlas

完成 Pixi/React 大型 Atlas、camera、fog、terrain/portal 與原創程式化視覺。現行規則是單層、只有 Wall 始終可見，其餘互動物隱藏至揭露。

### Phase 2 — Factory sim

完成 fixed-capacity SoA runtime、multi-cell machines、belt、splitter/merger、throughput/deadlock、cold snapshot/hash。

### Phase 3 — Economy / Technology / save

完成 Market、Knowledge、patents、intent replay/checkpoint。當前 wire 是 Save v7，早期 schema 不再支援。

### Phase 4 — Direct-operation shell

完成 F1–F3 world shell、drawers、Factory direct manipulation、responsive patterns 與三場域分離。

### Phase 5 — Single-Atlas fixed paths

完成奇形 PathStamp、terrain-aware traversal、radial motifs、Research-only exploration、free Pilot sandbox 與 actual Production outcomes。

## Current — playable fresh loop and diverse Atlas

- Research machine 只走完整 catalog path；移除所有部分路徑資料與控制。
- 選擇完整 path 後必須點 candidate endpoint 才 commit；ordered route strip 顯示每步／總費用並可移除任意 step。
- 新局只揭露中心 5×5；出藥 camera 跟隨 dose，結果同時顯示已知 Cure 與 SideEffect。
- 只有 Wall 在霧下仍可見並影響 preview；Abyss、Swamp、Portal、Cure與SideEffect揭露後才影響 preview。
- 單一 Atlas 正常產生 4 種獨立疾病，generator 上限 8 種；default references 依 initial／`skew`／`dilute`／`settle` 分 tier。
- mapgen 先完成 seeded terrain，再 constructive 地尋找 diverse reference／endpoint；沒有 protected universal corridor。reference endpoint 乾淨，部分同區 Cure cell 帶 SideEffect overlay。
- dev balance 用 solver minima 檢查整個 Cure region、seed/reference diversity與退化，不把 solver 接進遊戲。
- Production 新局即有空 24×12 editor；直接 edit 或套 Factory Blueprint 都按差異付費。
- Pilot 保持可選、free/no-clock，可按報價建到 Production。
- 正常新局 $1000 必須能不用 hidden fixture 完成 Research → paid build → first sale。
- base price 使用 `12 + 4×difficulty + 2×referenceCost`；各疾病 demand 按 `floor(9/10)` 衰減至 0，Market clean／cheap first且只批量出售正 net產品。
- transport renderer 使用 sim-derived connected topology；Belt drag 支援四向連續轉角。
- Blueprint v3：`research-program` + generic `factory-layout`；Save v7：non-null Production + paid build trace。
- UI 刪除不必要常駐文案；詳細操作移到玩家指南。
- 自動 gate只證明 correctness；53346 必須另做人類 fresh-save loop，記錄理解、嘗試、資金、first-sale time與主觀樂趣。
- 完成標準與執行次序見 [plan.md](plan.md)。

## Later

- 依真人資料調 radial/motif density、terrain比例、Research cost、建造價格、machine throughput、linear price係數與unlock pacing；不得破壞fresh-loop可達性或有限demand。
- 增加 motifs、PathStamps、factory machines、疾病、市場內容與正式美術／聲音。
- 擴充 transport feedback、selection tools 與大型藍圖工作流，但不得引入自動解。
- release candidate 時才建立正式 save migration／deprecation matrix。
- 雲端 Blueprint 分享、帳戶與社群 repository 屬 post-MVP。
