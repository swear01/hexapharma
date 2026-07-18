# Invariants（不變式總表）

## Research path core

- 每個 `Machine` 恰為 `{typeId,path}`；`path` 是 catalog 定義的完整 fixed `PathStamp`。
- UI、GameIntent、Save 與 Blueprint 都不得表示「只走完整 path 的一部分」。加入或移除 Research step 必須以整台 machine 為單位。
- 同 program、start 與 terrain 下，planning preview 和 execution 使用同一 pure traversal，逐 cell 與 portal discontinuity 相同。
- `ResearchProgram` 是 ordered machines；下一步從前一步的實際 endpoint 繼續。不得另存任意 anchor、auto-route 結果或 FactoryLayout。
- program 進 state、trace、save 前必須 canonical validate、own 與 freeze。
- 選Research machine只建立完整candidate；只有candidate endpoint hit可提交step。blank world click不改program。
- ordered route strip只投影program；每step與總shot cost由catalog重算。移除任意step以整台machine為單位，後續endpoint不得保留舊cache。

## Terrain、portal 與 fog

- Active Research 只有單層座標；跨層位置或交換層操作不得出現在 active program、palette、mapgen、Blueprint 或 Save v7 authority。
- Wall／OOB、Abyss、Swamp 與 Portal 各有 pure、deterministic、共享於 preview／execution 的語意。
- 每個 portal entry 恰有一個同層 destination；每個 destination 最多一個 entry。B 不可反向作 A；trail 在 jump 處斷開。
- Wall 不受探索遮罩隱藏，未揭露時仍必須可讀並影響 preview。
- Abyss、Swamp、Portal entry／exit、Cure與SideEffect只有揭露後才能出現在 renderer、planning map、region 邊界、hover、ghost 或 outcome UI；未揭露時等價於普通 substrate。Portal pairing、方向與 planning jump 必須兩端都揭露後才可見。
- planning、選工具、放置 program step、載入 Blueprint 或移動 camera 都不改 fog。
- 只有實際完成的 Research path segment 依 sensor radius 揭露；portal 不揭露兩端之間的直線。
- Pilot sample outcome 只可讀取同一份 fog-masked planning map；免費、零時鐘的 layout diagnostics 不得查詢隱藏 Atlas authority。Production 的實體產品仍依完整權威地圖結算。
- fresh fog在每張active map只揭露start-centered radius 2方格，即正常邊界內5×5；不能沿reference預揭露。
- Cure與SideEffect是獨立arrays／overlays；同一cell可同時有兩者，evaluate必須同時加入`cured`與`sideEffects`。
- 每個EffectMap入口必須驗width/height area、exact `Uint8Array`／`Int16Array`／`Int32Array`種類與長度、CellKind與fog值域、`-1`或non-negative effect IDs，以及safe integer且在bounds內的origin/start；不得因overlay而要求Cure與SideEffect互斥。

## Map generation

- canonical seed + 完整 options 唯一決定 Atlas、terrain、portal、diseases、cure／side-effect overlays、price、difficulty 與 reference programs。
- start 是 generator 宣告的中心 authority；開局 camera 聚焦 start，正常 viewport 只涵蓋世界的一部分。
- mapgen 禁 `Math.random()`／wall-clock；不依賴 Set／Map iteration side effect。
- active game只接受單一Atlas與1–8疾病；default options恰為4疾病。
- terrain-first radial progression + motifs先完成權威terrain，再由同seed constructive產生可執行且signature／endpoint有差異的references；不得標記或保護universal reference corridor。
- 正常尺寸generated reference的terrain traversal endpoint必須不同於忽略terrain的empty-map endpoint；cure regions彼此不重疊。
- 正常尺寸的所有Cure cell都在start-centered 5×5之外；region必須連通且不能退化成跨seed固定模板。
- default disease 0 reference只能使用initial catalog；後續tiers才依序允許`skew`、`dilute`、`settle`。所有reference都必須可執行且治療對應疾病。
- 每個constructed reference endpoint必須是無SideEffect的Cure；每個非退化cure region至少含一個Cure+SideEffect cell。
- solver以整個Cure region為goal並只供tests/tools的minimum steps／cost與quality checks；不進runtime、UI或生成rejection loop。

## Research facility

- Research 只持有 Atlas fog、ResearchProgram、shot 與 last outcome；不持有 source／belt／sink routing 或 FactoryLayout。
- Research shot 必須有至少一個 step，開始時只扣一次完整 cost；中止、fail 或 no-cure 不退款。
- shot progress 只能向前；已完成的 segment 才能改 fog。編輯 program 時不得有 active shot。
- Research intent 不能寫 Pilot／Production layout、runtime、inventory 或 waste。
- active shot期間camera view跟隨權威dose位置；完成Outcome UI必須同時呈現已知cures與side effects，不得因有cure省略污染。

## Pilot Plant

- Pilot layout nullable；空 Pilot 不阻止玩家打開或編輯 Production。
- Pilot edit 不扣 cash、不推進 tick、不產生 inventory／waste，也不改 Research。
- Pilot diagnostics 是 bounded read-only analysis；no-cure、side effect、failure、deadlock 或低吞吐不是 layout rejection。
- 從 Pilot 建到 Production 必須走與直接 Production edit 相同的 paid `buildProductionLayout` authority。

## Production construction

