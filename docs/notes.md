# Notes

## Current design gotchas

- **Research 不是小工廠**：只有 Atlas + ordered full PathStamps；不要加入 source／belt／sink、FactoryLayout、route editor 或 DOM timeline。
- **完整 path 才是 puzzle piece**：機器的奇形 path cells 屬 catalog content。UI、Blueprint、Save、footRot 或 CSS transform 都不能截短或改寫它。
- **candidate endpoint 才是 place target**：選機器只產生接在目前 endpoint 的完整 ghost；只有點中 ghost endpoint 才 append。空白 world click 不能充當確認按鈕。
- **program strip 只是投影**：ordered strip 顯示完整 steps、單步／總費用並允許刪除任意 step；canonical authority 仍是 ResearchProgram，刪除後必須重算後續路徑。
- **terrain 與 discovery 分層**：只有 Wall 在未揭露區仍可見並影響 preview；Abyss／Swamp／Portal／Cure／SideEffect 都在揭露前完全中性化。
- **portal 是同層 A→B**：成對、有向、trail 斷段；B 不是回程入口。單獨揭露一端不公開配對、方向或 preview jump。
- **Research 只探索**：選路徑與載入 Blueprint 不改 fog；只有付費出藥後的 actual segments 揭露。
- **5×5 起始視野**：fresh fog 只揭露中心 start 周圍 5×5；camera 出藥時跟隨 current dose，不能讓長路線結果落在畫面外而只剩文字。
- **mapgen terrain-first**：先由 seed 完成 radial bands／motifs／terrain，再在真實 traversal 上 constructive 地找 diverse references。禁止先造答案再保護一條 universal corridor。
- **單圖多疾病**：預設 4 種、支援 1–8 種；default references 由 initial machines 到 `skew`／`dilute`／`settle` 分 tier。reference 只供 tests/tools，runtime 不提示答案。
- **effect fields 可重疊**：constructed endpoint 是乾淨 Cure；區域其他 Cure cell 可同時有 SideEffect。renderer、Outcome 與 Market 不能用互斥 cell-kind 假設丟掉其中一種效果。
- **solver 量實際 cure region**：dev balance 看 minimum steps／cost、reference quality 與 seed diversity，不只瞄準第一個 Cure cell，也不進 runtime。
- **不看平均值掩蓋通用藍圖**：balance除aggregate rate外，另做最多100個level的all-pairs，直接限制最壞單一reference的跨seed命中率並列出命中的target disease分布。
- **結構失敗與平衡訊號分開**：minimum cure depth ≤ 1會讓balance非零退出；constructed reference與solver minimum的step／cost gap繼續列為調參FLAG，不冒充correctness失敗。
- **Pilot 是可選 sandbox**：無 clock／cost／inventory／waste，與 Research、Production 狀態解耦；Sample 只使用 Research fog-masked planning map，不能免費解出霧下效果。
- **Production 可直接建造**：新局已有空 24×12 layout。不要再加入 Pilot 前置、封鎖頁或隱藏 token。
- **建造差異就是經濟 authority**：tile/machine新建收費；拆除不退款。只有接受的edit停止播放並重建runtime；rejection原子不變，累積waste保留。
- **Blueprint v3 factory kind 是通用的**：`factory-layout` 不記錄來自 Pilot 或 Production；同文件可開到 Pilot 或付費建到 Production。
- **Blueprint ≠ save**：Library lifecycle 獨立；不含 fog、seed、economy、runtime 或結果。Load／Rewind 不能改 Library。
- **Save v7 不兼容舊開發版**：full／compact／slots／rewind 都必須保留 paid build trace 與 non-null Production。
- **connected texture 不是鄰居 skin**：只畫 sim 真正形成的 accept→emit edge；錯向相鄰格必須看得出沒有連接。
- **hidden mounted ≠ active**：已造訪建築可 mounted 保存 camera/tool/history；hidden page 不接 gameplay input。
- **renderer failure 必須可見**：asset/init 失敗不能用空 canvas 或 debug fallback 冒充成功。
- **畫面文字要克制**：常駐 UI 不放設計理由、形容詞式副標與長教學；細節寫在 [player-guide.md](player-guide.md)。
- **bootstrap 不是作弊 fixture**：正常起始 cash 是 $1000，fresh loop 必須不用注入 cash／Knowledge、hidden reference 或 compiler 就能到第一次出售。
- **demand 必須耗盡**：base price 是 `12 + 4×difficulty + 2×referenceCost`；各疾病 next gross 逐次 `floor(9/10)` 到 0。Market 先乾淨、再低成本，只自動出售正 net 庫存。

## Why

- 固定完整奇形路徑讓玩家在 Atlas 上思考形狀與地形，而不是把 Research 做成第二個 Factory editor。
- Wall 始終可見，提供固定的空間骨架；其餘互動物藏在霧下，讓出藥探索保有未知與試錯成本。
- terrain-first 的不同 references 讓玩家跨 seed 重新讀地形；乾淨／污染 Cure overlap 讓「發現療效」之後仍有精準路徑與產品品質的選擇。
- Pilot 提供免費畫藍圖的便利，但不限制直接 Production 建造；Production 的成本與 runtime 後果才是正式風險。
- 多疾病獨立有限需求把 Research、工廠重建與市場輪替接成循環，避免一條產線永久印錢。
- connected topology 讓 factory 一眼可讀，也讓拖曳轉彎、split／merge 與 machine ports 使用一致視覺語言。
- ResearchProgram 與 FactoryLayout 是兩種可攜知識，因此 Blueprint 必須是兩個明確 payload，而不是互相猜測轉換。
