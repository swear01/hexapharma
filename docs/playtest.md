# 真人試玩與手動驗證

> 本清單驗當前 build；不能沿用舊 commit 的 screenshots、test count 或 smoke 結果。

`npm run check`、property test與headless balance只證明determinism、invariants與UI reachability，**不證明遊戲好玩**。每個結構玩法pass都必須另外完成第3節的真人fresh-save loop；不得用測試fixture冒充。

## 1. 啟動

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 本機：`http://127.0.0.1:53346/`
- 遠端：`http://<Oracle 公網 IP>:53346/`
- 確認process實際listen `0.0.0.0:53346`；port被占用應直接失敗，不得靜默換port。
- 開無cache新頁，清除本origin的舊開發版save與Blueprint Library；本階段不測跨build migration。

## 2. Shell / simple UI

1. 以1440×900、1280×720、390×844各開一次。另在430、560與651px寬驗HUD breakpoint；以6位Cash與6位Knowledge壓力測試品牌、resource chips與save controls不得裁切、跨欄或重疊，`+ New`必須不靠hover就看得懂。中央world應是主體；HUD、rail、hotbar、inspector都可達。
2. 確認F1/F2/F3是Research/Pilot Plant/Production；M/T/B drawers可toggle，Escape與×可關。
3. 畫面不得出現設計註解、形容詞式副標、常駐教學段落或流程解釋；詳細操作只在玩家指南。
4. hidden page不吃keys/pointers；切回已造訪頁保留camera與tool。
5. 觸發intent/storage/renderer error時必須可見，且不以空白world冒充成功。
6. 在Reset、Delete、Unlock、Load、Rewind或New Game確認開啟時按`.`、`R`、F1–F3、M／T／B；modal與背景authority都必須保持不變。
7. 用HUD New Game從seed 14建立seed 15；確認Cash／Knowledge回預設、原save仍可Load、Blueprint Library不變。超出unsigned 32-bit的seed必須明示拒絕。

## 3. Mandatory fresh-save core loop

本節是玩法驗收，不是debug捷徑。不得使用`?cash=`／`?research=`、devtools改state、mapgen reference、solver、recipe/reference compiler、預製Research／Factory Blueprint或注入存檔。

1. 清除本origin的Save slots與Blueprint Library後建立正常新局；確認Cash=`$1000`、Knowledge=`0`、單一Atlas有4種疾病，起點位於世界中央且只揭露中心5×5。
2. 不查看source/test/reference，僅靠world feedback與可用initial machines人工嘗試Research。每次commit必須點candidate endpoint；記錄blank click是否會誤加step、每次shot的可見總價、嘗試次數與剩餘cash。
3. 找到第一個Cure後，確認結果同時報告已知Side effects；若命中污染Cure，可繼續尋找同區乾淨endpoint，但不能以hidden reference代替探索。
4. 自行選擇直接Production或optional Pilot，人工放source、完整machine sequence、belt與sink；不得呼叫layout compiler。確認Research支出後仍付得起有效Production build。
5. Play直到產生實體cure，在Market以`Ship best`出售第一件仍有正net的產品；確認stock減1、cash增加、該疾病Sold／Next更新。
6. 到first sale後繼續觀察下一種疾病是否形成新目標，而不是同一路線跨seed／疾病直接通殺。
7. 保存：首次理解candidate操作所需時間、Research嘗試數、first cure時間、first sale時間、最低cash、重做layout次數、三個最大困惑點，以及「是否願意再解下一種疾病／原因」。這些是human fun evidence，不得用green gate取代。

任一步因無資訊、無錢、無法建廠、Market自動虧損或流程不知如何繼續而卡住，就是blocker，不標成「之後平衡」。

## 4. Research完整路徑

1. 按F1。只有一張大型Atlas；正常新局同圖4種疾病，開局camera聚焦generator start，只揭露中心5×5，正常viewport只看到整圖一小部分。
2. 規劃時按鈕與accessible name必須顯示Next，按F聚焦橙色candidate endpoint；只有active Dispense顯示Dose並聚焦實際藥物。resolved outcome保留時也必須恢復Next focus，不能讓舊Dose阻止玩家找下一個endpoint。出藥期間camera跟隨dose，結束後可重新自由pan/zoom。
3. 逐一選Research machines。hotbar icon與candidate ghost必須顯示不同完整奇形path。
4. 確認不存在path長度、縮短、延長或走一部分的控制。
5. 先點candidate endpoint以外的blank map，program count必須不變且cursor是grab、tooltip為`Drag map`；移到endpoint必須變pointer並提示`Place next path`。單擊endpoint commit第一、第二條path，count每次加1，不需雙擊；第二條從第一條actual endpoint接續。長route後用Next重新置中，不得仍聚焦舊Dose。
6. ordered route strip依序顯示兩步icon/name、各step cost與總shot cost。刪除第一步時整個step移除、第二步成為第一步並從start重算；fog與cash不變。
7. RMB或Backspace每次只移除最後一條完整path。undo後fog與cash不變。
8. Enter/Dispense只扣一次strip顯示的完整program費用。Abort、Abyss fail或no-cure不退款。
9. 執行長路線時camera逐step跟隨；完成畫面仍可看見final位置。Outcome同時列Cure／No cure與已知Side effects／No side effects。

