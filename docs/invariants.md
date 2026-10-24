# Invariants（不變式總表）

## Research path core

- 每個 `Machine` 恰為 `{typeId,path,turn}`；`path` 是 catalog 定義、相對 heading 的完整 fixed `PathStamp`，`turn` 是 −5..5 的帶號 60° 步，兩者都必須與 catalog 完全一致。
- `DrugState` 恰為 `{pos, offset, heading, failed}`：每圖一個格與一個兩倍單位 offset，所有圖共用一個 heading 0–5。offset 只在 Swamp 格內非零，且只能是零或單位方向。
- path delta d 的世界方向恰為 `(d + heading) mod 6`；stamp 完成且未失敗後 `heading = (heading + turn) mod 6`，失敗時 heading 不變。
- Swamp 內每個 delta 走半格、其他格走整格；目標格由整數比較 P/2 與目前格及六鄰格決定，平手先取目前格再依 E／SE／SW／W／NW／NE；Wall／OOB 取消該 delta；離開到非 Swamp 格對齊格中心；Portal 只在格中心進入。沒有 energy。
- UI、GameIntent、Save 與 Blueprint 都不得表示「只走完整 path 的一部分」。
- 同 program、start 與 terrain 下，planning preview 和 execution 使用同一 pure traversal，逐 cell、半格點與 portal discontinuity 相同。
- 規劃路線只是 UI 本地狀態；只有 `runResearchTrial` 改 authority。program 進 state、save 前必須 canonical validate、own 與 freeze。
- blank world click 不改規劃、cash 或 fog；點規劃最後一個控制點只移除該步。

## Terrain、portal 與 fog

- 每個 base 一張 pointy-top axial `{q,r}` Atlas（map index＝base）；一劑藥（Research 試驗、factory unit、產品）恰在一個 base 上，traversal、Abyss、Swamp 與 evaluate 只讀該 base 的圖。跨圖位置或換 base 操作不得出現在 Research program、palette、mapgen、Blueprint 或 Save v15 authority。
- 鎖住的 base（`oil-base`／`ethanol-base` 未開）不得用於新的 Research 試驗或 Source；Plan／Production 有 Source 使用某 base 時，關閉該 base 原子拒絕。
- Wall／OOB、Abyss、Swamp 與 Portal 各有 pure、deterministic、共享於 preview／execution 的語意。
- 每個 portal entry 恰有一個同層 destination；每個 destination 最多一個 entry。B 不可反向作 A；trail 在 jump 處斷開。
- 霧下 renderer 只畫等高線（加上開局揭露的起點 disk）：未揭露格一律是普通 substrate，Wall 也不填色、不畫邊。等高線只讀 `EffectMap.elevation`（sign-free 壓縮起伏＋由 |elevation| 決定的 seeded decoys，單一墨色），不得讀 fog、cell 或效果欄位，因此山與水在霧下長得一樣。揭露後才印地表：山＝淡褐填色、Swamp＝水紋、Abyss＝黑。
- 霧下沒有任何地形資訊進入規劃：planning map 把 Atlas 內所有未揭露格（包括山）當作空地，只有 Atlas 外框視為已知。預估可能穿過霧下的山，實際 Run 撞牆時才揭露；不得用預覽偵測霧下的山或水。
- Abyss、Swamp、Portal entry／exit、Cure與SideEffect只有揭露後才能出現在 renderer、planning map、region 邊界、hover、ghost 或 outcome UI；未揭露時等價於普通 substrate。Portal pairing、方向與 planning jump 必須兩端都揭露後才可見。
- planning、加入／移除規劃步驟、載入 Blueprint 或移動 camera 都不改 fog。
- 只有付費試驗在真實地圖上實際走過的格（含終點）依 sensor radius 揭露；portal 不揭露兩端之間的直線。
- Production Plan sample outcome 只可讀取同一份 fog-masked planning map；免費、零時鐘的 layout diagnostics 不得查詢隱藏 Atlas authority。Production 的實體產品仍依完整權威地圖結算；factory unit 以 fixed-capacity typed arrays 帶 base／heading／offset（Source 的 base），結果必須等於在該 base 圖上的 `applyTemplate`。
- fresh fog在每張active map只揭露start-centered hex distance radius 2，即不受邊界裁切時恰為19 cells；不能沿reference預揭露。
- Cure與SideEffect是獨立arrays／overlays；同一cell可同時有兩者，evaluate必須同時加入`cured`與`sideEffects`。
- 每個EffectMap入口必須驗width/height area、exact `Uint8Array`／`Int16Array`／`Int32Array`種類與長度（含 `cureTier: Uint8Array`、`regionId: Uint16Array` 與 `elevation: Int16Array`）、CellKind與fog值域、`-1`或non-negative effect IDs、Cure 格 tier 恰為 1 或 2 而其他格為 0、`regionId` 恰在 Cure 格非 0，以及safe integer且在bounds內的origin/start；不得因overlay而要求Cure與SideEffect互斥。
- `Outcome.premium` ⊆ `cured`：只有終點 Cure 格 tier 為 2（★）的疾病。

