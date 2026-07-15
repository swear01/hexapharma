# 真人試玩與手動驗證

> 本清單驗當前 build；不能沿用舊 commit 的 screenshots、test count 或 smoke 結果。

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

1. 以1440×900、1280×720、390×844各開一次。中央world應是主體；HUD、rail、hotbar、inspector都可達。
2. 確認F1/F2/F3是Research/Pilot Plant/Production；M/T/B drawers可toggle，Escape與×可關。
3. 畫面不得出現設計註解、形容詞式副標、常駐教學段落或流程解釋；詳細操作只在玩家指南。
4. hidden page不吃keys/pointers；切回已造訪頁保留camera與tool。
5. 觸發intent/storage/renderer error時必須可見，且不以空白world冒充成功。

## 3. Research完整路徑

1. 按F1。只有一張大型Atlas；開局camera聚焦generator start，正常viewport只看到整圖一小部分。
2. pan/zoom後按F回到目前dose；執行時camera不得搶回控制。
3. 逐一選Research machines。hotbar icon與candidate ghost必須顯示不同完整奇形path。
4. 確認不存在path長度、縮短、延長或走一部分的控制。
5. LMB commit第一、第二條path；program count每次加1，第二條從第一條actual endpoint接續。
6. RMB或Backspace每次只移除最後一條完整path。undo後fog與cash不變。
7. Enter/Dispense只扣一次完整program費用。Abort、Abyss fail或no-cure不退款。

## 4. Terrain / fog / portal

使用含Wall、Abyss、Swamp、Portal、Cure與SideEffect的固定seed：

1. 在未揭露區確認Wall、Abyss、Swamp、Portal入口/出口、配對與方向可見；fog視覺仍存在。
2. Cure與SideEffect在揭露前不得有sprite、colored region、label、hover、preview偏差或outcome洩漏。
3. 把candidate放過known與unknown區；structural terrain無論fog都以同一規則改變preview。
4. 只規劃、切machine、undo或載入Blueprint，revealed count不得改變。
5. Dispense後只actual traversed segments與sensor radius揭露。Wall/OOB取消delta、Swamp消耗較多、Abysssticky fail。
6. 經Portal A後token到B，trail在jump處斷開；B不能反向觸發，也不能揭露A/B中間直線。
7. 揭露Cure/SideEffect後，其feature與region邊界才出現。

## 5. Pilot Plant

1. 新局直接按F2；應有可編輯空場地，不要求Research狀態。
2. 放source/belt/machine/splitter/merger/sink，測rotate、drag、erase、pipette、copy/cut/paste、undo/redo。
3. 確認edit不扣cash、沒有clock、inventory或waste；diagnostics可更新但不擋layout。
4. 切換Research/Production來回，Pilot layout保持owned且不alias其他場域。
5. 建一個no-cure或deadlocked但geometry合法的layout，`Build $N`仍可按；只由現金與layout legality決定成功。

## 6. Direct paid Production

1. 新局未操作Pilot就按F3。必須直接看到空白24×12editor與transport controls。
2. 逐項place並核對cash與ghost報價：belt 2、split/merge 8、source 12、sink 6、machine `10 × processing cost`。
3. 改belt方向應再收belt價；移動／旋轉machine應收新機器價；只改ID的等價layout不收費。
4. 刪除tile/machine不退款。再undo重建內容時依新增內容收費。
5. 準備現金不足的edit；放開後cash、layout、runtime、waste與trace都不變，顯示明確錯誤。
6. Play累積tick、unit或waste後修改layout；播放停止、runtime/tick歸零，在途unit清除，累積waste與inventory保留。
7. 直接Production與Pilot的`Build $N`都走相同報價。後者成功後開F3，失敗時Pilot不變。
8. 有進度時解鎖擴廠；確認modal列出runtime/waste影響。Cancel原子不變，Confirm不打斷active Research shot。

## 7. Connected belts

1. 拖一條包含水平、垂直與轉角的Belt；格子四向連續，每格輸出朝下一格，末格沿最後切線。
2. 驗endpoint、straight、corner、tee、cross；線接到格邊，grid在transport下方。
3. 接source、sink、splitter、merger與不同footRot machines；branch與ports方向和sim一致。
4. 故意把鄰格方向放錯；視覺應留下斷口，port顯示disconnected，unit不能穿越。
5. Pilot transport保持靜態；Production Play時markers只隨tick前進，Pause不動。

## 8. Blueprint v3 / cross-save

1. 保存Research Blueprint並下載。root version/ruleset是3，kind=`research-program`，steps恰為`{typeId}`；不含path cells、fog、seed、terrain discovery或outcome。
2. 分別由Pilot與Production保存Blueprint。兩者kind皆為`factory-layout`，payload保存dimensions、sparse routing與`{id,typeId,anchor,footRot}`；不含來源場域、fixed content、runtime、inventory、waste或economy。
3. Factory card可免費`Open in Pilot`，也可顯示`Build $N`並付費建到Production。
4. 對兩種kind做download→import→apply；wrong kind、unknown fields、bad version/fingerprint/checksum、collision/bounds都明示拒絕且Library原子不變。
5. 匯入舊格式必須顯示unsupported，不得猜測轉換。
6. Save/Load/Rewind/換slot後Library內容不變；相同canonical checksum去重；oversize檔拒絕。

## 9. Save v7 / recovery

1. Save後做Research edit、Pilot edit、兩次paid Production edit與Production ticks，再Save建立同origin history。
2. Load恢復Atlas/fog/program/progress、Pilot layout、non-null Production layout/runtime/waste、inventory、economy與Technology。
3. 核對兩次paid build仍存在trace且cash重播相同；不得只保留最後layout。
4. Rewind回前snapshot，reload後history仍在；Blueprint Library不受影響。
5. 舊或unknown schema顯式拒絕，不silent migrate或部分載入。
6. corrupt/partial/disagreeing blob顯示錯誤；Recover前不得自動刪除或覆寫raw data。

## 10. Gate、residue與回報

```bash
npm run check
```

完成前另外確認：

- active docs/source/tests residue scan沒有部分Research path、terrain完全藏霧、Production需Pilot、Blueprint舊schema、Save舊schema的active truth；
- 重建Research terrain/fog、path families、Pilot、direct Production、connected belts與compact screenshot baselines；
- 以53346從遠端真人走完本清單，修完至少一輪UX問題。

Bug回報附：URL、seed／generation options、tick或path segment、input trace/program/layout、預期/實際、第一個違反的不變式、screenshot與console error。
