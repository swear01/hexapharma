# 玩家指南

這份文件保存完整操作；遊戲內只保留短標籤、hotkey、狀態與錯誤。

## 啟動與連線

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 在伺服器本機開啟 `http://127.0.0.1:53346/`。
- 從遠端開啟 `http://<Oracle 公網 IP>:53346/`。
- 只能使用 53346；若 port 被占用，先處理占用程序，不要改 port。

## 全域操作

| 動作 | 操作 |
|---|---|
| Research / Pilot / Production | `F1` / `F2` / `F3` |
| Market / Technology / Blueprints | `M` / `T` / `B` |
| 關閉 drawer | `Escape` 或 `×` |
| Save | `Ctrl+S`／`⌘S` 或 HUD save icon |
| 選存檔 | HUD slot selector；每個 slot 有獨立 rewind history |
| Load / Rewind / Recover | HUD 對應 icons；錯誤會顯示，不會靜默換成新局 |

Blueprint Library 與 save slot 分離；Load、Rewind、換 slot 都不會移除藍圖。

## Research

### 看地圖

- Atlas 遠大於 viewport；開局 camera 聚焦 generator start，畫面只顯示附近區域。
- 拖曳任一滑鼠鍵可平移；滾輪以游標位置縮放；`F` 或 Focus 回到目前藥物位置。
- 格線與結構地形不需要先探索：
  - **Wall**：該步無法進入，但機器繼續走剩餘 path。
  - **Abyss**：藥物掉入後本次失敗並停止。
  - **Swamp**：移動消耗較多 energy，可能讓 path提早停止。
  - **Portal A→B**：進入口後跳到固定出口，從出口繼續；不能由B反向進入。
- Cure與SideEffect在揭露前顯示為普通地面；不要把霧下空白當成沒有內容。

### 組路徑與出藥

1. 用數字鍵`1`–`9`或底部hotbar選機器。icon顯示該機器的完整奇形path。
2. 在world上LMB點一下，把**整條**path加入program。路徑從目前endpoint接續；不能只取其中一段。
3. 重複選擇不同機器，利用形狀避開Abyss、穿越Portal、控制Swamp消耗。
4. RMB點一下、`Backspace`或undo button移除最後一台完整machine。
5. `Enter`或Dispense開始。系統一次扣除program的完整Research費用；Abort、失敗或沒有治療結果都不退款。
6. 每台machine完成後，實際走過的segment才揭露附近內容。planning、hover與載入Blueprint都不會免費揭霧。

## Factory共同操作

Pilot與Production使用相同editor。

### Camera與工具

| 動作 | 操作 |
|---|---|
| 放置／畫線 | LMB click或drag |
| 擦除 | RMB click或drag，或選Erase工具 |
| 平移 | Shift+LMB drag或MMB drag |
| 縮放 | 滾輪；camera reset按鈕回到100% |
| Belt / Split / Merge / Source / Sink / Erase | `1`–`6` |
| Machine slots | `7`–`0` |
| 旋轉brush/footprint | `R` |
| Pipette游標下內容 | `Q` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y`或`Ctrl+Shift+Z` |
| Copy / Cut / Paste | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |

- Belt一次drag會從起點到游標形成單一正交轉角；目前方向決定先走水平或垂直段。每格方向跟著路線，轉角會用connected texture顯示。
- connected transport只在方向與接收面真的相容時接上。斷口或unconnected machine port代表sim也不會通過。
- machine的`R`只旋轉footprint與ports，不改其chemical path。
- invalid ghost代表碰撞、越界或其他geometry錯誤；放開滑鼠不會偷偷修正。

### Transport方向

- Belt接受相鄰輸入並朝箭頭方向輸出。
- Splitter從`inDir`接收，依固定round-robin送往多個outputs。
- Merger依`inDirs`固定優先順序接收，再往`outDir`輸出。
- Source按period產生unit；Sink消耗到達unit。
- Machine只能從input port收料、從output port出料。footprint上的port標記會顯示是否連接。

## Pilot Plant

- Pilot沒有clock、建造費、inventory或waste；適合從空地反覆排列layout。
- inspector的Sample、Throughput與Bottleneck只幫你判讀，不限制layout；無法分析時會顯示可見錯誤。
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

- 拆除免費但沒有退款；之後重建仍要再次付費。
- 接受layout變更會停止播放並重建runtime：在途unit、tick與runtime counters清除；已累積waste保留。
- `Space`切換Play/Pause；`.`在Pause時前進一tick。上方buttons也可Play、Pause、Step、Reset。
- Sink送出的cure進Stock；failed/no-cure增加Waste；side effects跟著實體產品影響售價。
- Market只顯示可販售的實體cure；同一產品只能賣一次。

## Blueprints

1. 按`B`開Library，輸入Name。
2. `Save Research program`保存ordered machine types；`Save Pilot`／`Save Production`保存通用FactoryLayout。
3. Research card可`Load in Research`。
4. Factory card可：
   - `Open in Pilot`：免費覆蓋Pilot layout。
   - `Build $N`：以Production目前layout報價並付費建造。
   - 藍圖尺寸與目前Technology entitlement不同時，目的地停用並顯示`Build unavailable`；先取得相符場地再套用。
5. Download取得versioned JSON；Upload或貼上JSON可import。checksum、content或geometry不相容時會明示拒絕。
6. Delete只刪Library entry，不改目前Research／Pilot／Production。

## Technology、Market與重置

- Technology解鎖machine、場地或Research輔助。解鎖探索輔助本身不揭霧，只增加之後actual Research segment的感測半徑。
- 擴廠若會清除Production runtime／waste，確認視窗會先列出影響；Cancel不改任何authority。
- Reset Production只重建目前layout的runtime，不把建造費退回，也不清累積waste。

## 回報問題

附上：

- URL、seed與完整generation options；
- tick範圍或Research path segment；
- input trace／program或Factory layout；
- 預期、實際結果與第一個違反的不變式；
- screenshot與console error。

完整手動驗收步驟見 [playtest.md](playtest.md)。
