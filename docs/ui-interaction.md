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

- 單一頂部 Research／Plan／Production 導航；Cash、Knowledge、Stock、合約以無框短列顯示。Menu 收納 seed、New、slot、Save、Load、Rewind、Recover；不常駐系統工具列。New 仍有可見文字與可取消確認，save checkpoints 與跨局 Blueprint Library 保留。
- Market／Technology／Blueprints 是 M／T／B drawers；Guide 在次要工具列，X 或 Escape 關閉。沒有 Formulas。
- 已造訪建築 mounted 保存 camera/tool/history；hidden page 不接 gameplay keys/pointers。切換建築或一般 drawer 不停止 Production。
- blocking alertdialog 開啟時 timer callback 與 productionTicks dispatch 都凍結；Cancel 保留先前 Play／Pause，確認 New／Load／Rewind／Reset／擴廠後停止舊 timer。Blueprint Delete 不換 Production authority，關閉後恢復原播放狀態。
- drawer 開啟時 world 不接 gameplay hotkeys；input/contenteditable 保留文字鍵，focused button 保留原生 Enter／Space。
- message layer 不攔 pointer；error 有 `role=alert`，短狀態進 live region。

## 4. Shared language, separate authority

- LMB click／drag place；RMB erase；一個 gesture 一筆 history。
- Shift+LMB 或 MMB pan；wheel cursor-anchor zoom；camera 不改 sim authority。
- touch 單指在格內 click／drag 使用目前工具，從既有 machine 開始則搬動整台；兩指 drag 或從格外開始才 pan。點既有 machine 後，畫面 Rotate control 必須旋轉該 machine，不能要求實體鍵盤。
- `R` 在游標覆蓋既有machine時直接將該footprint／ports順時針旋轉60°；否則旋轉目前Factory brush。六次rotation回到原向，Research path geometry不受通用 rotate 操作影響。
- `Q` pipette、copy／cut／paste、undo／redo只處理 Factory domain payload。
- held placement 顯示 valid／invalid world ghost；Production ghost同時顯示該次新增 cost。
- bottom hotbar 是 cursor tool belt，不是表單。

## 5. Research

F1 只有一張大型單層 Atlas：

- Research拖曳任一滑鼠鍵都可pan，與Factory的Shift+LMB／MMB手勢分開；pointer cancel只取消gesture，不得commit或erase。camera開局聚焦世界中心的generator start；fresh fog只揭露中心radius-two 19-cell hex disk，平常只看見大地圖的一小部分。Center（`F`）在有規劃時聚焦規劃終點，否則聚焦最近試驗的實際終點；地圖左下只有這個控制，不顯示揭露格數、zoom或Cure計數。每次Run在單一intent中resolve，UI不顯示timed Dose phase或自動camera follow；唯一例外是剛resolve出Cure的試驗會以≤220 ms（reduced motion即時、任何pointer／wheel／focus可中斷）把camera fit到整條實際路線，避開結果readout與step清單；建築往返不因舊outcome重設手動camera。
- mission readout是地圖左上角的羅盤：以紫色扇區標出目標方向、箭頭標出規劃終點的heading，並顯示疾病、Look broad sector與Heading（mobile 仍保留疾病與Look）；accessible name仍為Active assay；sector只可為local或east／south-east／south-west／west／north-west／north-east，不顯示座標、距離、reference或region大小。
- 霧是未印的紙：只有與seed／座標有關、與隱藏地形無關的淡等高線；Wall在霧下仍可讀，格線只畫在已揭露格。
- Abyss、Swamp、Portal A+B、Cure與SideEffect未揭露前不能有 motif、sprite、region edge、preview差異或 outcome洩漏。只揭露單一 Portal 端點時可顯示未配對端點，但配對標記、方向、目的座標與 preview jump 必須等兩端都揭露。
- palette是map legend：每個machine以footprint＋完整path的token、全名、價格與hotkey辨識；沒有 path-length control。
- 起點是紫色空心三角；**規劃路線**是虛線紫色leg與編號控制點圓，在 fog-masked planning map 上走完整條（霧當平地、Wall 照算）；**最近一次試驗的實際路線**是實線紫色leg，由 `lastTrial.program` 在真實地圖重播；實際終點是紫色實心點（Failure 為紅色X）。Run 後、改動規劃前，虛線改為該次 Run 當下的預估並淡化；第一個偏離點畫紅圈與原因標籤（Wall／Swamp／Abyss）。Swamp 半步畫在半格點。新試驗的實線以≤250 ms墨線描出（reduced motion時立即完成）。
- hotbar／數字鍵把 machine 接到規劃末端；hotbar 圖示依規劃終點的 heading 旋轉。Backspace、Ctrl／⌘+Z、右鍵，或 LMB 單擊最後一個控制點（hover 時游標轉 pointer、tooltip `Remove last step`；其餘地圖 `Drag map`）或 `Undo` 移除最後一步；`Clear` 清空。blank map click 不改規劃。
- 指令列只有剩餘現金讀數（`$M left`＝現金−N）、`Undo`、`Clear` 與 `Run · $N`（Enter）；N 是規劃的 catalog 總價。規劃為空或現金不足時 Run disabled、隱藏讀數並以短句說明。Run 以單一 `runResearchTrial` 一次付款、跑完整條、揭露實際路徑並保留規劃。
- planning／hover不改 fog；只有試驗實際走過的格被揭露。Portal jump trail斷開。
- Cure使用綠色十字與區域邊界，SideEffect是琥珀色點網；兩者可在同一cell疊加，不能互相遮掉或用互斥terrain kind呈現。Failure以紅色X標記。
- 試驗結果在地圖右上（mobile為下方）以單行readout呈現（`Cure Disease N · …`、`No cure · …` 或 `Failed · …`），同時顯示已知副作用數量，不暴露 raw effect IDs、權威座標或工廠流程提示。沒有配方卡或 Formulas 面板；Objective 在目前疾病任一 Cure 格揭露後改為 `Plan a line to Disease N`。

