# HexaPharma UI 與直接操作契約

> 現行 world-first interaction contract。按鍵與逐步玩法集中在 [player-guide.md](player-guide.md)；遊戲畫面不重複長篇說明。

## 1. 方向

介面必須像工廠／空間解謎遊戲，不是由 cards、說明段落與 submit buttons 串成網站。中央 world 負責連續空間操作；DOM chrome 只處理工具、短狀態、離散管理、錯誤與危險確認。

借鏡而不複製：

- **Big Pharma**：產線、machine footprint、ports 與瓶頸同屏可讀。
- **shapez 1**：world-first、低摩擦 pick/place/erase、連續 transport 與 camera/toolbelt。
- **Factorio**：一致 hotkeys、pipette、rotate、copy/paste、undo。
- **Potion Craft**：世界遠大於 viewport、中心起步、結構可規劃而發現仍未知。

競品只供原則研究；assets、icons、colors、layout與screenshots必須原創。

## 2. Simple-is-better copy rules

- 常駐 UI 只顯示名詞、數值、動作與必要狀態；不用形容詞式副標、設計理由或教學段落。
- 一個概念只出現一次。能由 icon、位置、disabled state、價格或 world feedback 表達，就不再加 prose。
- tooltip 可放 hotkey 與一行用途；完整操作、費用與例外寫進玩家指南。
- 錯誤不可為了簡潔而隱藏：intent、storage、renderer、diagnostic 與 codec failure 使用可見 alert/status。
- destructive action 必須列出會清除的 authority 並可取消；一般操作不用 modal。

## 3. Shell / navigation

- HUD 只放 Cash、Knowledge、Stock、Seed 與 Save controls。
- 左 rail：F1 Research、F2 Pilot Plant、F3 Production。
- Market／Technology／Blueprints 是 M／T／B drawers；X 或 Escape 關閉。
- 已造訪建築可 mounted 保存 camera/tool/history；hidden page 不接 gameplay keys/pointers。
- message layer 不攔 pointer；error 有 `role=alert`，短狀態進 live region。

## 4. Shared language, separate authority

- LMB click／drag place；RMB erase；一個 gesture 一筆 history。
- Shift+LMB 或 MMB pan；wheel cursor-anchor zoom；camera 不改 sim authority。
- `R` 只旋轉支援的 Factory brush。Research path geometry不受通用 rotate 操作影響。
- `Q` pipette、copy／cut／paste、undo／redo只處理 Factory domain payload。
- held placement 顯示 valid／invalid world ghost；Production ghost同時顯示該次新增 cost。
- bottom hotbar 是 cursor tool belt，不是表單。

## 5. Research

F1 只有一張大型單層 Atlas：

- camera 開局聚焦世界中心的 generator start；平常只看見大地圖的一小部分。pan／zoom／Focus不改 authority，也不在執行時 auto-follow。
- grid/scale、Wall、Abyss、Swamp、Portal A+B、配對與方向在霧下仍可讀。
- Cure／SideEffect 未揭露前不能有 sprite、region edge、preview差異或 outcome洩漏。
- palette 每個 machine 以完整奇形 path silhouette 與 semantic glyph辨識；沒有 path-length control。
- committed program trail與held candidate trail樣式不同；candidate由目前 endpoint 接續完整 path。
- LMB commit完整 held path；RMB／Backspace移除最後一個完整 path；Enter Dispense。
- planning／hover／program edit不改 fog；執行只畫已完成 segment。Portal jump trail斷開。
- progress、stop/failure與outcome使用短 HUD/status；不出現工廠流程提示。

## 6. Pilot Plant

- 獨立 F2 page；完整 FactoryLayout editor，空地合法。
- 沒有 clock、build cost、inventory 或 waste；layout edit與undo/redo都免費。
- inspector 可顯示 sample outcome、throughput、bottleneck與analysis error，沒有通關判斷。
- `Build $N` 是可選快捷：以 Production 目前 layout為基準報價，成功後開啟 Production。
- 關閉或從未使用 Pilot，不影響玩家直接在 Production 建造。

## 7. Production

- F3 新局即顯示空白 24×12 editor與Play/Pause/Step/Reset；沒有封鎖狀態。
- 每個 place／move／rotate／paste／undo／redo都提交 paid layout diff。ghost在操作前顯示cost；現金不足明示拒絕且world不改。
- tile與machine移除不退款；接受 edit後runtime歸零、累積waste保留。
- Production顯示tick、sink outcomes、inventory/waste、throughput與bottleneck。
- no-cure／failed產品進waste；side effects跟實體產品進市場計價，UI不先過濾成「合法配方」。

## 8. Connected transport visual contract

- belt不是每格獨立箭頭或按鈕；連線延伸到格邊，grid在其下方。
- isolated、endpoint、straight、corner、tee、cross由sim-derived incident mask決定。
- splitter／merger branch、source／sink與machine input/output ports使用同一edge authority。
- 錯向相鄰格保留斷口；machine port明確顯示connected／disconnected。
- Belt drag保持四向連續並在轉折格改方向；末格方向沿最後切線。
- moving markers僅在Production依runtime tick動畫；Pilot可以顯示靜態topology，不假裝時間流動。

## 9. Blueprint drawer

- Library lifecycle與save slots分離。
- capture Research產生Blueprint v3 `research-program`，ordered steps只有`{typeId}`。
- capture Pilot或Production都產生通用`factory-layout`，保存routing與`{id,typeId,anchor,footRot}`。
- Factory card提供`Open in Pilot`與`Build $N`；後者走正式Production construction cost。
- floor dimensions與目前entitlement不符時card仍可讀，但目的地disabled並顯示`Build unavailable`；render不得throw。
- paste/upload/download/delete使用strict version/checksum/content/bounds validator；錯誤可見且import atomic。
- 舊文件顯示unsupported；不能猜成現行payload。

## 10. Other drawers / responsive acceptance

- Market／Technology cards可用buttons，因它們是離散管理決策。
- 探索輔助只能放大actual dispensed segment的sensor radius；Unlock本身不能揭霧。
- 擴廠若清Production runtime／waste，Unlock前必須有可取消確認；不能中止active Research shot。
- desktop canvas是stage主要寬度，inspector不覆蓋world；窄屏改上下配置，但canvas、hotbar與command都可達。
- machine以silhouette、footprint、full-path glyph、ports辨識；terrain/portal不能用raw debug text冒充美術。
- chrome低裝飾、短動畫、清楚邊界；禁止 giant blur/pill與常駐tutorial遮world。

## 11. Copyright boundary

- 不抓取或打包競品 screenshots、sprites、icons、fonts、sounds、CSS或UI layouts。
- `public/assets/lab/README.md`記錄原創生成／處理與runtime manifest。
- 文件只使用本專案 screenshots；外部研究只連官方來源。
