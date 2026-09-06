# Notes

## Current design gotchas

- **Research 不是小工廠**：只有 Atlas + reveal–decide full PathStamps；不要加入 source／belt／sink、FactoryLayout、batch route editor 或 DOM timeline。
- **完整 path 才是 puzzle piece**：機器的奇形 path cells 屬 catalog content。UI、Blueprint、Save、footRot 或 CSS transform 都不能截短或改寫它。
- **candidate endpoint 才是下一步 target**：選機器只產生接在目前actual drug state的完整ghost；點中後立即付費／執行／揭露／evaluate並append已執行program。空白world click不能充當確認按鈕。
- **program 不是待送出的route**：session program只記錄已實際執行的stamps，不能重排或刪步，也沒有aggregate Dispense。no-cure再決定下一台；Failure／Cure結束，Abort不退款、不回滾fog。
- **terrain 與 discovery 分層**：只有 Wall 在未揭露區仍可見並影響 preview；Abyss／Swamp／Portal／Cure／SideEffect 都在揭露前完全中性化。
- **portal 是同層 A→B**：成對、有向、trail 斷段；B 不是回程入口。單獨揭露一端不公開配對、方向或 preview jump。
- **Research 逐步探索**：選machine與hover不改fog；每個已付費stamp的actual segments立即揭露。assay只給broad sector，不提供座標或距離。
- **Cure 自動成為formula**：每疾病最多一份`DiscoveredFormula`；重複發現以最新完整session覆寫。formula是可讀成果，不是自動建廠指令。
- **Radius-two 起始視野**：fresh fog只揭露中心start周圍hex distance≤2的19-cell disk；每個stamp在單一intent中立即resolve，camera不虛構timed Dose phase。
- **mapgen terrain-first**：先由 seed 完成 radial bands／motifs／terrain，再在真實 traversal 上 constructive 地找 diverse references。禁止先造答案再保護一條 universal corridor。
- **單圖多疾病**：預設 4 種、支援 1–8 種；default references 由 initial machines 到 `skew`／`dilute`／`settle` 分 tier。reference 只供 tests/tools，runtime 不提示答案。
- **effect fields 可重疊**：constructed endpoint 是乾淨 Cure；區域其他 Cure cell 可同時有 SideEffect。renderer、Outcome 與 Market 不能用互斥 cell-kind 假設丟掉其中一種效果。
- **solver 量實際 cure region**：dev balance 看 minimum steps／cost、reference quality 與 seed diversity，不只瞄準第一個 Cure cell，也不進 runtime。
- **不看平均值掩蓋通用藍圖**：balance除aggregate rate外，另做最多100個level的all-pairs，直接限制最壞單一reference的跨seed命中率並列出命中的target disease分布。
- **結構失敗與平衡訊號分開**：minimum cure depth ≤ 1會讓balance非零退出；constructed reference與solver minimum的step／cost gap繼續列為調參FLAG，不冒充correctness失敗。
- **Production Plan 是可選 sandbox**：無clock／cost／inventory／waste，與Research、Production狀態解耦；Sample只使用fog-masked planning map。玩家動詞是Commission，內部state可仍名pilot。
- **Production 可直接建造**：新局已有空 24×12 layout。不要再加入Production Plan前置、封鎖頁或隱藏token。
- **建造差異就是經濟 authority**：tile/machine新建收費；拆除不退款。只有接受的edit停止播放並重建runtime；rejection原子不變，累積waste保留。
- **Blueprint v4 factory kind 是通用的**：`factory-layout`不記錄來自Production Plan或Production；同文件可開到Plan或付費Commission到Production。codec仍讀現行`research-program`，但UI不capture/apply它；Library key是`hexapharma.blueprint-library.v4`。
- **Blueprint ≠ save**：Library lifecycle 獨立；不含 fog、seed、economy、runtime 或結果。Load／Rewind 不能改 Library。
- **Save v11 不兼容舊開發版**：full／compact／slots／rewind 保存完整 cold state，包括 stepwise Research／formulas、結算後 cash 與 non-null Production。plain JSON 可由玩家編輯，不驗資源來源；外層獨立 checkpoint/history 仍是 v2，內層 key 帶 Save v11。sim／mapgen 邏輯改變須明確 bump contentBuild 的 rules revision，詳見 [存檔規格](save.md)。
- **connected texture 不是鄰居 skin**：只畫 sim 真正形成的 accept→emit edge；錯向相鄰格必須看得出沒有連接。
- **hidden mounted ≠ active**：已造訪建築可 mounted 保存 camera/tool/history；hidden page 不接 gameplay input。
- **renderer failure 必須可見**：asset/init 失敗不能用空 canvas 或 debug fallback 冒充成功。
- **畫面文字要克制**：常駐 UI 不放設計理由、形容詞式副標與長教學；細節寫在 [player-guide.md](player-guide.md)。
- **bootstrap 不是作弊 fixture**：正常起始 cash 是 $1000，fresh loop 必須不用注入 cash／Knowledge、hidden reference 或 compiler 就能到第一次出售。
- **demand 必須耗盡**：base price 是 `12 + 4×difficulty + 2×referenceCost`；各疾病 next gross 逐次 `floor(19/20)` 到 0。Market 先乾淨、再低成本，只自動出售正 net 庫存。
- **contracts 回饋探索工具**：每疾病shipping quota=3；Disease 1／2／3分別gate Skew／Dilute／Settle patent，並且不取代一般cash／Knowledge／prerequisites。
- **compiler routing endpoints 必須預留**：dev-only prototype compiler 在鋪前段belt前，同時預留所有machine的input approach與output exit，避免前段BFS佔用後段必需的route start；不得把compiler接進runtime自動解或自動建廠。
- **True hex 是 authority，不只是品牌**：Atlas與Factory都使用pointy-top axial `{q,r}`、E／SE／SW／W／NW／NE與`r * width + q` dense indexing。Factory有六個60° footprint／port rotations；兩個domain仍不得互載payload或共用validator。
- 極簡、偏 pixel 的俯視 2D：中性炭灰／冷灰底、近白文字與機身；青藍僅標流動、白／淡藍標選取與 candidate、綠標 cure、紫紅標副作用、紅標失敗。平塗硬邊，無黃光、青色 halo、裝飾圈環或全表面亮邊；Pixi vector runtime 保留 canonical true hex。