## Map generation

- canonical seed + 完整 options 唯一決定 Atlas、terrain、portal、diseases、cure／side-effect overlays、price、difficulty 與 reference programs。
- start 是 generator 宣告的中心 authority；開局 camera 聚焦 start，正常 viewport 只涵蓋世界的一部分。
- mapgen 禁 `Math.random()`／wall-clock 與 transcendental Math（`sin/cos/exp/sqrt/pow/...`）；只用整數雜湊、多項式 fade／kernel、整數平方根與常數表。不依賴 Set／Map iteration side effect。
- active game接受1–3個base（`nMaps`）與1–8疾病；default options恰為3個base、6疾病。疾病 d 在 base `d mod nMaps`。
- 所有 base 的 cell kind（Wall／Swamp／Empty 地形）、elevation 與隘口相同；效果區、副作用與 Abyss 各 base 獨立。reference、效果區保護、黑格放置與區價只看疾病自己的 base。
- Atlas 是半徑 R＝⌊(min(w,h)−1)/2⌋ 的六角形（R ≥ 8 時；更小的合法尺寸是無骨架的平板測試圖），六角形外與最外一圈全是 Wall；不產生 Portal。Wall 格 elevation ≥ mountain level、其餘 < mountain；Swamp ≤ water level、其餘可走格 > water level。
- 所有非 Wall、非 Abyss 格都從起點連通；不得有封閉口袋或單格湖。
- 內環 2–3 條、每個盆地恰 1 條隘口；每條隘口的窄道約占 40–60% 長度，且在完成的地圖上通過 bounded local BFS（initial catalog、真實 traversal、只走走廊＋兩端 2 格 pocket、≤10 步）。generator 可以為了驗證局部可通過性跑這種 bounded BFS 並據此重挖；solver 與任何解答仍不得進入 generator、runtime 或 UI。
- terrain 先完成，再由同seed constructive產生可執行且signature／endpoint有差異的references（BFS 樹或 sampled fallback；必要時以衍生 stream 重畫地形，≤4 次）；不得標記或保護universal reference corridor。
- 每疾病至少一個 easy 區（reference 終點所在、3–5 格、全 tier 1）與一個 hard 區（盆地或內環外、9–12 格、恰 2–3 格 tier 2）；void-fill 區 3–5 格 tier 1。任兩區不重疊；hard／fill 區不與其他疾病的效果相鄰。每個 Cure 格屬於恰一個區；tier 2 恰為 hard 區的 ★。起點 disk 外不得留下離所有特徵 ≥4 格的平地。
- 黑格不在隘口走廊、效果、起點 radius 3 內或 reference 經過的格；★ 核心周圍 3–4 格，平地單格 8–12 個、黑帶 2–3 條；放置後全圖仍連通且所有 reference 不失敗。
- 正常尺寸generated reference的terrain traversal endpoint必須不同於忽略terrain的empty-map endpoint；cure regions彼此不重疊。
- 正常尺寸的所有Cure cell都在start-centered radius-two hex disk之外，且 disk 內全是 Empty；region必須以六鄰接連通且不能退化成跨seed固定模板。
- default disease 0 reference只能使用initial catalog；後續tiers才依序允許`zigzag`、`loop`、`straight`＋`crane`（`DISEASE_CATALOG_TIERS`）。所有reference都必須可執行且治療對應疾病。
- 每個constructed reference endpoint必須是無SideEffect的 tier-1 Cure；每個非退化cure region至少含一個Cure+SideEffect cell，★ 永遠乾淨。
- solver以整個Cure region為goal並只供tests/tools的minimum steps／cost與quality checks；不進runtime、UI或生成rejection loop。

