# 玩家指南

這份文件保存完整操作；遊戲內 ? Help 提供核心操作指南，常駐介面只保留短標籤、hotkey、狀態與錯誤。

## 啟動與連線

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 在伺服器本機開啟 `http://127.0.0.1:53346/`。
- 從遠端開啟 <http://138.2.52.9:53346/>。
- 只能使用 53346；若 port 被占用，先處理占用程序，不要改 port。
- 公開試玩版：<https://hexapharma.5334601.xyz/>（備援 <https://swear01.github.io/hexapharma/>）。只在 main 的 `check` 通過後由 `.github/workflows/pages.yml` 自動部署；存檔留在你用的瀏覽器 localStorage。

## 全域操作

| 動作 | 操作 |
|---|---|
| Research / Production Plan / Production | `F1` / `F2` / `F3` |
| Market / Technology / Blueprints | `M` / `T` / `B` |
| 關閉 drawer | `Escape` 或 `×` |
| New Game | Menu → New；輸入 0–4294967295 的 seed 後確認 |
| Save | `Ctrl+S`／`⌘S` 或 Menu → Save |
| 選存檔 | Menu slot selector；每個 slot 有獨立 rewind history |
| Load / Rewind / Recover | Menu 對應文字按鈕；覆蓋目前遊戲或丟棄checkpoint前會確認，錯誤不會靜默換成新局 |

沒有指定順序或目標：自己探索、建產線、出貨。頂列全是圖示，滑過可看名稱與熱鍵；Market 圖示旁的數字是庫存件數。完整符號圖例在 Menu → Guide。

Blueprint Library 與 save slot 分離；New Game、Load、Rewind、換 slot 都不會移除藍圖。New Game 只取代目前未保存狀態，既有 save checkpoints 仍可 Load 回來。

目前 [Save v16](save.md) 是開放、可編輯的 plain JSON。獨立 checkpoint/history 外層仍是 v2，內層使用 Save v16；舊開發版（含 v15）的存檔在遊戲啟動時刪除，不會升級。

正常新局從 $1000 cash開始，只有一張 Atlas，上面共6種疾病。全新 origin 的 Blueprint Library 為空；之後換 seed 會保留既有藍圖。URL query注入的cash／research只供開發驗證，不是正常玩法。

## Research

### 看地圖

- Atlas 遠大於 viewport；開局 camera 聚焦世界中心的 generator start，只有以起點為中心、hex distance radius 2 的19-cell disk已揭露，畫面只顯示整張圖的一小部分。地圖是pointy-top hex，六個相鄰方向為E／SE／SW／W／NW／NE。
- 路線終點的紫色尖頭指向藥物目前的朝向，也就是下一台機器「往前」的方向；路線上的小箭頭標出每台機器的前進方向。目前疾病的大概方位（Look local，或east／south-east／south-west／west／north-west／north-east）寫在其他場域的目標卡上，不是精確座標、距離或reference route。
- 拖曳任一滑鼠鍵可平移；滾輪以游標位置縮放。左下四個三角形會平移地圖，中間的定位圈（或`F`）會聚焦規劃路線的終點（沒有規劃時聚焦最近試驗的實際終點）；點左上清單的一台機器會把它的終點置中。每次 Run 立即resolve，沒有等待動畫結束的Dose階段或自動camera跟隨（唯一例外：剛找到Cure的試驗會把鏡頭拉到能看見整條實際路線，可隨時拖曳中斷）；切到其他建築再回來不會重設手動camera。
- Atlas 是一張六角形大地圖，外緣一圈山。中央起點被一圈厚山（內環）圍住，只能經由 2–3 條彎曲隘口出去；隘口兩端較寬、中段是一格寬的窄道。外圈還有山弧、環形盆地（各只有一條 S 形入口）與湖。
- 霧是還沒印出的紙。霧下唯一看得到的是**等高線**：哪裡有起伏就有一圈圈線，但山和水畫得一模一樣，線也包含一些假的小起伏——它只告訴你「那裡有東西」。
- 地形揭露後才印出來：
  - **山（Wall）**（淡褐色）：取消該步，但機器繼續走剩餘 path。規劃預覽也會停在霧下的山前。
  - **水（Swamp）**（藍色水平線）：在水裡每一步只走半格；兩個同向半步剛好一格。離開到一般地面時會對齊到那一格的中心。停在半格時算作那一格水。
  - **黑格（Abyss，失敗）**（黑色、邊緣有刻痕）：藥物掉入後本次失敗並停止。★ 周圍、窄道出口外側（直衝出去容易掉）以及平地上零星的單格和短黑帶都有。
  - **Portal A→B**（目前地圖不會生成）：進入口後跳到固定出口，從出口繼續；不能由B反向進入。