## Why

- 固定完整奇形路徑讓玩家在 Atlas 上思考形狀與地形，而不是把 Research 做成第二個 Factory editor。
- Wall 始終可見，提供固定的空間骨架；其餘互動物藏在霧下，讓出藥探索保有未知與試錯成本。
- terrain-first 的不同 references 讓玩家跨 seed 重新讀地形；乾淨／污染 Cure overlap 讓「發現療效」之後仍有精準路徑與產品品質的選擇。
- Production Plan 提供免費畫藍圖的便利，但不限制直接Production建造；Production的成本與runtime後果才是正式風險。
- 多疾病獨立有限需求把 Research、工廠重建與市場輪替接成循環，避免一條產線永久印錢。
- connected topology 讓 factory 一眼可讀，也讓拖曳轉彎、split／merge 與 machine ports 使用一致視覺語言。
- `research-program`與`factory-layout`仍是兩個明確Blueprint payload，但只有FactoryLayout可由目前UI capture/apply；Research由stepwise session與auto formula承擔玩家流程。

- **Browser harness output**：Playwright Page／Browser 物件包含 SDK internals，可能連帶印出環境資料；Node REPL 操作以 `void` 結尾，只輸出明確選取的文字、數值與檔案路徑，不 dump 整個物件。

- **Stable browser verification**：Vite may reload the page when a UI module with helper exports changes, resetting unsaved game state. Finish source edits before Playwright runs or screenshot captures; use normal Save/Load to resume manual play after a development reload.

- **Clipped canvas camera bounds**：CSS cover sizing changes the visible logical viewport. Camera clamping must use the clipped frame dimensions; zoom anchors must be translated from full-canvas coordinates into that centered viewport. Full-screen reference panels also suppress world input without pausing the production timer.

- Headless probes should reuse repository import paths: `src/sim/mapgen` is a directory entry point, not a `mapgen.ts` file.

- Formula reference 的桌面／行動 breakpoint 必須同時套用 component world input 與 Game 的 Research cartridge／Enter hotkeys；resize 後可見 world 與鍵盤 authority 使用同一個 `worldInputActive`。

- **Alpha reader 移除時同步更新 E2E fixtures**：完整 Save JSON 不能再寫入已停用的 `hexapharma.save.slot.0` 期待自動 migration；fixtures 必須經公開 snapshot codec 寫入當前 versioned checkpoint envelope。舊 namespace 只保留「忽略且不覆寫」測試。

- **嚴格 Load 不代表停用部分損壞 Recovery**：外層 unknown field／非字串 head 必須讓正常 Load 失敗，但同版本、可解析且大小／數量有界時仍可獨立驗證已知 snapshot 字串供明確 Recover；錯誤版本或超量 envelope 不 salvage。兩個流程都不得在讀取時覆寫原始資料。