## Research facility

- Research 只持有每 base 的 Atlas fog 與 `lastTrial {base, program, cost, outcome}`；不持有 source／belt／sink routing、FactoryLayout、shot 或 formula。
- `runResearchTrial` 接受 1..256 台允許且與 catalog 一致的 machines；`cost = Σ catalog cost` 為 safe integer，cash 不足時整個 GameState 不變。成功時恰扣一次 cost、從關卡起點在 intent 指定 base 的真實地圖跑完整 program、只在該 base 的 fog 揭露實際 trail，並以 own／freeze 的 program 與 `evaluate(start, program)` 取代 `lastTrial`。試驗永不建立 formula。
- `lastTrial.cost` 必須等於其 program 的 catalog 總價，`lastTrial.outcome` 必須等於重播結果；解鎖 patent 不改 `lastTrial`。
- assay sector只能是local或east／south-east／south-west／west／north-west／north-east六個寬廣方向之一，不得顯示target座標、距離、reference program或未揭露region資訊。
- Research intent 不能寫內部 pilot／Production layout、runtime、inventory 或 waste。
- 每次 Run 在單一intent中resolve；不得虛構timed Dose phase。Outcome UI必須同時呈現已知cures與side effects，不得因有cure省略污染。

## Production Plan

- 內部 pilot layout nullable；空 Production Plan 不阻止玩家打開或編輯 Production。
- Plan edit 不扣 cash、不推進 tick、不產生 inventory／waste，也不改 Research。
- Plan diagnostics 是 bounded read-only analysis；no-cure、side effect、failure、deadlock 或低吞吐不是 layout rejection。
- Runtime `deadlocked` 只診斷最近 tick 的停滯，不阻止後續 tick 執行；週期來源仍按排程嘗試產出，真正堵塞則持續停滯。
- 從 Plan `Commission` 到 Production 必須走與直接 Production edit 相同的 paid `buildProductionLayout` authority。

## Production construction

- `createGameState` 必須建立 owned、non-null、24×12 空 Production layout 及相符的 initial runtime。
- Production 不依賴 Production Plan state；玩家從新局即可直接提交合法 layout edit。
- `quoteProductionBuild(current, proposed)` 必須只按新增／改建內容計費：belt 2、splitter／merger 8、source 12、sink 6、machine `10 × def.cost`。
- 相同 tile 方向不收費；方向改變按新 tile 收費。機器 type／anchor／footRot 相同即已安裝，ID 差異不收費；移動／旋轉／換 type 按新機器收費。
- removal 不收費、不退款；報價必須是 non-negative safe integer。
- 現金不足或 layout 無效時，cash、layout、runtime、waste 原子不變。
- no-op、碰撞、越界或現金不足的UI edit也不得停止Production播放或寫入editor history；只有authority接受的layout edit才停止並重建runtime。
- 接受 edit 時只扣一次報價、own layout、建立相符的 initial runtime，保留累積 waste 與既有 inventory。
- 每次 accepted paid build 都獨立扣款；後續 snapshot 保存結算後 cash 與 layout，不保留 lifetime trace。

## Factory runtime 與 transport

- 只有 `productionTicks` 推進 runtime；Production Plan diagnostics 永不增加 tick、inventory 或 waste。
- runtime layout identity 必須等於 Production layout；layout edit 後不存在舊在途 unit 或 cursor。
- transport topology 只由 tile accept／emit sides 和 rotated machine ports計算；方向錯誤的相鄰格不形成 edge。
- topology cell 的六邊 incident mask 唯一決定 isolated／endpoint／對向straight／60°或120°turn／multi-way junction；machine port 的 connected flag 與 edge authority 一致。
- renderer 不得為視覺連續性虛構 sim 沒有的 connection；animation phase 只由 runtime tick 決定。
- Belt drag rasterization 必須保持六鄰接相鄰；各格方向朝下一格，末格沿最後切線；一個 gesture 只產生一筆 editor history。
- factory area、unit、tick、diagnostic work 皆有顯式 bounds；熱 tick 禁 per-unit 配置。

