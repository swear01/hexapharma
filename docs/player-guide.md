# 玩家指南

這份文件保存完整操作；遊戲內只保留短標籤、hotkey、狀態與錯誤。

## 啟動與連線

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 在伺服器本機開啟 `http://127.0.0.1:53346/`。
- 從遠端開啟 <http://138.2.52.9:53346/>。
- 只能使用 53346；若 port 被占用，先處理占用程序，不要改 port。

## 全域操作

| 動作 | 操作 |
|---|---|
| Research / Pilot / Production | `F1` / `F2` / `F3` |
| Market / Technology / Blueprints | `M` / `T` / `B` |
| 關閉 drawer | `Escape` 或 `×` |
| New Game | HUD `+ New`；輸入 0–4294967295 的 seed 後確認 |
| Save | `Ctrl+S`／`⌘S` 或 HUD save icon |
| 選存檔 | HUD slot selector；每個 slot 有獨立 rewind history |
| Load / Rewind / Recover | HUD 對應 icons；覆蓋目前遊戲或丟棄checkpoint前會確認，錯誤不會靜默換成新局 |

Blueprint Library 與 save slot 分離；New Game、Load、Rewind、換 slot 都不會移除藍圖。New Game 只取代目前未保存狀態，既有 save checkpoints 仍可 Load 回來。

正常新局從 $1000 cash、0 Knowledge開始，同一張 Atlas 預設有4種疾病。全新 origin 的 Blueprint Library 為空；之後換 seed 會保留既有藍圖。URL query注入的cash／research只供開發驗證，不是正常玩法。

## Research

### 看地圖

- Atlas 遠大於 viewport；開局 camera 聚焦世界中心的 generator start，只有以起點為中心的 5×5 已揭露，畫面只顯示整張圖的一小部分。
- 拖曳任一滑鼠鍵可平移；滾輪以游標位置縮放。規劃時按鈕標成Next，`F`或Next會聚焦橙色candidate endpoint，方便接續離屏長路線；只有出藥時改標Dose並聚焦白色實際藥物。結果保留時Next會立即恢復，出藥期間camera自動跟隨dose，結束後仍可自由pan／zoom；切到其他建築再回來不會重設手動camera。
- 找到Cure位置後可點底部的`Cure sites x`逐一聚焦已揭露的位置；這是**已發現位置數**，不是已成功治療數。`Cure sites 0`時不可操作，HUD不顯示未知總數或霧下位置。
- 格線與**Wall**不需要先探索；Wall會取消該步，但機器繼續走剩餘 path。
- 其他互動物揭露後才可辨識：
  - **Abyss**：藥物掉入後本次失敗並停止。
  - **Swamp**：移動消耗較多 energy，可能讓 path提早停止。
  - **Portal A→B**：進入口後跳到固定出口，從出口繼續；不能由B反向進入。
- 單獨看見 Portal 一端時不會顯示隱藏配對或讓 preview 跳躍；實際探索到兩端後才會顯示配對方向。
- Abyss、Swamp、Portal、Cure與SideEffect在揭露前都顯示為普通地面；不要把霧下空白當成沒有內容。
- Cure以亮色receptor與雙圈target標示。Cure與SideEffect可在同一格重疊：抵達污染的Cure會同時治療疾病並帶來副作用；同一區的constructed reference endpoint是乾淨Cure。

### 組路徑與出藥

