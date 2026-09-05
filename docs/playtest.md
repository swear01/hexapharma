# 真人試玩與手動驗證

> 本清單驗當前 build；不能沿用舊 commit 的 screenshots、test count 或 smoke 結果。

`npm run check`、property test與headless balance只證明determinism、invariants與UI reachability，**不證明遊戲好玩**。每個結構玩法pass都必須另外完成第3節的真人fresh-save loop；不得用測試fixture冒充。

## 1. 啟動

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 本機：`http://127.0.0.1:53346/`
- 遠端：<http://138.2.52.9:53346/>
- 確認process實際listen `0.0.0.0:53346`；port被占用應直接失敗，不得靜默換port。
- 開無cache新頁，清除本origin的舊開發版save與Blueprint Library；本階段不測跨build migration。

## 2. Shell / simple UI

1. 以1440×900、1280×720、390×844各開一次。另在430、560與651px寬驗HUD breakpoint；以6位Cash與6位Knowledge壓力測試頂部導航與 resources 不裁切或重疊；Menu 的 New／Save／Load／Rewind 使用文字。中央 world 應是主體；Details 預設關閉，展開／關閉可達。
2. 確認F1/F2/F3是Research/Production Plan/Production，Plan送廠按鈕使用`Commission`；M/T/B drawers可toggle，Escape與×可關。玩家UI不得再顯示Pilot Plant。
3. 畫面不得出現設計註解、形容詞式副標、常駐教學段落或流程解釋；詳細操作放按需 Help 與玩家指南。
4. hidden page不吃keys/pointers；切回已造訪頁保留camera與tool。
5. 觸發intent/storage/renderer error時必須可見，且不以空白world冒充成功。
6. 在Reset、Delete、Unlock、Load、Rewind或New Game確認開啟時按`.`、`R`、F1–F3、M／T／B；先 Play 再開 modal，跨至少 700ms 確認 tick、inventory、cash、waste 不變；Cancel 恢復先前播放，原本 paused 不會啟動。確認 Load／New／Rewind／Reset／擴廠後舊 timer 停止。
7. 用Menu → New從seed 14建立seed 15；確認Cash／Knowledge回預設、原save仍可Load、Blueprint Library不變。超出unsigned 32-bit的seed必須明示拒絕。

## 3. Mandatory fresh-save core loop

本節是玩法驗收，不是debug捷徑。不得使用`?cash=`／`?research=`、devtools改state、mapgen reference、solver、recipe/reference compiler、預製Research／Factory Blueprint或注入存檔。

1. 清除本origin的Save slots與Blueprint Library後建立正常新局；確認Cash=`$1000`、Knowledge=`0`、單一pointy-top axial Atlas有4種疾病，起點位於世界中央且只揭露hex distance radius 2的19-cell disk。
2. 不查看source/test/reference，僅靠broad assay sector、world feedback與可用initial machines人工嘗試Research。每次只commit一個完整candidate stamp；記錄blank click是否誤提交、每步cash變化、每次揭露後是否知道如何作下一個決定、嘗試次數與剩餘cash。
3. 找到第一個Cure後，確認結果同時報告已知Side effects，且Formulas 面板自動顯示實際ordered steps、累積assay cost與副作用；若命中污染Cure，可開新session繼續尋找同區乾淨endpoint，但不能以hidden reference代替探索。
4. 自行選擇直接Production或optional Production Plan，人工放source、完整machine sequence、belt與sink；不得呼叫layout compiler。若使用Plan，按`Commission $N`送入正式產線。確認Research支出後仍付得起有效Production build。
5. Play直到產生實體cure，在Market以`Ship best`出售第一件仍有正net的產品；確認stock減1、cash增加、該疾病Sold／Next更新。
6. 對同一疾病完成3次accepted shipping，確認contract chip依序為1/3、2/3、3/3，對應machine patent gate解除；繼續觀察下一種疾病是否形成新目標，而不是同一路線跨seed／疾病直接通殺。
7. 另記錄是否曾動用預留的$100 retry／小改建預算；若目前庫存沒有正net出貨，確認Market提示改善成本／品質或嘗試另一種疾病，不把current stock不賺錢誤報成整局無法恢復。
8. 保存：首次理解candidate操作所需時間、Research嘗試數、first cure時間、first sale時間、最低cash、重做layout次數、三個最大困惑點，以及「是否願意再解下一種疾病／原因」。這些是human fun evidence，不得用green gate取代。