## Whole-game authority 與 economy

- GameState 同時 own `research`、內部 `pilot`、`production`，三者不得 alias layout 或以隱藏 token 耦合；玩家文案必須稱 Production Plan／Commission。
- 正常UI new game 的starting cash恰為1000；fresh loop不得需要外部資金或hidden reference才能到first sale。
- Menu → New Game 只可用unsigned 32-bit seed建立標準fresh GameState；不得刪除save checkpoints或Blueprint Library。確認modal開啟期間，背景hotkeys不得產生GameIntent、Factory edit或navigation authority change。
- 每個 cure region 有唯一 id（1..），其所有格的 `regionId` 等於該 id；區價恰為 `regionPrice(difficulty) = 60 + 2 × difficulty`，difficulty 恰為 `min(120, reachCost + 6 × 窄段 + 2 × 路線旁 Abyss)`（到不了＝120、`capped`），全部 safe integer。`DiseaseSpec.basePrice` 是該疾病最便宜的區價。
- 每個疾病的 hard 區最高價 > easy 區最高價（pinned 34 seeds 測試；generator 不成立時 redraw）。
- 出售價使用產品 `outcome.regions` 中該疾病對應的區價；`Outcome.regions` 與 `cured` 等長且一一對應。
- 出售的產品若 `outcome.premium` 含該疾病，gross 恰為 `demand + floor(demand / 2)`（demand＝該件的 diminishing price）；只推進一次該疾病的 sold counter。
- 每疾病demand獨立：第0件gross=base；下一件反覆`floor(previous × 19 / 20)`直到0，無正值floor。
- Market 每個 inventory product 只可賣一次；收入由實際 cure、side effects、production cost 與 sold counters 決定。
- Market的`Shipped`成功回饋只能由accepted `sellProducts` intent產生；rejected或stale inventory intent必須顯示錯誤，不得同時假報成功。
- Market候選stable order為side-effect count、production cost、inventory ID；single/bulk automatic shipping必須略過non-positive候選，只出售逐件計入demand後仍有positive net的產品。略過項目不消耗demand，不得自動虧本出售。
- 每疾病 shipping contract quota 恰為3；progress只由該疾病 accepted sales 的sold count推導。active contract是首個未完成疾病；全部完成時是最後一個completed contract。
- 測試期（D42）Technology 是免費開關：開啟不扣 cash、沒有前置或合約 gate；關閉時 Plan 與 Production layout 必須在新 entitlement 下仍合法（不用該機器、Splitter／Merger，縮小的邊緣沒有 tile），否則原子拒絕。
- 同 initial GameState + 明確提供的 intents replay 必須逐欄位與 hash 相同。
- 擴廠若清 runtime／waste，確認前全部 authority 原子不變；開關不得改 Research `lastTrial`。

## Blueprint v4

- document 固定 version 4、ruleset 固定 6（Source tile 帶 `base`），checksum 是 canonical blueprint payload 的 lowercase SHA-256。
- Research kind 只能是 `research-program`，payload 只能有 ordered `{typeId}`；不得存 path cells、FactoryLayout、fog、seed、outcome 或 economy。
- `research-program`只保留strict codec／Library import-export相容；UI不得capture或apply，card只可download／delete，不能繞過付費試驗寫 fog 或 outcome。materialize 時 path／turn 一律取自 catalog。
- Factory kind 只能是 `factory-layout`，payload 是dimensions、使用`{q,r}`的sparse routing與`{id,typeId,anchor,footRot}`；`footRot`只允許0–5。不得存來源場域、fixed content、diagnostics、runtime、inventory、waste或economy。
- strict decoder 必須拒絕 unknown／missing fields、wrong kind/version/content/checksum、unknown type、duplicate IDs/tiles、collision、越界與 quota violation。
- Library envelope version 固定為 4，namespace 是 `hexapharma.blueprint-library.v4`；lifecycle 與 save slots 分離，Load／Rewind／換 slot 不改 Library。舊 v3 document／Library 不得 silent reinterpret，reader 拒絕時不得覆寫原 blob／legacy key。

