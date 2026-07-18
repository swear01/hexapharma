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
- destructive action 必須列出會清除的 authority 並可取消；modal 開啟期間所有背景 world／navigation hotkeys 都不得改 authority。一般操作不用 modal。

## 3. Shell / navigation

- HUD 只放 Cash、Knowledge、Stock、Seed、New Game 與 save controls。New Game 必須有可見文字，不能只依賴 hover tooltip；預填下一個 seed，確認後只取代目前未保存狀態，save checkpoints 與跨局 Blueprint Library 保留。
- 左 rail：F1 Research、F2 Pilot Plant、F3 Production。
- Market／Technology／Blueprints 是 M／T／B drawers；X 或 Escape 關閉。
- 已造訪建築可 mounted 保存 camera/tool/history；hidden page 不接 gameplay keys/pointers。
- drawer開啟時底下world不接gameplay hotkeys；input/contenteditable保留文字鍵，focused button保留原生Enter／Space。
- message layer 不攔 pointer；error 有 `role=alert`，短狀態進 live region。

## 4. Shared language, separate authority

- LMB click／drag place；RMB erase；一個 gesture 一筆 history。
- Shift+LMB 或 MMB pan；wheel cursor-anchor zoom；camera 不改 sim authority。
- touch 單指在格內 click／drag 使用目前工具，從既有 machine 開始則搬動整台；兩指 drag 或從格外開始才 pan。點既有 machine 後，畫面 Rotate control 必須旋轉該 machine，不能要求實體鍵盤。
- `R` 在游標覆蓋既有machine時直接旋轉該footprint；否則旋轉目前Factory brush。Research path geometry不受通用 rotate 操作影響。
- `Q` pipette、copy／cut／paste、undo／redo只處理 Factory domain payload。
- held placement 顯示 valid／invalid world ghost；Production ghost同時顯示該次新增 cost。
- bottom hotbar 是 cursor tool belt，不是表單。

## 5. Research

F1 只有一張大型單層 Atlas：

- Research拖曳任一滑鼠鍵都可pan，與Factory的Shift+LMB／MMB手勢分開；pointer cancel只取消gesture，不得commit或erase。camera開局聚焦世界中心的generator start；fresh fog只揭露中心5×5，平常只看見大地圖的一小部分。規劃時單一focus command明示為Next並聚焦橙色candidate endpoint；只有active shot明示為Dose並聚焦實際藥物。resolved outcome仍可見時，一回規劃Next focus就必須恢復，不能繼續指向舊Dose。Dispense期間camera跟隨current dose，之後恢復自由控制；建築往返不因舊outcome重設手動camera。Cure sites是可操作的已揭露位置計數／輪播，聚焦fog已揭露的Cure，不得暗示成功治療數、顯示未知總數或讀取隱藏座標。
- grid/scale與Wall在霧下仍可讀。
- Abyss、Swamp、Portal A+B、Cure與SideEffect未揭露前不能有 motif、sprite、region edge、preview差異或 outcome洩漏。只揭露單一 Portal 端點時可顯示未配對端點，但配對標記、方向、目的座標與 preview jump 必須等兩端都揭露。
- palette 每個 machine 以完整奇形 path silhouette 與 semantic glyph辨識；沒有 path-length control。
- committed program trail與held candidate trail樣式不同；candidate由目前 endpoint 接續完整 path。
- held candidate的endpoint必須有明確橙色marker與小型`+`加入badge；白色瓶是目前route head，底部`Next`可隨時把橙色endpoint重新置中。滑鼠命中時從pan的grab cursor改為pointer，tooltip只顯示短動作`Place next path`；其餘地圖提示`Drag map`。LMB單擊就commit完整path，不需雙擊，小幅pointer抖動仍視為click。blank map click不append也不把整張canvas當confirm button。
- machine hotbar tooltip要說明選擇會預覽下一條path；route chip在一般desktop寬度必須顯示完整玩家名稱，並以title保留全名，不能只剩截斷的內部感縮寫。
- ordered route strip顯示step順序、machine、每步cost與total shot cost；未執行時每一步都有remove control。RMB／Backspace仍移除最後一個完整path；Enter Dispense。
- planning／hover／program edit不改 fog；執行只畫已完成 segment。Portal jump trail斷開。
- Cure使用高對比receptor與target ring；SideEffect visual可在同一cell疊加，不能互相遮掉或用互斥terrain kind呈現。
- progress、stop/failure與outcome使用短 HUD/status；outcome以一基底疾病名稱與副作用數量同時顯示已知結果，不暴露 raw effect IDs、權威座標或工廠流程提示。

## 6. Pilot Plant

- 獨立 F2 page；完整 FactoryLayout editor，空地合法。
- 沒有 clock、build cost、inventory 或 waste；layout edit與undo/redo都免費。
- inspector 可顯示 throughput、bottleneck與analysis error；sample outcome 必須由 Research fog 遮罩後的 planning map 計算，不能顯示未揭露 cure／side effect／portal 或權威終點，也沒有通關判斷。
- `Build $N` 是可選快捷：以 Production 目前 layout為基準報價，成功後開啟 Production。
- 關閉或從未使用 Pilot，不影響玩家直接在 Production 建造。

## 7. Production