任一步因無資訊、無錢、無法建廠、Market自動虧損或流程不知如何繼續而卡住，就是blocker，不標成「之後平衡」。

## 4. Stepwise Research／formula

1. 按F1。只有一張大型pointy-top Atlas；正常新局同圖4種疾病，開局camera聚焦generator start，只揭露中心radius-two 19-cell disk，正常viewport只看到整圖一小部分。以六個相鄰cell核對E／SE／SW／W／NW／NE picking與polygon edge一致。
2. mission readout顯示Active assay、疾病與local／六方向broad sector；fixtures須涵蓋east、south-east、south-west、west、north-west、north-east與local，不得出現target座標或距離。
3. 逐一選Research machines。hotbar icon與candidate ghost必須顯示不同完整奇形path，且不存在path長度、縮短、延長或只走一部分的控制。
4. 先點candidate endpoint以外的blank map，program／cash／fog必須不變且cursor是grab；移到endpoint必須變pointer並提示短動作。單擊endpointcommit第一個stamp，不需雙擊。
5. 第一次commit後確認session已開始、只扣該machine catalog cost、program恰多一個已執行step、actual trail立即揭霧且outcome立即可見。不得等待另一個Dispense，也不得先建立多步pending route。
6. 以no-cure step繼續：shot保留，第二個candidate從第一步actual drug state接續；commit後只再扣第二台cost並更新fog／outcome。session readout不能提供重排或刪除已執行step的控制。
7. 按Abort：program／shot／outcome清除，先前cash與fog保留。以Abyss再測Failure自動結束；任何Cure也自動結束。
8. Outcome同時列Cure／No cure與已知Side effects／No side effects。Cure後Formulas 面板顯示Disease、ordered icons、累積cost、Clean或side-effect count；同疾病再次Cure時覆寫為latest且不出現兩份。
9. Blueprint drawer不得提供`Save Research program`或`Load in Research`。匯入現行v4 `research-program`後只可Download／Delete，不能直接改active program、cash、fog、outcome或formula。

## 5. Terrain / fog / portal / effects

使用含Wall、Abyss、Swamp、Portal、Cure與SideEffect的固定seed：

1. 在未揭露區確認只有Wall可見；Abyss、Swamp、Portal入口/出口、Cure與SideEffect都顯示為普通霧下基底。
2. 未揭露互動物不得有motif、sprite、colored region、label、hover、preview偏差或outcome洩漏。
3. 把candidate放過known與unknown區；只有Wall在未揭露時改變preview，其他互動物揭露後才改變preview。
4. 只規劃、切machine或載入Blueprint，revealed count不得改變。
5. 每次commit的actual traversed segments與sensor radius才揭露。Wall/OOB取消delta、Swamp消耗較多、Abyss sticky fail。
6. 只以sensor揭露Portal一端時，只能看到未配對端點；不得顯示隱藏配對、方向、座標或preview jump。兩端都揭露後才顯示配對；經A後token到B，trail在jump處斷開，B不能反向觸發，也不能揭露A/B中間直線。
7. 揭露Cure/SideEffect後，其feature與region邊界才出現。使用重疊fixture確認同一final cell可同時回報Cure與SideEffect，render不丟掉任一overlay。
8. 對generated cure region確認constructed reference endpoint無SideEffect，且區內至少部分其他Cure cell同時污染；不能把整區都做成乾淨或把reference終點污染。

## 6. Mapgen diversity / solver balance

1. 以相同完整GenOptions重建同seed兩次，逐欄位比較terrain、portal、cureId、sideEffectId、4種疾病、references、difficulty與basePrice，必須相等。
2. 掃多個seed，確認default 4 diseases的reference signatures／endpoints／regions不是固定重複；100-seed all-pairs檢查中，任何單一Research Blueprint命中其他99張Atlas的最壞次數不得超過`floor(99 × 15%)`。
3. 對每個reference比較空白地圖endpoint與generated terrain上的actual endpoint；正常尺寸地圖必須看出terrain真正改變traversal，不得存在先保護的universal corridor。
4. 確認default disease 0只使用initial catalog；後續tiers才可引入`skew`、`dilute`、`settle`。1–8疾病options合法，9種顯式拒絕。
5. 跑dev balance；solver minima以整個Cure region為goal，報告minimum steps／cost、reference quality與seed diversity。minimum depth ≤ 1是阻斷性失敗；reference gap只作後續數值調整FLAG。solver不得被production/runtime import，也不得在遊戲中顯示答案。

## 7. Production Plan