## 6. Production Plan

- 獨立 F2 page；完整 FactoryLayout editor，空地合法。
- 沒有 clock、build cost、inventory 或 waste；layout edit與undo/redo都免費。
- inspector 可顯示 throughput、bottleneck與analysis error；sample outcome 必須由 Research fog 遮罩後的 planning map 計算，不能顯示未揭露 cure／side effect／portal 或權威終點，也沒有通關判斷。
- Splitter／Merger 在取得 `Split / Merge` 前顯示鎖頭；點擊、hover 或按 `2`／`3` 只顯示解鎖提示，不切換 brush。
- Plan 產線（第一個 Source → Sink，Splitter 走第一個 output）的路徑在 Research 地圖上以淡紫寬帶＋`Plan` 標記預估，fog 當平地；`lab-map-frame` 的 `data-plan-line` 是該路徑點數。
- `Commission $N` 是可選快捷：以 Production 目前 layout為基準報價，成功後開啟 Production。
- 關閉或從未使用 Production Plan，不影響玩家直接在 Production 建造。

## 7. Production

- F3 新局即顯示空白 24×12 editor與Play/Pause/Step/Reset；沒有封鎖狀態。
- 每個 place／move／rotate／paste／undo／redo都提交 paid layout diff。ghost在操作前顯示cost；現金不足明示拒絕且world不改。
- 非Erase tile gesture不得刪除或覆蓋既有machine；hover ghost與click／move authority一致。Touch Erase可刪machine。
- Factory clipboard精確保存tile payload；Source period、Splitter outputs與Merger inputs不可在paste時重設。
- tile與machine移除不退款；只有接受的edit才停止播放並令runtime歸零，累積waste保留。no-op、invalid與insufficient-cash rejection不暫停也不改history。
- 有runtime進度時Reset先以可取消確認列出「清runtime／保留inventory與waste」；initial runtime不需要可用Reset。
- Details 按需顯示 tick、sink outcomes、waste、十進位 units/tick 與 bottleneck；空 inspector 預設關閉。建造工具、報價、Rotate、Undo／Redo 與 Play／Pause 在底部操作區。選取機器顯示名稱、input/output 數量、ticks/unit、processing cost、rotation；blocked 狀態仍直接顯示在 world。
- machine hotbar tooltip同時顯示ticks/unit與每件processing cost；不要把一次性建造費和持續生產成本混成同一數字。
- no-cure／failed產品進waste；side effects跟實體產品進市場計價，UI不先過濾成「合法配方」。
- 正常new game顯示$1000；fresh Research後的有效first line必須可支付，insufficient-cash錯誤不能是正常bootstrap必經狀態。

## 8. Connected transport visual contract

- belt不是每格獨立箭頭或按鈕；連線延伸到格邊，grid在其下方。
- isolated、endpoint、對向straight、60°／120°turn與multi-way junction由sim-derived六邊incident mask決定。
- splitter／merger branch、source／sink與machine input/output ports使用同一edge authority。
- 錯向相鄰格保留斷口；machine port明確顯示connected／disconnected。
- Belt drag保持E／SE／SW／W／NW／NE六鄰接連續並在轉折格改方向；末格方向沿最後切線。
- LMB／touch從既有machine上拖曳會直接搬動整台machine，保留machine identity；被占用或越界的落點以invalid ghost顯示且不提交。
- moving markers僅在Production依runtime tick動畫；Production Plan可以顯示靜態topology，不假裝時間流動。

## 9. Blueprint drawer

- Library lifecycle與save slots分離。
- Blueprint v4 codec（ruleset 5）可匯入現行`research-program`，但Library不提供Research capture／apply；Research card只可Download／Delete，不得繞過付費 Run、揭霧或產生outcome。Library namespace是`hexapharma.blueprint-library.v4`。
- capture Production Plan或Production都產生通用`factory-layout`，以`{q,r}`保存routing與`{id,typeId,anchor,footRot}`，`footRot`為0–5。
- Factory card提供`Open in Production Plan`與`Commission $N`；後者走正式Production construction cost。
- floor dimensions與目前entitlement不符時card仍可讀，但目的地disabled並顯示`Build unavailable`；render不得throw。
- 跨存檔 Blueprint若使用未解鎖或不相容machine，拒絕訊息必須使用玩家看到的machine名稱，不得顯示`zigzag`、`loop`等內部type ID或machine數字ID。
- paste/upload/download/delete使用strict version/checksum/content/bounds validator；錯誤可見且import atomic。
- delete先以可取消確認列出將永久移除的cross-save Library entry。
- 舊文件顯示unsupported；不能猜成現行payload。