## 5. Terrain / fog / portal / effects

使用含Wall、Abyss、Swamp、Portal、Cure與SideEffect的固定seed：

1. 在未揭露區確認只有Wall可見；Abyss、Swamp、Portal入口/出口、Cure與SideEffect都顯示為普通霧下基底。
2. 未揭露互動物不得有motif、sprite、colored region、label、hover、preview偏差或outcome洩漏。
3. 把candidate放過known與unknown區；只有Wall在未揭露時改變preview，其他互動物揭露後才改變preview。
4. 只規劃、切machine、undo或載入Blueprint，revealed count不得改變。
5. Dispense後只actual traversed segments與sensor radius揭露。Wall/OOB取消delta、Swamp消耗較多、Abysssticky fail。
6. 只以sensor揭露Portal一端時，只能看到未配對端點；不得顯示隱藏配對、方向、座標或preview jump。兩端都揭露後才顯示配對；經A後token到B，trail在jump處斷開，B不能反向觸發，也不能揭露A/B中間直線。
7. 揭露Cure/SideEffect後，其feature與region邊界才出現。使用重疊fixture確認同一final cell可同時回報Cure與SideEffect，render不丟掉任一overlay。
8. 對generated cure region確認constructed reference endpoint無SideEffect，且區內至少部分其他Cure cell同時污染；不能把整區都做成乾淨或把reference終點污染。

## 6. Mapgen diversity / solver balance

1. 以相同完整GenOptions重建同seed兩次，逐欄位比較terrain、portal、cureId、sideEffectId、4種疾病、references、difficulty與basePrice，必須相等。
2. 掃多個seed，確認default 4 diseases的reference signatures／endpoints／regions不是固定重複；100-seed all-pairs檢查中，任何單一Research Blueprint命中其他99張Atlas的最壞次數不得超過`floor(99 × 15%)`。
3. 對每個reference比較空白地圖endpoint與generated terrain上的actual endpoint；正常尺寸地圖必須看出terrain真正改變traversal，不得存在先保護的universal corridor。
4. 確認default disease 0只使用initial catalog；後續tiers才可引入`skew`、`dilute`、`settle`。1–8疾病options合法，9種顯式拒絕。
5. 跑dev balance；solver minima以整個Cure region為goal，報告minimum steps／cost、reference quality與seed diversity。minimum depth ≤ 1是阻斷性失敗；reference gap只作後續數值調整FLAG。solver不得被production/runtime import，也不得在遊戲中顯示答案。

## 7. Pilot Plant

1. 新局直接按F2；應有可編輯空場地，不要求Research狀態。
2. 放source/belt/machine/splitter/merger/sink，測rotate、drag、pipette、copy/cut/paste、undo/redo。Touch單指drag要能連續畫Belt，tap machine後畫面Rotate要旋轉該machine，Erase要刪整台，兩指drag仍可pan。compact畫面必須看得出hotbar可向右滾動、inspector尚可向下滾動；Research Undo、Dispense、Next與Cure sites的觸控高度至少44px，resolved outcome完整可見且位於path controls下方。非Erase tile drag跨過machine不得拆機；copy/paste要保留Source period與split/merge branch payload。
3. 確認edit不扣cash、沒有clock、inventory或waste；diagnostics可更新但不擋layout。使用會命中未揭露Cure／SideEffect／Portal的layout時，Sample不得顯示隱藏結果；Research揭露後才可顯示已知結果。
4. 切換Research/Production來回，Pilot layout保持owned且不alias其他場域。
5. 建一個no-cure或deadlocked但geometry合法的layout，`Build $N`仍可按；只由現金與layout legality決定成功。

## 8. Direct paid Production

1. 新局未操作Pilot就按F3。必須直接看到空白24×12editor與transport controls。
2. 逐項place並核對cash與ghost報價：belt 2、split/merge 8、source 12、sink 6、machine `10 × processing cost`。
3. 改belt方向應再收belt價；移動／旋轉machine應收新機器價；只改ID的等價layout不收費。
4. 刪除tile/machine不退款。再undo重建內容時依新增內容收費。
5. 準備no-op、碰撞與現金不足的edit；放開後cash、layout、runtime、waste、trace與Play狀態都不變，現金不足時顯示明確錯誤。
6. Play累積tick、unit或waste後修改layout；播放停止、runtime/tick歸零，在途unit清除，累積waste與inventory保留。
7. 直接Production與Pilot的`Build $N`都走相同報價。後者成功後開F3，失敗時Pilot不變。
8. 有進度時解鎖擴廠；確認modal列出runtime/waste影響。Cancel原子不變，Confirm不打斷active Research shot。
9. Production有tick／在途unit時按Reset；確認modal列出清除runtime但保留inventory/waste。Cancel不變，Confirm才重建；initial runtime的Reset disabled。