1. 新局直接按F2；應有可編輯空場地，不要求Research狀態。
2. 放source/belt/machine/splitter/merger/sink，測rotate、drag、pipette、copy/cut/paste、undo/redo。Touch單指drag要能連續畫Belt，tap machine後畫面Rotate要旋轉該machine，Erase要刪整台，兩指drag仍可pan。compact畫面必須看得出hotbar可向右滾動、inspector尚可向下滾動；Research主要commit／Abort／Next／Cure sites的觸控高度至少44px，outcome與Formulas 面板完整可讀。非Erase tile drag跨過machine不得拆機；copy/paste要保留Source period與split/merge branch payload。
3. 確認edit不扣cash、沒有clock、inventory或waste；diagnostics可更新但不擋layout。使用會命中未揭露Cure／SideEffect／Portal的layout時，Sample不得顯示隱藏結果；Research揭露後才可顯示已知結果。
4. 切換Research/Production來回，Plan layout保持owned且不alias其他場域。
5. 建一個no-cure或deadlocked但geometry合法的layout，`Commission $N`仍可按；只由現金與layout legality決定成功。

## 8. Direct paid Production

1. 新局未操作Production Plan就按F3。必須直接看到空白24×12 pointy-top hex editor與transport controls。
2. 逐項place並核對cash與ghost報價：belt 2、split/merge 8、source 12、sink 6、machine `10 × processing cost`。
3. 改belt方向應再收belt價；移動／每次60°旋轉machine應收新機器價；只改ID的等價layout不收費。六次旋轉必須回到原footprint／ports。
4. 刪除tile/machine不退款。再undo重建內容時依新增內容收費。
5. 準備no-op、碰撞與現金不足的edit；放開後cash、layout、runtime、waste、trace與Play狀態都不變，現金不足時顯示明確錯誤。
6. Play累積tick、unit或waste後修改layout；播放停止、runtime/tick歸零，在途unit清除，累積waste與inventory保留。
7. 直接Production與Plan的`Commission $N`都走相同報價。後者成功後開F3，失敗時Plan不變。
8. 有進度時解鎖擴廠；確認modal列出runtime/waste影響。Cancel原子不變，Confirm不打斷active Research shot。
9. Production有tick／在途unit時按Reset；確認modal列出清除runtime但保留inventory/waste。Cancel不變，Confirm才重建；initial runtime的Reset disabled。

## 9. Connected belts

1. 沿多個軸向拖一條含轉折的Belt；cell必須六鄰接連續，每格輸出朝下一格的E／SE／SW／W／NW／NE方向，末格沿最後切線。
2. 驗endpoint、對向straight、60°／120°turn與multi-way junction；線接到六角格邊，grid在transport下方。
3. 接source、sink、splitter、merger與不同footRot machines；branch與ports方向和sim一致。
4. 故意把鄰格方向放錯；視覺應留下斷口，port顯示disconnected，unit不能穿越。
5. Production Plan transport保持靜態；Production Play時markers只隨tick前進，Pause不動。

## 10. Market / finite demand

1. 確認每個疾病base price恰為`12 + 4 × difficulty + 2 × referenceCost`，同seed重建相同。
2. 對同疾病連續出售，Next依序為`floor(previous × 19 / 20)`直到0，沒有5%或$1永久floor；不同疾病Sold／Next互不影響。
3. 準備同疾病的clean/tainted與不同production cost庫存；`Ship best`必須先side effects最少，再選cost最低，再用inventory ID穩定排序。
4. 放入「排序較前但不賺錢」與「排序較後但仍賺錢」的產品；`Ship best`必須略過前者，`Ship profitable`只出售逐件計入demand後仍為正net的項目。略過項目不消耗demand，所有未選產品留在庫存，不得自動虧本。
5. 每張卡核對Next gross、最佳庫存production cost、`$25 × effect count` penalty與net；Clean stock／Tainted stock是產品件數，不是effect總數。
6. 無治療庫存時顯示`No curative stock.`；有庫存但都不賺錢時顯示`No profitable stock at next price.`，兩個Ship action都disabled。
7. 單賣後可見status顯示`+1 Knowledge`且HUD Knowledge增加1；bulk顯示每件`+1 Knowledge`且總量相符。同一render內重複觸發已出售product時，第二個rejected intent不得寫入新的`Shipped`回饋。
8. 新局contract chip先顯示Disease 1 `0 / 3`；只讓accepted sales推進。Disease 1售滿3件後active chip移到Disease 2，全部完成後顯示最後一份completed contract。
9. Disease 1／2／3未滿quota時分別嘗試Skew／Dilute／Settle patent，必須被對應contract gate拒絕；滿3件後仍需一般cash、Knowledge與patent prerequisites。其他patent不得被shipping contract誤擋。