- `createGameState` 必須建立 owned、non-null、24×12 空 Production layout 及相符的 initial runtime。
- Production 不依賴 Pilot state；玩家從新局即可直接提交合法 layout edit。
- `quoteProductionBuild(current, proposed)` 必須只按新增／改建內容計費：belt 2、splitter／merger 8、source 12、sink 6、machine `10 × def.cost`。
- 相同 tile 方向不收費；方向改變按新 tile 收費。機器 type／anchor／footRot 相同即已安裝，ID 差異不收費；移動／旋轉／換 type 按新機器收費。
- removal 不收費、不退款；報價必須是 non-negative safe integer。
- 現金不足或 layout 無效時，cash、layout、runtime、waste、trace 原子不變。
- no-op、碰撞、越界或現金不足的UI edit也不得停止Production播放或寫入editor history；只有authority接受的layout edit才停止並重建runtime。
- 接受 edit 時只扣一次報價、own layout、建立相符的 initial runtime，保留累積 waste 與既有 inventory。
- paid build intent 不得與相鄰 layout intent 合併或從 replay trace 消失。

## Factory runtime 與 transport

- 只有 `productionTicks` 推進 runtime；Pilot diagnostics 永不增加 tick、inventory 或 waste。
- runtime layout identity 必須等於 Production layout；layout edit 後不存在舊在途 unit 或 cursor。
- transport topology 只由 tile accept／emit sides 和 rotated machine ports計算；方向錯誤的相鄰格不形成 edge。
- topology cell 的 incident mask 唯一決定 isolated／endpoint／straight／corner／tee／cross；machine port 的 connected flag 與 edge authority 一致。
- renderer 不得為視覺連續性虛構 sim 沒有的 connection；animation phase 只由 runtime tick 決定。
- Belt drag rasterization 必須保持四向相鄰；各格方向朝下一格，末格沿最後切線；一個 gesture 只產生一筆 editor history。
- factory area、unit、tick、diagnostic work 皆有顯式 bounds；熱 tick 禁 per-unit 配置。

## Whole-game authority 與 economy

- GameState 同時 own `research`、`pilot`、`production`，三者不得 alias layout 或以隱藏 token 耦合。
- 正常UI new game origin的starting cash恰為1000、research為0；fresh loop不得需要外部資金／Knowledge或hidden reference才能到first sale。
- HUD New Game 只可用unsigned 32-bit seed建立標準fresh GameState；不得刪除save checkpoints或Blueprint Library。確認modal開啟期間，背景hotkeys不得產生GameIntent、Factory edit或navigation authority change。
- mapgen每疾病base price恰為`12 + 4 × difficulty + 2 × referenceCost`，使用safe integer arithmetic。
- 每疾病demand獨立：第0件gross=base；下一件反覆`floor(previous × 9 / 10)`直到0，無正值floor。
- Market 每個 inventory product 只可賣一次；收入由實際 cure、side effects、production cost 與 sold counters 決定。
- Market的`Shipped`與Knowledge成功回饋只能由accepted `sellProducts` intent產生；rejected或stale inventory intent必須顯示錯誤，不得同時假報成功。
- Market候選stable order為side-effect count、production cost、inventory ID；single/bulk automatic shipping必須略過non-positive候選，只出售逐件計入demand後仍有positive net的產品。略過項目不消耗demand，不得自動虧本出售。
- 同 origin + canonical intent trace replay 必須逐欄位與 hash 相同。
- 擴廠若清 runtime／waste，確認前全部 authority 原子不變；解鎖不得中止 active Research shot。

## Blueprint v3

- document／ruleset 固定 version 3，checksum 是 canonical blueprint payload 的 lowercase SHA-256。
- Research kind 只能是 `research-program`，payload 只能有 ordered `{typeId}`；不得存 path cells、FactoryLayout、fog、seed、outcome 或 economy。
- Factory kind 只能是 `factory-layout`，payload 是 dimensions、sparse routing 與 `{id,typeId,anchor,footRot}`；不得存來源場域、fixed content、diagnostics、runtime、inventory、waste 或 economy。
- strict decoder 必須拒絕 unknown／missing fields、wrong kind/version/content/checksum、unknown type、duplicate IDs/tiles、collision、越界與 quota violation。
- Library namespace/lifecycle 與 save slots 分離；Load／Rewind／換 slot 不改 Library。舊文件不得 silent reinterpret。

## Save v7 與 checkpoints

- full／compact／slots／rewind 都使用 Save v7，逐欄位重建 Research、nullable Pilot、non-null Production、fixed path、layout 與 cold runtime；typed/runtime data 不得 alias。
- compact reader 在 semantic replay 前先驗 raw ticks／intent count／work caps，之後比對 canonical trace 與 state hash。
- `buildProductionLayout` 的費用與次序是 replay authority；不能只保存最後 layout 而漏掉 cash 歷史。
- decoder 對 unknown／missing fields、unsafe integers、invalid path/layout/runtime、oversize 與 replay forgery 顯式失敗；舊 schema 不 migration。
- checkpoint lineage 外層 version 2 與內層 Save v7 是兩個獨立版本；不得交叉 reinterpret。
- corrupt blob 不得被空/default game 偷換；Recover 前保留 raw data，且 recovery 原子。
- Load不同saved state與Rewind丟棄最新checkpoint都先取得可取消確認；Cancel不得改GameState、slot history或Library。