- 山、水、黑格、Cure與SideEffect在揭露前都顯示為普通地面；不要把霧下空白當成沒有內容。
- Cure以綠色十字與區域邊界標示，副作用是琥珀色點網。Cure與SideEffect可在同一格重疊：抵達污染的Cure會同時治療疾病並帶來副作用；同一區的constructed reference endpoint是乾淨Cure。
- 每種疾病都有好到的小區（3–5 格）和藏在盆地或隘口後的大區（9–12 格）。大區中央 2–3 格是 **★（二級療效）**：終點落在 ★ 的產品在 Market 售價 ×1.5（無條件捨去）。

### 規劃路線，再付費試驗

1. **朝向**：藥有一個朝向，開局朝東（E）。每台機器的完整奇形 path 都相對目前朝向；走完後依機器固定轉向。機器（F＝目前朝向、R／L＝右／左前、B＝後）：

   | 期 | 機器 | path | 轉向 | 費用 | 解鎖 |
   |---|---|---|---|---|---|
   | 前 | Hook pump | F F R | 右 60° | $3 | 開局 |
   | 前 | Elbow press | L L F | 左 60° | $3 | 開局 |
   | 前 | Return coil | B B BL | 掉頭 | $2 | 開局 |
   | 前 | Wave reactor | F L F R F R F | 不轉 | $7 | 開局 |
   | 中 | Zigzag still | R F R F | 右 120° | $6 | 開局 |
   | 中 | Loop vat | F R BR B BL L F（繞一圈只前進 1 格） | 不轉 | $5 | 開局 |
   | 後 | Straight drive | F F F F | 不轉 | $12 | 開局 |
   | 後 | Crane arm | F F F L L | 左 120° | $11 | 開局 |
hotbar 圖示會轉到規劃路線終點的朝向。
2. **規劃（免費）**：點 hotbar 或按數字鍵`1`–`9`把機器接到路線末端。紫色虛線是**只用已知地圖**算出的預估：霧下當成平地，只有山（Wall）照算——霧下看不到的山也會擋住預估路線。`Undo`、Backspace、`Ctrl+Z`／`⌘Z`，或點地圖上最後一個編號控制點（游標提示`Remove last step`）移除最後一步；`Clear`清空。Run 若撞到霧下的山、水或黑格而偏離預估，下一次接機器或 Undo 會先刪掉偏離那一步之後的步驟（撞牆、踩進沼澤那步留著；掉進 Abyss 那步也刪）。Run 左邊顯示跑完後剩下的現金。規劃不花錢、不揭霧、不存檔。
3. **Run · $N**（Enter）：一次付整條路線的機器費用總和，從起點在**真實**地圖跑完整條。霧下的 Wall、沼澤、Abyss、Portal 可能讓實際路線（紫色實線）偏離預估；Run 前的預估留成淡虛線，第一個偏離處以紅圈標出；點那一格可看是什麼地形擋住。點已揭露的治療格顯示疾病、等級（Tier 2 ★ 售價 1.5×）與是否帶副作用；點地形格或副作用格顯示它的作用。只揭露實際走過的格與其周圍。Run 後規劃保留，可依新地圖修改再跑；同一路線重跑也要再付費。
4. 結果同時列出Cure與已知Side effects；不能只看`Cure`而忽略同一endpoint的污染。掉進 Abyss 時路線在那一格中止並顯示 Failure。
5. Research 不會產生配方。找到 Cure 格後，到 Plan 用同樣的機器順序自己排產線；Plan 的 Sample 只依已揭露地圖預估。Plan 產線的路徑也以淡紫寬帶畫在 Research 地圖上（同樣只用已知地圖預估），方便對照規劃路線。

正常新局預設6種疾病，所有機器開局即可用。地圖的hidden reference不會在遊戲中顯示，玩家要以每次試驗揭露的結果自行修改路線。

## Factory共同操作