1. 用數字鍵`1`–`9`或底部hotbar選機器。icon顯示該機器的完整奇形path，world從目前program endpoint畫出完整candidate ghost。
2. 白色瓶是目前route head，橙色瓶與`+`是下一條candidate endpoint；底部`Next`／F可隨時把它重新置中。滑鼠移到橙色marker時會變pointer並顯示`Place next path`；LMB單擊就把**整條**path加入program，不用雙擊。其餘地圖可直接拖曳平移，點空白格不會append，也不能只取其中一段。
3. machine按鈕會即時改變橙色preview；hover可看到完整名稱與「預覽下一條path」提示。上方route chip保留完整名稱、順序與成本。
4. 重複選擇不同機器，利用形狀避開Abyss、穿越Portal、控制Swamp消耗。
5. 上方ordered route strip顯示每一步的機器、單步費用與整次shot總價。按某一步的`×`可移除該完整machine並重算後續；RMB、`Backspace`或undo button移除最後一步。
6. `Enter`或Dispense開始。系統一次扣除route strip顯示的完整Research費用；Abort、失敗或沒有治療結果都不退款。
7. 每台machine完成後，實際走過的segment才揭露附近內容。planning、hover與載入Blueprint都不會免費揭霧。
8. shot結束後短結果同時列出Cure與已知Side effects；不能只看`Cure`而忽略同一endpoint的污染。

正常Atlas預設4種疾病：第一種reference只需要初始machine；後續疾病逐步可能需要Technology解鎖Zigzag still、Loop vat與Settling spiral。地圖的hidden reference不會在遊戲中顯示，玩家要以揭露結果自行設計ResearchProgram。

## Factory共同操作

Pilot與Production使用相同editor。

### Camera與工具