- F3 新局即顯示空白 24×12 editor與Play/Pause/Step/Reset；沒有封鎖狀態。
- 每個 place／move／rotate／paste／undo／redo都提交 paid layout diff。ghost在操作前顯示cost；現金不足明示拒絕且world不改。
- 非Erase tile gesture不得刪除或覆蓋既有machine；hover ghost與click／move authority一致。Touch Erase可刪machine。
- Factory clipboard精確保存tile payload；Source period、Splitter outputs與Merger inputs不可在paste時重設。
- tile與machine移除不退款；只有接受的edit才停止播放並令runtime歸零，累積waste保留。no-op、invalid與insufficient-cash rejection不暫停也不改history。
- 有runtime進度時Reset先以可取消確認列出「清runtime／保留inventory與waste」；initial runtime不需要可用Reset。
- Production顯示tick、sink outcomes、inventory/waste、throughput與bottleneck。
- machine hotbar tooltip同時顯示ticks/unit與每件processing cost；不要把一次性建造費和持續生產成本混成同一數字。
- no-cure／failed產品進waste；side effects跟實體產品進市場計價，UI不先過濾成「合法配方」。
- 正常new game顯示$1000；fresh Research後的有效first line必須可支付，insufficient-cash錯誤不能是正常bootstrap必經狀態。

## 8. Connected transport visual contract

- belt不是每格獨立箭頭或按鈕；連線延伸到格邊，grid在其下方。
- isolated、endpoint、straight、corner、tee、cross由sim-derived incident mask決定。
- splitter／merger branch、source／sink與machine input/output ports使用同一edge authority。
- 錯向相鄰格保留斷口；machine port明確顯示connected／disconnected。
- Belt drag保持四向連續並在轉折格改方向；末格方向沿最後切線。
- LMB／touch從既有machine上拖曳會直接搬動整台machine，保留machine identity；被占用或越界的落點以invalid ghost顯示且不提交。
- moving markers僅在Production依runtime tick動畫；Pilot可以顯示靜態topology，不假裝時間流動。

## 9. Blueprint drawer

- Library lifecycle與save slots分離。
- capture Research產生Blueprint v3 `research-program`，ordered steps只有`{typeId}`。
- capture Pilot或Production都產生通用`factory-layout`，保存routing與`{id,typeId,anchor,footRot}`。
- Factory card提供`Open in Pilot`與`Build $N`；後者走正式Production construction cost。
- floor dimensions與目前entitlement不符時card仍可讀，但目的地disabled並顯示`Build unavailable`；render不得throw。
- 跨存檔 Blueprint若使用未解鎖或不相容machine，拒絕訊息必須使用玩家看到的machine名稱，不得顯示`skew`、`dilute`等內部type ID或machine數字ID。
- paste/upload/download/delete使用strict version/checksum/content/bounds validator；錯誤可見且import atomic。
- delete先以可取消確認列出將永久移除的cross-save Library entry。
- 舊文件顯示unsupported；不能猜成現行payload。

## 10. Other drawers / responsive acceptance

- Market／Technology cards可用buttons，因它們是離散管理決策。Technology只摘要已取得且非零的Factory columns／rows、Research scan與machine數量；root node不顯示`Requires: None`，卡片也不以locked chip和disabled Unlock重複狀態。Market公開需求板每疾病顯示Base、Sold、Next gross、Clean stock與Tainted stock；最佳可售庫存另列production cost、`$25 × effect count`與net，但不表示Atlas Cure已揭露或提供位置。
- `Ship best`依side-effect count、production cost、inventory ID掃描第一個positive-net產品；`Ship profitable`用同一順序略過non-positive候選，只出售逐件計入demand後仍positive-net的產品。沒有治療庫存或沒有可賺產品時，兩個action disabled並各自顯示原因；只有authority接受出售後才可顯示`Shipped`與每件`+1 Knowledge`，rejected intent不得假報成功。
- 探索輔助只能放大actual dispensed segment的sensor radius；Unlock本身不能揭霧。
- 擴廠若清Production runtime／waste，Unlock前必須有可取消確認；不能中止active Research shot。
- Load若會覆蓋不同的current game、Rewind若會永久丟棄最新checkpoint，都必須先列出影響並可取消。
- desktop canvas是stage主要寬度，inspector不覆蓋world；窄屏改上下配置，但canvas、hotbar與command都可達。768px 以下 HUD 改雙列，compact resource label可縮短但label與數字都不得裁切或跨chip；跨過 breakpoint 時不得讓品牌、resources 或 controls 互相覆蓋。可滾動的Factory toolbelt與inspector必須有可見方向提示；compact Research的主要指令與Next/Cure sites觸控區高度至少44px，resolved outcome要在獨立第二列完整可讀且不得與path hotbar重疊。
- machine以silhouette、footprint、full-path glyph、ports辨識；terrain/portal不能用raw debug text冒充美術。
- chrome低裝飾、短動畫、清楚邊界；禁止 giant blur/pill與常駐tutorial遮world。

## 11. Copyright boundary

- 不抓取或打包競品 screenshots、sprites、icons、fonts、sounds、CSS或UI layouts。
- `public/assets/lab/README.md`記錄原創生成／處理與runtime manifest。
- 文件只使用本專案 screenshots；外部研究只連官方來源。