## 9. Connected belts

1. 拖一條包含水平、垂直與轉角的Belt；格子四向連續，每格輸出朝下一格，末格沿最後切線。
2. 驗endpoint、straight、corner、tee、cross；線接到格邊，grid在transport下方。
3. 接source、sink、splitter、merger與不同footRot machines；branch與ports方向和sim一致。
4. 故意把鄰格方向放錯；視覺應留下斷口，port顯示disconnected，unit不能穿越。
5. Pilot transport保持靜態；Production Play時markers只隨tick前進，Pause不動。

## 10. Market / finite demand

1. 確認每個疾病base price恰為`12 + 4 × difficulty + 2 × referenceCost`，同seed重建相同。
2. 對同疾病連續出售，Next依序為`floor(previous × 9 / 10)`直到0，沒有10%或$1永久floor；不同疾病Sold／Next互不影響。
3. 準備同疾病的clean/tainted與不同production cost庫存；`Ship best`必須先side effects最少，再選cost最低，再用inventory ID穩定排序。
4. 放入「排序較前但不賺錢」與「排序較後但仍賺錢」的產品；`Ship best`必須略過前者，`Ship profitable`只出售逐件計入demand後仍為正net的項目。略過項目不消耗demand，所有未選產品留在庫存，不得自動虧本。
5. 每張卡核對Next gross、最佳庫存production cost、`$25 × effect count` penalty與net；Clean stock／Tainted stock是產品件數，不是effect總數。
6. 無治療庫存時顯示`No curative stock.`；有庫存但都不賺錢時顯示`No profitable stock at next price.`，兩個Ship action都disabled。
7. 單賣後可見status顯示`+1 Knowledge`且HUD Knowledge增加1；bulk顯示每件`+1 Knowledge`且總量相符。同一render內重複觸發已出售product時，第二個rejected intent不得寫入新的`Shipped`回饋。

## 11. Blueprint v3 / cross-save

1. 保存Research Blueprint並下載。root version/ruleset是3，kind=`research-program`，steps恰為`{typeId}`；不含path cells、fog、seed、terrain discovery或outcome。
2. 分別由Pilot與Production保存Blueprint。兩者kind皆為`factory-layout`，payload保存dimensions、sparse routing與`{id,typeId,anchor,footRot}`；不含來源場域、fixed content、runtime、inventory、waste或economy。
3. Factory card可免費`Open in Pilot`，也可顯示`Build $N`並付費建到Production。
4. 對兩種kind做download→import→apply；wrong kind、unknown fields、bad version/fingerprint/checksum、collision/bounds都明示拒絕且Library原子不變。
5. 匯入舊格式必須顯示unsupported，不得猜測轉換。
6. Save/Load/Rewind/換slot後Library內容不變；相同canonical checksum去重；oversize檔拒絕。
7. 按Delete先顯示entry名稱與cross-save永久刪除警告；Cancel保留card，Confirm才移除Library entry。
8. 在新局載入含未解鎖machine的跨存檔Blueprint；錯誤要顯示玩家名稱與Technology指引，不得洩漏type ID或machine數字ID。

## 12. Save v7 / recovery

1. Save後做Research edit、Pilot edit、兩次paid Production edit與Production ticks，再Save建立同origin history。
2. Load不同state時先顯示「覆蓋目前遊戲」確認；Cancel不變，Confirm後恢復Atlas/fog/program/progress、Pilot layout、non-null Production layout/runtime/waste、inventory、economy與Technology。
3. 核對兩次paid build仍存在trace且cash重播相同；不得只保留最後layout。
4. Rewind先警告永久丟棄最新saved checkpoint並覆蓋current state；Cancel不變，Confirm才回前snapshot，reload後較舊history仍在；Blueprint Library不受影響。
5. 舊或unknown schema顯式拒絕，不silent migrate或部分載入。
6. corrupt/partial/disagreeing blob顯示錯誤；Recover前不得自動刪除或覆寫raw data。

## 13. Gate、residue與回報

```bash
npm run check
```

完成前另外確認：

- active docs/source/tests residue scan沒有部分Research path、blank-click append、非Wall互動物穿霧可見、protected universal corridor、預設單疾病、互斥Cure/SideEffect、$200 bootstrap、永久price floor、Production需Pilot、Blueprint舊schema或Save舊schema的active truth；
- 重建Research 5×5 fog／endpoint commit／route strip／shot-follow／overlap effects、Pilot、direct Production、finite-demand Market、connected belts與compact screenshot baselines；
- 以53346從遠端真人先完成第3節無fixture fresh loop，再走其他correctness smoke；保存human metrics並修完至少一輪UX問題。

Bug回報附：URL、seed／generation options、tick或path segment、input trace/program/layout、預期/實際、第一個違反的不變式、screenshot與console error。