| 動作 | 操作 |
|---|---|
| 放置／畫線 | LMB click或drag |
| 擦除 | RMB click或drag，或選Erase工具 |
| 平移 | Shift+LMB drag或MMB drag |
| Touch 平移 | 兩指drag，或從場地格外開始drag |
| 縮放 | 滾輪；camera reset按鈕回到100% |
| Belt / Split / Merge / Source / Sink / Erase | `1`–`6` |
| Machine slots | `7`–`0` |
| 旋轉brush／游標下既有machine | `R` |
| Pipette游標下內容 | `Q` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y`或`Ctrl+Shift+Z` |
| Copy / Cut / Paste | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |

- Belt一次drag會從起點到游標形成單一正交轉角；目前方向決定先走水平或垂直段。每格方向跟著路線，轉角會用connected texture顯示。
- connected transport只在方向與接收面真的相容時接上。斷口或unconnected machine port代表sim也不會通過。
- machine的`R`只旋轉footprint與ports，不改其chemical path。
- 從既有machine上直接拖曳即可搬動整台machine；越界或碰撞時不會破壞原layout。Touch單指在格內使用目前工具，因此可連續畫Belt、直接拖動machine，或用Erase刪除；兩指drag負責camera。Touch點一下既有machine後再按`R · Rotate`可直接旋轉它。
- 非Erase工具畫過machine footprint會略過該格，不會暗中拆機。hover既有machine時預覽其現有footprint，不顯示不存在的建造或刪除費。
- Copy／Cut／Paste保留tile的完整方向與參數，包括Source period及Splitter／Merger branches；`Q`只把游標內容選成目前brush。
- invalid ghost代表碰撞、越界或其他geometry錯誤；放開滑鼠不會偷偷修正。

### Transport方向

- Belt接受相鄰輸入並朝箭頭方向輸出。
- Splitter從`inDir`接收，依固定round-robin送往多個outputs。
- Merger依`inDirs`固定優先順序接收，再往`outDir`輸出。
- Source按period產生unit；Sink消耗到達unit。
- Machine只能從input port收料、從output port出料。footprint上的port標記會顯示是否連接。

## Pilot Plant

- Pilot沒有clock、建造費、inventory或waste；適合從空地反覆排列layout。
- inspector的Sample、Throughput與Bottleneck只幫你判讀，不限制layout；Sample只依Research已揭露地圖計算，不能用來偷看霧下Cure、SideEffect或Portal配對。無法分析時會顯示可見錯誤。
- 可在Blueprint drawer用`Save Pilot`保存通用Factory Blueprint。
- `Build $N`會以Production現況計算差異費用。現金足夠時建到Production並切換F3；現金不足時Pilot保持不變。
- Pilot完全可選；你可以直接按F3開始正式建造。

## Production

- 新局已有空白24×12場地。每次成功place、drag、move、rotate、paste、undo或redo都可能產生建造費。
- ghost旁的`$N`是該次新增內容報價：

| 內容 | 價格 |
|---|---:|
| Belt | $2 |
| Splitter / Merger | $8 |
| Source | $12 |
| Sink | $6 |
| Machine | `10 × 該機器 processing cost` |

- machine按鈕tooltip會分別列出處理速度`ticks/unit`與持續發生的`Processing $N/unit`；ghost `$N`仍是這次layout edit的一次性建造費。
- 拆除免費但沒有退款；之後重建仍要再次付費。
- 接受layout變更會停止播放並重建runtime：在途unit、tick與runtime counters清除；已累積waste保留。no-op、invalid或現金不足的變更不改layout，也不會暫停正在運作的Production。
- `Space`切換Play/Pause；`.`在Pause時前進一tick。上方buttons也可Play、Pause、Step、Reset。
- Sink送出的cure進Stock；failed/no-cure增加Waste；side effects跟著實體產品影響售價。
- Market的疾病需求卡是公開資訊，但只有Production產生且仍在Stock的實體cure可以販售；需求卡不代表Atlas Cure已揭露，也不提供位置。同一產品只能賣一次。正常新局$1000必須足以在Research支出後建出第一條有效產線並到達第一次出售。

## Blueprints

1. 按`B`開Library，輸入Name。
2. `Save Research program`保存ordered machine types；`Save Pilot`／`Save Production`保存通用FactoryLayout。
3. Research card可`Load in Research`。
4. Factory card可：
   - `Open in Pilot`：免費覆蓋Pilot layout。
   - `Build $N`：以Production目前layout報價並付費建造。
   - 藍圖尺寸與目前Technology entitlement不同時，目的地停用並顯示`Build unavailable`；先取得相符場地再套用。
5. Download取得versioned JSON；Upload或貼上JSON可import。checksum、content或geometry不相容時會明示拒絕。
6. Delete先顯示可取消確認；確認後只永久刪除跨存檔Library entry，不改目前Research／Pilot／Production。

## Technology、Market與重置

- Technology解鎖machine、場地或Research輔助。解鎖探索輔助本身不揭霧，只增加之後actual Research segment的感測半徑。
- Technology頂部只列出已取得的非零benefits；每張卡用完整名稱列出效果、成本與實際前置Technology，沒有前置條件時不顯示空的requirement。
- 每個疾病的Base由mapgen以`12 + 4×difficulty + 2×referenceCost`決定。第一次出售取得Base gross；之後同疾病Next逐次為`floor(前一次 × 9 / 10)`，最後到0。不同疾病各算自己的Sold與Next。
- 每張需求卡以Clean stock／Tainted stock計數庫存件數；最佳可售庫存會列Next gross、production cost、每個effect `$25`的penalty算式與net。無治療庫存或沒有正net庫存時，Ship disabled並直接顯示原因。
- Market的`Ship best`按side effects最少、production cost最低、inventory ID最早的順序，略過不賺錢的候選後出售第一件正net產品。`Ship profitable`掃描相同順序，只出售在當下demand仍為正net的項目；略過的庫存不消耗demand，也不會被自動丟棄。每件成功出售另取得1 Knowledge；畫面會顯示本次回饋。
- 擴廠若會清除Production runtime／waste，確認視窗會先列出影響；Cancel不改任何authority。
- Reset Production有進度時先確認；確認後只重建目前layout的runtime，不把建造費退回，也不清inventory／累積waste。

## 回報問題

附上：

- URL、seed與完整generation options；
- tick範圍或Research path segment；
- input trace／program或Factory layout；
- 預期、實際結果與第一個違反的不變式；
- screenshot與console error。

完整手動驗收步驟見 [playtest.md](playtest.md)。