## 10. Other drawers / responsive acceptance

- Market／Technology cards可用buttons，因它們是離散管理決策。Technology只摘要已取得且非零的Factory columns／rows、Research scan與machine數量；root node不顯示`Requires: None`，卡片也不以locked chip和disabled Unlock重複狀態。Market公開需求板每疾病顯示Base、Sold、Next gross、Clean stock與Tainted stock；最佳可售庫存另列production cost、`$25 × effect count`與net，但不表示Atlas Cure已揭露或提供位置。
- Technology machine cards對Zigzag／Loop／Straight與Crane分別顯示Disease 1／2／3／3 contract requirement；quota固定3。UI應使用sim導出的gate mapping與contract progress，不能複製另一份規則。
- `Ship best`依side-effect count、production cost、inventory ID掃描第一個positive-net產品；`Ship profitable`用同一順序略過non-positive候選，只出售逐件計入demand後仍positive-net的產品。沒有治療庫存或沒有可賺產品時，兩個action disabled並各自顯示原因；只有authority接受出售後才可顯示`Shipped`與每件`+1 Knowledge`，rejected intent不得假報成功。
- 探索輔助只能放大actual executed segment的sensor radius；Unlock本身不能揭霧。
- 擴廠若清Production runtime／waste，Unlock前必須有可取消確認；不改 Research 的 lastTrial 或本地規劃。
- Load若會覆蓋不同的current game、Rewind若會永久丟棄最新checkpoint，都必須先列出影響並可取消。
- desktop 與 mobile 皆讓 world 佔主體；Details 預設關閉，桌面展開在 world 旁、窄屏在下方。工具與主要動作獨立排版，不蓋住 canvas；touch controls 至少 44px、focus 可見、錯誤 aria-live。窄屏 HUD 兩列，system controls 收 Menu，工具列保留可見 scroll 提示。
- machine以silhouette、footprint、full-path glyph、ports辨識；terrain/portal不能用raw debug text冒充美術。
- Atlas與Factory都顯示pointy-top axial hex；cell authority是`{q,r}`，六方向依序為E／SE／SW／W／NW／NE，dense arrays以`r * width + q`索引。hit-test、ghost、region edge、transport與renderer必須一致；兩個domain的payload／validator仍分離。
- 定向越野地圖語言的嚴格俯視 2D：紙底＋近黑墨印；ISOM 色語（山＝淡褐、水＝藍色水平線、黑格＝黑墨、治療＝綠、副作用＝琥珀、失敗＝紅、流動＝藍；霧下只有單一墨色等高線）；路線紫只屬玩家自己的線（研究實際路線、規劃虛線、選取、Plan overprint）。Production 為黑墨實印、Plan 為紫色 overprint。手繪感只來自確定性墨線抖動，不用於 port、belt 接點、hit-test 幾何或文字；Pixi vector runtime 保留 canonical true hex。完整規格見 [design.md](design.md#visual-language)。
- 禁止3D透視、glass blur、giant pill、gradient／glow halo與常駐tutorial遮world。

## 11. Copyright boundary

- 不抓取或打包競品 screenshots、sprites、icons、fonts、sounds、CSS或UI layouts。
- Atlas／Factory world assets由repo內Pixi vector程式碼runtime繪製；沒有generated bitmap或runtime manifest contract。
- 文件只使用本專案 screenshots；外部研究只連官方來源。

The build readout quotes the pointed placement or move through the construction authority; it does not promise a generic replacement price.

Market states how much the currently profitable stock can still net, and how many units that covers, with demand declining after every selected shipment. This is not a lifetime estimate for the line. Unprofitable stock suggests improving cost or quality, or another disease. Technology shows missing cash, Knowledge, and contract shipments. With no cash left, it points to Market and cheaper routes, with Menu → New Game as an optional fresh start after saving; it does not declare the run irrecoverable.

Research retains its logical camera coordinates while matching the canvas backing resolution to the displayed size and device pixel ratio. Responsive enlargement must not introduce a low-resolution blur; resizing redraws once and does not start a permanent animation loop.

Research reserves at least 80% of its stage height for the world at the tested desktop size. The short mission hint overlays the world without intercepting input; compact tools and the action row keep their touch targets. Revealed Abyss interiors remain visibly darker than fog, while undiscovered terrain stays indistinguishable from hidden empty cells.

Research cover canvas 的 pan／zoom／focus 依 clipped frame 實際可見的 logical viewport 限制 camera；視窗 resize 不會把 map 邊界固定在畫面外。