## 11. Blueprint v4 / cross-save

1. 匯入現行Research Blueprint。root version/ruleset是4，kind=`research-program`，steps恰為`{typeId}`；不含path cells、fog、seed、terrain discovery、outcome或formula。card只可Download／Delete，沒有capture／apply action。
2. 分別由Production Plan與Production保存Blueprint。兩者kind皆為`factory-layout`，payload保存dimensions、sparse routing與`{id,typeId,anchor,footRot}`；所有cell／anchor使用`{q,r}`、dense materialization使用`r * width + q`，`footRot`只允許0–5；不含來源場域、fixed content、runtime、inventory、waste或economy。
3. Factory card可免費`Open in Production Plan`，也可顯示`Commission $N`並付費建到Production。
4. 對兩種kind做download→import validation，只有`factory-layout`做apply；wrong kind、unknown fields、bad version/fingerprint/checksum、collision/bounds都明示拒絕且Library原子不變。
5. 確認Library envelope version是4且storage key為`hexapharma.blueprint-library.v4`。匯入v3或其他舊格式必須顯示unsupported，不得猜測轉換；legacy key／blob原樣保留。
6. Save/Load/Rewind/換slot後Library內容不變；相同canonical checksum去重；oversize檔拒絕。
7. 按Delete先顯示entry名稱與cross-save永久刪除警告；Cancel保留card，Confirm才移除Library entry。
8. 在新局載入含未解鎖machine的跨存檔Blueprint；錯誤要顯示玩家名稱與Technology指引，不得洩漏type ID或machine數字ID。

## 12. Save v10 / recovery

1. Save後做stepwise Research／formula discovery、Production Plan edit、shipping contract progress、兩次paid Production edit與Production ticks，再Save建立同origin history。
2. Load不同state時先顯示「覆蓋目前遊戲」確認；Cancel不變，Confirm後恢復Atlas/fog/program/shot/outcome/formulas、內部pilot layout、non-null Production layout/runtime/waste、inventory、economy/contracts與Technology。
3. 核對兩次paid build仍存在trace且cash重播相同；不得只保留最後layout。
4. Rewind先警告永久丟棄最新saved checkpoint並覆蓋current state；Cancel不變，Confirm才回前snapshot，reload後較舊history仍在；Blueprint Library不受影響。
5. full／compact／slots都是version 10；checkpoint lineage外層version 2、內層head/history是Save v10，canonical key為`hexapharma.save.v10.checkpoint.${slot}`。Save v9或unknown schema顯式拒絕，不silent migrate、部分載入或覆寫舊blob／key。
6. corrupt/partial/disagreeing blob顯示錯誤；Recover前不得自動刪除或覆寫raw data。

## 13. Gate、residue與回報

```bash
npm run check
```

完成前另外確認：

- active docs/source/tests residue scan沒有batch Research route、部分Research path、blank-click append、非Wall互動物穿霧可見、protected universal corridor、預設單疾病、互斥Cure/SideEffect、$200 bootstrap、永久price floor、Production需Plan、Pilot Plant玩家文案、generated lab bitmap／manifest、Blueprint舊schema或Save舊schema的active truth；
- 極簡、偏 pixel 的俯視 2D：中性炭灰／冷灰底、近白文字與機身；青藍僅標流動、白／淡藍標選取與 candidate、綠標 cure、紫紅標副作用、紅標失敗。平塗硬邊，無黃光、青色 halo、裝飾圈環或全表面亮邊；Pixi vector runtime 保留 canonical true hex。
- 確認Atlas與Factory都是pointy-top axial hex；以`{q,r}`、E／SE／SW／W／NW／NE、六個60° rotations與`r * width + q` fixtures交叉核對hit-test、routing、fog edge及render，並重建radius-two fog／stepwise reveal-decide／assay sector／Formulas 面板／overlap effects、Production Plan、direct Production、contracts、finite-demand Market、connected belts與compact screenshot baselines；
- 以53346從遠端真人先完成第3節無fixture fresh loop，再走其他correctness smoke；保存human metrics並修完至少一輪UX問題。

Bug回報附：URL、seed／generation options、tick或path segment、input trace/program/layout、預期/實際、第一個違反的不變式、screenshot與console error。