## Save v15 與 checkpoints

- full／compact／slots／rewind 都是開放、可攜、可編輯的 plain JSON 冷快照；合法 Cash／sold／fog 編輯不要求操作或收入證明，不加密、簽章或驗資源 checksum。
- loader 不 replay；`origin`／`intentTrace`／`replayTicks`／`stateHash` 不是存檔欄位。`replayGame(initial, intents)` 的逐欄位／hash determinism 是獨立除錯契約。
- 在途 unit／進度／cost、splitter cursors、runtime counters、inventory／nextInventoryId、waste、Research `lastTrial`、economy、patents、fog、rng 必須完整保存；每個 drug 保存 heading 與 offset，且只有一個 base 的 `pos`／`offset`；unit、產品與 `lastTrial` 都保存 `base`。返回 layout 與 runtime 綁定同一 owned layout，nested typed/runtime data 不得 alias。
- decoder 在 allocation／restore 前驗 dimensions、collection counts、inventory group expansion 和 typed-array 可表示範圍；另驗合法 layout、runtime 質量守恆與容量、catalog（含 turn）、heading 0–5、offset 只在 Swamp 內非零、`lastTrial` 重播一致、inventory 結果等可執行不變式。unknown／missing fields、unsafe integers、無效狀態、oversize 顯式失敗。
- 版本與 `contentBuild` 不合即拒絕。content identifier 只包含 catalog／shapes／patents 與手動 rules revision；所有 sim／mapgen 邏輯變動都須提升 revision，它不是來源真實性證明。
- 生產預算只限制單一 batch，不能累計到整局。history 最多 20 snapshots，full/slots 上限 7,000,000 characters、browser checkpoint 上限 1,250,000 characters；compact inventory 展開不得超過 24,500 products。
- 正常 Load 嚴格驗 envelope；明確 Recover 可從同版本、可解析且字元／history array 數量有界的部分損壞 envelope 取已知欄位的字串候選，獨立驗 snapshot 並保留最新有效同地圖 suffix。讀取不覆寫；storage access 失敗須顯示原始原因並停用 Recovery。
- checkpoint 外層 version 2、內層 Save v15；key 為 `hexapharma.save.v15.checkpoint.${slot}`。v14 以前一律拒絕。舊 alpha key 不讀取、不 migration、不自動覆寫；沒有 legacy reader 分支。
- corrupt blob 不得被 default game 冒充；讀取不寫 storage，Recover 前保留 raw data，寫入失敗原 blob 不變。
- Load不同saved state與Rewind丟棄最新checkpoint都先取得可取消確認；Cancel不得改GameState、slot history或Library。

## Geometry 與 visual semantics

- Atlas 與 Factory 都使用 pointy-top axial true hex。離散位置固定為整數 `{q,r}`；方向 0–5 固定為 E／SE／SW／W／NW／NE；鄰接、routing、hit-test 與 render 都必須使用同一六方向 contract。
- dense EffectMap／FactoryLayout arrays 固定以 `r * width + q` 索引；pixel `{x,y}` 只屬 projection/camera，不能進入 sim、Save 或 Blueprint authority。
- Factory footprint／ports 的 `footRot` 只允許 0–5 個順時針 60° turns，並以 `(side + footRot) % 6` 旋轉 port；不得把 chemical `PathStamp` 一起旋轉。
- Atlas PathStamp geometry 與 FactoryLayout geometry 仍使用獨立 payload／validator；共用 axial orientation 不代表能互相載入或 alias authority。
- world renderer 必須是嚴格俯視 2D vector 地圖；不得依賴 generated bitmap、runtime manifest或3D透視。
- 紙底與墨印構成世界；路線紫只表達玩家自己的線（研究實際路線／規劃虛線／選取／Plan overprint），藍＝flow、綠＝cure、琥珀＝side effect、紅＝failure，且各自另有形狀差異。裝飾不得挪用語意色造成假狀態；手繪抖動必須確定性，且不得作用於 port、belt 接點、hit-test 幾何或文字。
