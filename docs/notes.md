# Notes

## Current design gotchas

- **Research 不是小工廠**：只有 Atlas + ordered full PathStamps；不要加入 source／belt／sink、FactoryLayout、route editor 或 DOM timeline。
- **完整 path 才是 puzzle piece**：機器的奇形 path cells 屬 catalog content。UI、Blueprint、Save、footRot 或 CSS transform 都不能截短或改寫它。
- **terrain 與 discovery 分層**：wall／abyss／swamp／portal 即使在未揭露區也必須可見並影響 preview；Cure／SideEffect 在揭露前必須完全中性化。
- **portal 是同層 A→B**：成對、有向、trail 斷段；B 不是回程入口。
- **Research 只探索**：選路徑與載入 Blueprint 不改 fog；只有付費出藥後的 actual segments 揭露。
- **mapgen constructive**：seeded radial bands + motifs 先構造合法 reference program；solver 只做 tests/tools quality audit。
- **Pilot 是可選 sandbox**：無 clock／cost／inventory／waste，與 Research、Production 狀態解耦。
- **Production 可直接建造**：新局已有空 24×12 layout。不要再加入 Pilot 前置、封鎖頁或隱藏 token。
- **建造差異就是經濟 authority**：tile/machine 新建收費；拆除不退款。接受 edit 後 runtime 重建，但累積 waste 保留。
- **Blueprint v3 factory kind 是通用的**：`factory-layout` 不記錄來自 Pilot 或 Production；同文件可開到 Pilot 或付費建到 Production。
- **Blueprint ≠ save**：Library lifecycle 獨立；不含 fog、seed、economy、runtime 或結果。Load／Rewind 不能改 Library。
- **Save v7 不兼容舊開發版**：full／compact／slots／rewind 都必須保留 paid build trace 與 non-null Production。
- **connected texture 不是鄰居 skin**：只畫 sim 真正形成的 accept→emit edge；錯向相鄰格必須看得出沒有連接。
- **hidden mounted ≠ active**：已造訪建築可 mounted 保存 camera/tool/history；hidden page 不接 gameplay input。
- **renderer failure 必須可見**：asset/init 失敗不能用空 canvas 或 debug fallback 冒充成功。
- **畫面文字要克制**：常駐 UI 不放設計理由、形容詞式副標與長教學；細節寫在 [player-guide.md](player-guide.md)。

## Why

- 固定完整奇形路徑讓玩家在 Atlas 上思考形狀與地形，而不是把 Research 做成第二個 Factory editor。
- 結構 terrain 可見，讓組合有可預期的空間決策；把治療／副作用藏霧下，仍保留探索未知與試錯成本。
- Pilot 提供免費畫藍圖的便利，但不限制直接 Production 建造；Production 的成本與 runtime 後果才是正式風險。
- connected topology 讓 factory 一眼可讀，也讓拖曳轉彎、split／merge 與 machine ports 使用一致視覺語言。
- ResearchProgram 與 FactoryLayout 是兩種可攜知識，因此 Blueprint 必須是兩個明確 payload，而不是互相猜測轉換。