Production Plan與Production使用相同editor，但一眼可分：Plan 以紫色虛線 overprint 繪製，底部是 `Commission $N`；Production 以黑墨實印，底部有報價與 Play，Play 左側圖示表示執行中／暫停，卡住時顯示 Blocked，任何編輯會重新開始產線。Details 預設收起，按下才顯示診斷；底部提供工具、報價、旋轉與播放。工具列是圖例：機器以「footprint＋path」token 與全名顯示（與 Research 相同），未解鎖機器顯示鎖頭與解鎖條件。起步只有 Belt、Source、Sink、Erase 與機器；Splitter／Merger 要先在 Technology 解鎖 `Split / Merge`。Source 是空心三角。Sink 是雙圈；機器的 port 是邊上的箭頭，指向機內是 input、指向機外是 output，空心代表尚未連接；belt 是藍色帶狀線，箭頭表方向。放置前的半透明 ghost 就是建好後的樣子，紅色表示放不下。

### Camera與工具

| 動作 | 操作 |
|---|---|
| 放置／畫線 | LMB click或drag |
| 擦除 | `X`（或`6`）選Erase：drag拉框，放開刪除框內全部，click刪一項；任何工具下RMB click或drag也會擦 |
| 選取 | `V`選Select：在空地drag拉框，Shift+drag加選；拖曳已選項目整組搬動 |
| 刪除選取 | `Delete`／`Backspace` |
| 平移 | `W` `A` `S` `D`或MMB drag |
| Touch 平移 | 兩指drag，或從場地格外開始drag |
| 縮放 | 滾輪；camera reset按鈕回到100% |
| Belt / Split / Merge / Source / Sink | `1`–`5` |
| Machine slots | `7`–`0` |
| 旋轉 | `R`順時針、`Shift+R`逆時針：brush、游標下既有machine、手上的Paste或拖曳中的選取 |
| Pipette游標下內容 | `Q` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y`或`Ctrl+Shift+Z` |
| Copy / Cut | `Ctrl+C` / `Ctrl+X`：有選取時處理選取，否則處理游標下項目 |
| Paste | `Ctrl+V`拿起Paste ghost，click放下（可連放） |
| 取消 | `Esc`或RMB：先放掉手上的Paste，再清除選取 |
| Production播放／單步 | `Space` / `.` |

輸入框有焦點時這些按鍵不作用。

- Belt一次drag會從起點到游標形成六鄰接連續hex route。每格方向跟著下一格，轉折會用connected texture顯示。
- connected transport只在方向與接收面真的相容時接上。斷口或unconnected machine port代表sim也不會通過。
- machine的`R`每次只把footprint、ports與icon順時針旋轉60°；六次回到原向，不改其chemical path。
- 從既有machine上直接拖曳即可搬動整台machine；越界或碰撞時不會破壞原layout。Touch單指在格內使用目前工具，因此可連續畫Belt、直接拖動machine，或用Erase／Select拉框；有選取時底部出現Copy與Delete，剪貼簿有內容時出現Paste；兩指drag負責camera。Touch點一下既有machine後再按`R · Rotate`可直接旋轉它。
- 非Erase工具畫過machine footprint會略過該格，不會暗中拆機。hover既有machine時預覽其現有footprint，不顯示不存在的建造或刪除費。
- Copy／Cut／Paste保留tile的完整方向與參數，包括Source period及Splitter／Merger branches；剪貼簿與Blueprint是同一份factory-layout。Paste與搬動選取照手放規則：machine要空地，tile可蓋過tile但不能壓在machine上，有一項放不下整個ghost變紅；Production照常收建造費，移除不退款。`Q`只把游標內容選成目前brush。
- invalid ghost代表碰撞、越界或其他geometry錯誤；放開滑鼠不會偷偷修正。

### Transport方向

- Factory使用pointy-top axial hex；direction依序是E／SE／SW／W／NW／NE。
- Belt接受相鄰輸入並朝箭頭方向輸出。
- Splitter從`inDir`接收，依固定round-robin送往多個outputs。
- Merger依`inDirs`固定優先順序接收，再往`outDir`輸出。
- Source按period產生unit；Sink消耗到達unit。
- Machine只能從input port收料、從output port出料。footprint上的port標記會顯示是否連接。

## Production Plan

- Production Plan沒有clock、建造費、inventory或waste；適合從空地反覆排列layout。
- Throughput以三位有效數字顯示，保留很低但非零的速率。
- inspector的Sample、Throughput與Bottleneck只幫你判讀，不限制layout；Sample只依Research已揭露地圖計算，不能用來偷看霧下Cure、SideEffect或Portal配對。無法分析時會顯示可見錯誤。
- 可在Blueprint drawer用`Save Production Plan`保存通用Factory Blueprint。
- `Commission $N`會以Production現況計算差異費用。現金足夠時建到Production並切換F3；現金不足時Plan保持不變。
- Production Plan完全可選；你可以直接按F3開始正式建造。內部save／intent欄位仍可能顯示為開發名稱`pilot`，不是另一個玩家場域。

## Production

- 新局已有空白24×12 pointy-top hex場地。每次成功place、drag、move、rotate、paste、undo或redo都可能產生建造費。
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
- `Space`切換Play/Pause；`.`在Pause時前進一tick。底部圖示鈕也可Play／Pause、選1×／2×／10×速度與Step。
- Sink送出的cure進Stock；failed/no-cure增加Waste；side effects跟著實體產品影響售價。
- Market的疾病需求卡是公開資訊，但只有Production產生且仍在Stock的實體cure可以販售；需求卡不代表Atlas Cure已揭露，也不提供位置。同一產品只能賣一次。正常新局$1000必須足以在Research支出後建出第一條有效產線並到達第一次出售。

## Blueprints

1. 按`B`開Library，輸入Name。
2. `Save Production Plan`／`Save Production`保存通用FactoryLayout。目前沒有`Save Research program`或`Load in Research`；Research 必須自己規劃並付費 Run。
3. 匯入現行Blueprint v4（ruleset 6）`research-program`時，Library只顯示內容並提供Download／Delete，不會把它套入Research。Library使用`hexapharma.blueprint-library.v4`。
4. Factory card可：
   - `Open in Production Plan`：免費覆蓋Plan layout。
   - `Commission $N`：以Production目前layout報價並付費建造。
   - 藍圖尺寸與目前Technology entitlement不同時，目的地停用並顯示`Build unavailable`；先取得相符場地再套用。
5. Download取得versioned JSON；Upload或貼上JSON可import。checksum、content或geometry不相容時會明示拒絕。
6. Delete先顯示可取消確認；確認後只永久刪除跨存檔Library entry，不改目前Research／Production Plan／Production。

## Technology、Market與重置

- Technology是一張樹狀圖，每個節點都是免費開關（測試期，連線只表示下一階、不擋開關）：machine、Split / Merge、場地與Research輔助都可隨時開或關，沒有成本、前置或合約條件。新局所有machine與Split / Merge已開，場地與Research輔助關著。打開探索輔助本身不揭霧，只增加之後Research試驗實際路徑的感測半徑。
- 關掉仍在Plan或Production使用的項目（該機器、Splitter／Merger、擴出來的格子上有東西）會被拒絕；先移除再關。擴廠開或關都會重置Production runtime與waste，會先確認。
- 若目前庫存沒有正net出貨，先改善成本／品質或嘗試另一種疾病。只有整局確實沒有可行改善時才以New Game重開。
- 同一疾病的每塊治療區各有價格：越難到（最便宜路線越貴、要穿過窄段、旁邊有黑格）越貴，深入盆地的大區比近處小區值錢。產品依終點所在的區計價；第一次出售取得該區價格，之後同疾病的價格逐次乘`19/20`（取整）直到0。不同疾病各算自己的Sold與Next。
- 有庫存的需求卡列clean／tainted／★件數（★ 售價＝價格＋價格的一半，取整）與下一件的net；滑過net看算式（價格 − production cost − 每個effect `$25`）。沒有正net庫存時，Ship disabled並直接顯示原因。沒有庫存的疾病只列下一件價格。
- Market的`Ship best`按side effects最少、production cost最低、inventory ID最早的順序，略過不賺錢的候選後出售第一件正net產品。`Ship profitable`掃描相同順序，只出售在當下demand仍為正net的項目；略過的庫存不消耗demand，也不會被自動丟棄。畫面會顯示本次出售回饋。
- 擴廠若會清除Production runtime／waste，確認視窗會先列出影響；Cancel不改任何authority。
- blocking confirmation 開啟期間 Production timer 不增加 tick、inventory、cash 或 waste；Cancel 恢復原播放狀態，原本 Pause 不會自動 Play。確認 New／Load／Rewind／擴廠後舊 timer 停止。一般 drawer 與場域切換不暂停生產。

## 回報問題

附上：

- URL、seed與完整generation options；
- tick範圍或Research path segment；
- input trace／program或Factory layout；
- 預期、實際結果與第一個違反的不變式；
- screenshot與console error。

完整手動驗收步驟見 [playtest.md](playtest.md)。

World hotkeys are disabled while any drawer is open, but Production keeps running. The build readout quotes the pointed placement or move through the construction authority; it does not promise a generic replacement price.

Unprofitable stock suggests improving cost or quality, or another disease. With no cash left, use Market and cheaper routes, or Menu → New Game after saving.
