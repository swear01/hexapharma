# Overview

HexaPharma 是「程序化藥效 Atlas + 實體工廠」的確定性單人遊戲。現行build以三個角色清楚且資料解耦的建築取代舊Research Route Floor／contract chain。

> 狀態：現行implemented authority；是否通過驗收仍以當前commit的`npm run check`結果為準。

## 三個建築

1. **Research**
   - 只有單一大型 Atlas，沒有 Route Floor、FactoryLayout、source/belt/sink 或常駐教學區塊。
   - 玩家以固定奇形 Machine `PathStamp` 組成 `ResearchProgram`；prefix calibration 只負責把下一段固定 path 接到既有 prefix，不改寫 stamp 幾何。
   - 執行 program 才能沿實際路徑探索 fog。Research 不產生 cure contract，也不把 layout 送往 Pilot。
2. **Pilot Plant**
   - 無時間、無建造成本、無耗材、inventory 或 waste，是任意合法 `FactoryLayout` 的 sandbox。
   - 可自由使用 belt、machine、splitter、merger、source、sink，並立即看實際診斷。
   - Commission 只要求 layout 合法且可建立 Production；不要求 Research contract、cure、特定 outcome 或「匹配配方」。
3. **Production**
   - commission 時逐欄位接收 Pilot layout，不 auto-pack、repair、rotate 或重接 routing。
   - 唯一具有連續 tick、在途產品、吞吐、inventory、waste 與經濟後果。
   - cure、side effect、failure、no-cure、deadlock 與低吞吐都由實際 layout/runtime 承擔，不由 contract 事先保證。

## Atlas 與 mapgen

- Active Research 是單層 Atlas；跨層互動、layer swap／Phase Exchange 與 A–D progression 暫停，不得留在 palette、Blueprint 或 active tutorial。
- 地形 vocabulary 是 wall、abyss、swamp，以及定向的同層 A→B portal。它們是不同 authority kind，不能假裝成舊 hazard／side-effect skin。
- mapgen 使用 seeded radial structure + motifs，並以 constructive program 生成可探索路線；同 seed + 完整設定必須重現同一份 Atlas 與 reference ResearchProgram。
- solver 只供 tests/tools 驗證與分析，不進 production 自動解。

## Blueprint 與 Save

- Blueprint Library 仍獨立於 save slots，使用 strict versioned JSON、checksum、bounds 與 content compatibility 驗證。
- Blueprint wire/ruleset 固定為 v2。`research-program` 保存 ordered `{typeId,stroke}`，fixed path由content-compatible catalog還原；不保存FactoryLayout/path cells/fog/seed/outcome。
- `pilot-plant` 保存sparse routing與machines `{id,typeId,stroke,anchor,footRot}`；不保存chemical orientation/path、Research program、fog、seed、runtime、economy或實際結果。
- v1 layout-based `research-route` 是舊 truth且顯式拒絕；不能猜測轉換。
- Save core wire固定為breaking v6：full/compact/slots保存ResearchProgram/shot與contract-free Pilot/Production，catalog/layout使用path/stroke，v5顯式拒絕。Checkpoint UI/lineage integration已完成；早期開發不維護跨build相容。

## 技術界線

- 純 TypeScript sim core，React UI，PixiJS render，Vite build。
- Research path/mapgen 與 Production sim 都確定性；Production 成功熱 tick 使用固定容量 SoA、零配置。
- UI/renderer 只讀 sim 並送 intent，不能持有第二份 path/layout authority。

Canonical 規格見 [design.md](design.md)，操作契約見 [ui-interaction.md](ui-interaction.md)，實作順序見 [plan.md](plan.md)。
