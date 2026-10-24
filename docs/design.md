# Project HexaPharma — 專案計劃書

> Canonical active design。程式碼與當前 commit 的 `npm run check` 才是完成證據；本文件不沿用舊 build 的驗證數字。

## 摘要

HexaPharma 是單人 2D 工廠解謎遊戲。玩家在遠大於 viewport 的程序化 **Research Atlas** 上用 catalog 定義的完整奇形 Machine `PathStamp` 規劃整條路線（只用已知地圖預估，霧當平地），按 **Run** 才付一次費從起點跑完整試驗，只揭露實際走過的路徑；也可在免費的 **Production Plan** 設計工廠，最後 **Commission** 到 **Production**，承擔持續生產、庫存、廢料與經濟結果。正常新局在同一張 Atlas 上生成 4 種獨立疾病，讓探索、路線設計、產品品質、出貨合約與有限需求形成反覆循環，而不是一條藍圖永久通殺。

三個場域彼此解耦：Research 只提供地圖知識（不產生配方），Production Plan 提供免費設計空間，Production 提供有成本與時間的正式工廠。任一場域都不是另一場域的強制前置。內部 `pilot` state／intent 名稱可暫時保留，但不是玩家文案。

# 1. 遊戲設計

## 1.1 核心循環

```text
Research Atlas：在已知地圖上規劃整條路線 → Run 付一次費從起點試驗 → 揭露實際路徑 → 依新地圖修改路線
Production Plan：免費配置 FactoryLayout、觀察即時診斷、保存藍圖（可選）
Production：直接建造，或把 Plan Commission 到正式產線 → 連續生產 → Market
Market／Technology：Technology 目前是免費開關（測試期，D42）→ 機器、Split／Merge、探索輔助與場地
```

- **Research** 擁有單一 Atlas、探索遮罩與最近一次試驗 `lastTrial {program, cost, outcome}`；規劃中的路線是 UI 本地狀態，不是 authority；不持有工廠 layout，也不產生配方。
- **Production Plan** 擁有可為空的 sandbox `FactoryLayout`；沒有 clock、建造費、inventory 或 waste。
- **Production** 新局即擁有空白 24×12 `FactoryLayout` 與 runtime；玩家可直接編輯。
- Blueprint Library 在 GameState／save slot 之外。目前 UI 只建立／套用 FactoryLayout；codec可保存與驗證現行ordered `research-program`文件，但card只可import／download／delete，不能提交試驗、揭霧或產生outcome。
- 正常新局以 $1000 開始；不用 query override、隱藏 reference、預製 Blueprint 就必須付得起一次有效 Research、對應建廠與第一件產品出售。

## 1.2 單層 Atlas、霧與地形

Active Research 只有一張單層 Atlas；不提供 layer tabs、跨層座標、跨層傳送或交換層工具。

Atlas 採 pointy-top axial true hex。離散位置是整數 `{q,r}`；六鄰接方向固定按 E／SE／SW／W／NW／NE 編號 0–5，dense map fields 一律以 `r * width + q` 索引。screen pixels 只存在 camera／renderer projection，不能回流成第二套 sim 座標 authority。

Atlas 是半徑 R 的六角形（R = ⌊(min(width,height)−1)/2⌋；正常新局 49×49 dense arrays、R=24、1801 可玩格），六角形外與最外一圈是 Wall（薄邊山）。地形詞彙：山＝`Wall`、水＝`Swamp`、失敗（黑格）＝`Abyss`；v2 generator 不產生 Portal（sim 支援保留）。

地圖資訊分成兩個探索層：

- **霧下只有等高線**：未揭露格（山也一樣）一律印成未印紙；唯一可見的是由生成地勢 `EffectMap.elevation` 畫出的等高線——壓縮的**絕對**起伏加低幅 seeded decoys、單一墨色——所以山與水在霧下都只是一圈線，玩家只知道那裡「有東西」。起點 radius-2 disk 開局即揭露。
- **其他互動物藏在霧下**：Wall、Abyss、Swamp、Portal、治療區與副作用區在揭露前都當作普通基底繪製，也不能由 hover、ghost、藍圖載入、preview 或 outcome 文案洩漏。揭露後山印成淡褐填色、水是藍色水平線、黑格是黑墨。
- pure planning map 把 Atlas 內所有未揭露格（包括山）都當作空地，只保留 Atlas 外框；已揭露的互動物才進入固定路徑預覽。預估可能穿過霧下的山或水，實際 Run 時才會撞牆或變慢。Portal 必須入口與出口都揭露後才公開配對、方向與 preview jump；單獨揭露一端只顯示未配對 portal，不洩漏另一端。真正出藥仍依完整權威地圖執行，因此未知危險保留試錯成本。
- 只有明示出藥後，實際走過的 path segment 才更新探索遮罩。傳送跳躍不揭露兩點之間不存在的直線。

互動語意：

- **Wall／OOB**：取消該 delta，繼續處理該機器剩餘 path。
- **Abyss**：藥物進入後 sticky fail，停止該次執行。
- **Swamp（半格）**：位置是權威格 `pos` 加每張圖的兩倍單位殘差 `offset`，點 P = 2·pos + offset（axial 整數）。目前格是 Swamp 時每個 delta 只走半格（P += dir），否則走整格（P += 2·dir）。目標格 = 以整數比較 P/2 與目前格及六鄰格中心的最近者；平手（邊中點）先取目前格，再依 E／SE／SW／W／NW／NE。目標為 Wall／OOB 時取消該 delta（P 不變）；離開到非 Swamp 格時 P 對齊該格中心；Abyss 失敗並停止；Portal 只在格中心進入。`offset` 只在 Swamp 內非零且最多一個單位方向。停在半格時算作該 Swamp 格；Swamp 沒有效果欄位，評估不受影響。
- **朝向（heading）**：每劑藥有一個所有圖共用的 heading（0–5，同方向編號），關卡起點為 E。machine path 的第 d 項在世界中的方向是 `(d + heading) mod 6`。每台 catalog machine 有固定 `turn`（帶號 60° 步、順時針為正），stamp 完成且藥未失敗時 `heading = (heading + turn) mod 6`。值集中在 `DEFAULT_CATALOG`（見下方機器組）。沒有純轉向機器，也沒有一兩步的「只轉向」機器。
- **機器組（v2 Step 4，與地圖無關）**：相對方向 F＝heading、R＝+1、BR＝+2、B＝+3、BL＝+4、L＝+5。

  | 期 | id | 名稱 | path | 淨位移 | turn | cost | speed | 解鎖 |
  |---|---|---|---|---|---|---|---|---|
  | 前 | `hook` | Hook pump | F F R | 3 | +1 | 3 | 3 | 開局 |
  | 前 | `elbow` | Elbow press | L L F | 3 | −1 | 3 | 3 | 開局 |
  | 前 | `return` | Return coil | B B BL | 3 | +3 | 2 | 3 | 開局 |
  | 前 | `wave` | Wave reactor | F L F R F R F | 6 | 0 | 7 | 7 | 開局 |
  | 中 | `zigzag` | Zigzag still | R F R F | 4 | +2 | 6 | 4 | `zigzag-unlock` |
  | 中 | `loop` | Loop vat | F R BR B BL L F | 1（印出 6 格環） | 0 | 5 | 7 | `loop-unlock` |
  | 後 | `straight` | Straight drive | F F F F | 4 | 0 | 12 | 4 | `straight-unlock` |
  | 後 | `crane` | Crane arm | F F F L L | 5 | −2 | 11 | 5 | `crane-unlock` |

  前期便宜但彆扭（每台都轉向或扭動；Wave 是唯一不轉的前期機器，但貴且長）；中期較靈活（Zigzag 強 +2 修正，Loop 精準一格但印環、容易碰副作用）；後期方便但貴（Straight 乾淨穿過 1 格窄段與沼澤，Crane 長距離加上和 Zigzag 對稱的 −2）。`machine-catalog.test.ts` 以與地圖無關的淨位移、path 長、turn、每格成本與解鎖期檢查：平均成本逐期不降、後期每步與每台位移最好、同期沒有機器同時在「位移／成本」與「轉向角較小」兩項都嚴格勝過另一台、path 長度都 > 2。前四台是 initial catalog。
- **Portal A→B**：從入口立即到同圖的配對出口，剩餘 path 從 B 繼續。B 不可反向當入口；trail 必須在跳躍處斷開。

Atlas 起點位於 generator 宣告的世界中心附近；新局只揭露以起點為中心、hex distance radius 2 的 19-cell disk。camera 開局聚焦起點，地圖只顯示 viewport 覆蓋的一小部分。一般 pan／zoom 不改 authority；Center（`F`）在有規劃路線時移到規劃終點，否則移到最近試驗的實際終點。每次試驗在單一intent中resolve，UI不呈現timed Dose phase或自動camera follow（唯一例外：剛resolve出Cure的試驗把camera fit到實際路線，可被輸入中斷）；resolved outcome可保留，但建築重新啟用不能因stale outcome強制聚焦。HUD不顯示揭露格數或Cure計數。

每次 assay 的 mission readout 只提供目標相對起點的寬廣sector：local，或east／south-east／south-west／west／north-west／north-east。它不公開目標座標、距離、reference path、region大小或霧下內容；sector是方向線索，不是導航答案。

Cure 與 SideEffect 是同一格上的獨立效果欄位，不是互斥 cell kind。已揭露Cure使用綠色十字標記；constructed reference 精確命中的 cure endpoint 必須乾淨；同一治療區的部分其他格可同時帶有副作用，讓玩家在「碰到療效」與「命中乾淨位置」之間繼續最佳化。

每個 Cure 格另有 tier（`EffectMap.cureTier`：1，或 2＝★）。難區的 2–3 格 ★ 核心是 tier 2；`Outcome.premium` 列出終點落在 ★ 的疾病（⊆ `cured`），Market 對該疾病的這件產品付 `gross + floor(gross / 2)`（gross 是該區價格的 demand 價）。後期合約指定 ★ 留給之後的步驟。

## 1.3 Run-based Research 試驗與完整 PathStamp

Research 不使用 FactoryLayout、source／belt／sink、線性 route descriptor 或 DOM recipe timeline。

- 每種 Research machine 由 catalog 定義一條**完整**、可凹折、回繞或不規則的 `PathStamp`（相對 heading）與固定 `turn`；每一步都是 canonical 六方向之一，不保存 pixel delta。
- **規劃**：玩家在 UI 本地編排整條路線（hotbar／數字鍵接到末端；Backspace、Ctrl+Z 或點最後一個控制點回退；Clear 清空）。預覽（虛線）以 pure traversal 在 fog-masked planning map 上走完整條路線：未知格當平地，只保留 Wall 輪廓；不洩漏霧下內容。規劃不花錢、不改 authority。
- **試驗**：`runResearchTrial { program }` 接受 1..`MAX_TEMPLATE_STEPS` 台目前 catalog／patents 允許且 path／turn 與 catalog 一致的 machine；`cost = Σ catalog cost`（safe-integer 檢查），cash < cost 時原子拒絕。authority 一次扣款，從關卡起點在**真實**地圖上跑完整條 program，以 radius 1（加 Technology 的 revealAid）揭露實際 trail 與終點，存 `research.lastTrial = {program, cost, outcome}`，可由 replay 重畫實際路線。失敗於 Abyss 時路線在該格中止。
- 試驗不產生配方、不建立 formula、不自動建造；同一路線可重跑（每次都付費）。UI 保留規劃，讓玩家依新揭露的地圖修改。
- 實際路線（實線）由 `lastTrial.program` 在真實地圖重播。Run 當下的預估保留為淡虛線，直到玩家改動規劃；第一個偏離點以紅圈標在地圖上並標出原因（Wall／Swamp／Abyss，取該處真實地形，該處必在本次揭露範圍內）。兩者都以 pure traversal 計算，renderer 不自行近似、auto-route、修路或呼叫 solver。Swamp 半格以半格點繪製。
- 結果同時顯示 cure 與已揭露的 side effects；不能只報 Cure 而隱藏同一終點的已知污染。Objective 在當前疾病任一 Cure 格已揭露前為「Find Disease N · look <sector>」，之後為「Plan a line to Disease N」（指向 Plan）。

## 1.4 程序地圖

- mapgen 只由 canonical seed 與完整 generation options 決定；禁止 `Math.random()`、wall-clock 與有副作用的容器 iteration 假設。同 seed + 完整 options 必須逐欄位重現 terrain、疾病、reference、cure／side-effect overlays、difficulty 與 price。
- **骨架（依 seed）**：整數 elevation 場（Int16，1024＝1.0，存在 `EffectMap.elevation`）＝內環山（≈0.375R，厚 2–3 格）、2–3 條外圈部分弧（≈0.77R）、至多一條徑向支脈、1–3 個環形盆地（環狀山緣＋下沉底）、2–4 個湖、1–2 個內區小丘／池，再加 domain-warped fBm／ridged gradient noise。全部只用整數雜湊、多項式 fade／kernel、整數平方根與常數角度表；`src/sim/mapgen` 禁用 `Math.sin/cos/exp/sqrt/pow/random`。≥ mountain level → Wall、≤ water level → Swamp。
- **隘口**：內環 2–3 條、每條外弧 1 條、每個盆地恰 1 條（S 形入口）；以帶雜訊成本的最短路徑經過側向轉折點挖出，兩端 2–3 格寬、中段約 40–60% 長的 1 格窄道。隘口格強制可走，elevation 壓到鞍部讓等高線出現缺口。每條隘口在生成時以 bounded local BFS 驗證：狀態（cell、半格 offset、heading），用 initial catalog 與真實 drug-graph traversal，只能走走廊加兩端 2 格 pocket，≤10 步；失敗就依序換角度／salt 重挖（有上限、確定性）。這只是生成期檢查，不 import solver、不給玩家。
- **清理**：不連到起點的可走格改成山；單格湖移除。全圖可走格（含黑格放置後）永遠連通。
- **references**：在 single-Atlas skeleton 上以 BFS 樹（cell、offset、heading；疾病的 catalog tier，後續 tier 以新機器作最後一步）取得每個狀態的最短 program，依 seeded 目標 difficulty（寬 band 時 ≥ 8）、半徑、方向與「不貼牆」評分；Disease 0 的終點在內環內，其他疾病在內環外（需要穿過隘口）。找不到時退回 sampled construction；若某疾病仍無法構造，從衍生 stream 重畫地形（≤4 次，確定性）。reference 必須實際受到 terrain traversal 影響，而不是等同空白地圖的路線；不保護安全走廊。
- **效果區**：每疾病至少一個 easy 區（reference 終點所在的 3–5 格、全 tier 1）與一個 hard 區（先放盆地底，其餘放在離起點步行最遠、內環外的開闊處；9–12 格，含 2–3 格 ★）。hard 區與 void-fill 區和其他疾病的效果保持 1 格間隔，任何區都不重疊。**void filling**：只要還有平地（起點 disk 外）離所有特徵（效果、Wall、Swamp、Abyss、隘口）≥4 格，就在最遠處長一個 3–5 格 tier-1 區。副作用：easy 區非終點格約一半、hard 區外緣約 1/3（不含 ★）、fill 區一格；reference 終點永遠乾淨。
- **黑格（Abyss）**：每個 ★ 核心周圍 3–4 格、每條窄道出口後方側一格陷阱（直衝會掉、小心可避）、8–12 個平地偷坑單格、2–3 條約 5 格的黑帶（不同方位）。不放在隘口走廊、效果、起點 radius 3 內或任何 reference 實際經過的格；每次放置都必須保持全圖連通，否則拒絕。放完後若某隘口的 BFS 驗證失敗，清掉其兩端 pocket 內的黑格。
- 一張 Atlas 支援 1–8 種疾病，正常新局為 4 種。各疾病的 reference signature、endpoint、cure region、difficulty 與 price 必須有 seed／疾病差異，且 cure regions 不重疊。
- default 4-disease progression 採 catalog tier（`DISEASE_CATALOG_TIERS` = 4／5／6／8 台）：第一種只用 initial machines，第二種加 `zigzag`、第三種加 `loop`、第四種起加 `straight` 與 `crane`；後續 tier 以最新機器作最後一步。第一個可解目標不得要求尚未解鎖的進階機器。
- 每個 cure region 都在起始 radius-two hex disk 之外，以乾淨 constructed endpoint 為權威 reference 命中點；區域維持連通但不是固定模板，其餘格中有一部分是 Cure + SideEffect overlay，保留更短但污染或更精準乾淨的多解空間。
- generator 輸出 reference ResearchProgram 只供 property/balance tests 驗證 solvability、bounds、seed diversity 與同 seed相等；runtime UI 不讀取或提示 reference。`generateWithDiagnostics` 另回傳隘口、盆地、效果區與黑格清單，只給 tests/tools。
- solver 只供 tests/tools 做 soundness、整個 cure region 的 minimum steps／cost、reference quality 檢查，不進遊戲內自動解，也不作 production rejection loop。generator 自己的 bounded 隘口 BFS 與 reference BFS 樹是生成期構造，不是 solver，結果也不進 runtime／UI。dev balance 另記錄每個 ★ 在 12 台機器內是否可達。

骨架比例、雜訊幅度、區域大小、黑格數量與獎勵 pacing 是後續平衡項；確定性、連通、隘口可通過與 constructive validity 不是。

## 1.5 Production Plan

- Production Plan 是獨立 F2 world page，使用與 Production 相同的 Factory editor 與幾何規則；內部 `PilotFacilityState`／`setPilotLayout` 名稱暫不改變玩家語意。
- 建造、旋轉、移動、刪除、undo／redo、copy／paste 都免費；沒有時間、耗材、inventory 或 waste。
- source、belt、machine、sink 可以組成任意合法 layout；不要求 Research 結果或特定產品。splitter／merger 需先在 Technology 打開 `Split / Merge`，關閉時 Plan 與 Production 的 layout 驗證都拒絕這兩種 tile。
- Plan 產線的藥效路徑畫在 Research Atlas 上：取第一個 Source 送出的第一個 unit 走到 Sink 經過的機器順序（Splitter 走第一個接得上的 output），在同一張 fog-masked planning map 上以淡紫寬帶呈現；沒有到 Sink 的線不畫。
- 即時 diagnostics 可顯示 throughput、bottleneck、deadlock 或分析錯誤；sample outcome 只能依 Research fog 遮罩後的 planning map 計算，不能用免費 Production Plan 洩漏未發現的 cure、side effect、portal pairing 或權威終點。
- Plan 的 layout 可保存為通用 Factory Blueprint，或按 `Commission $N` 依 Production 當前 layout 的差異付費建造。
- 玩家可以完全跳過 Production Plan，直接在 Production 建造。

## 1.6 Production 與建造經濟

新局立即建立空白 24×12 Production layout 及其 runtime；不顯示封鎖頁，也沒有 Production Plan 前置條件。預設 $1000 bootstrap budget 是 fresh-loop contract：玩家在正常 Research 支出後，仍能以直接建造或 Commission Plan 藍圖支付第一條有效產線，不能靠注入資金才到達第一次出售。

Factory 與 Atlas 使用同一 pointy-top axial orientation 與 E／SE／SW／W／NW／NE direction order，但 layout payload／validator 仍是 Factory domain。Factory cell、anchor、footprint 與 port 使用 `{q,r}`；`footRot` 為 0–5 個順時針 60° turns，tiles 的 dense index 是 `r * width + q`。

每次提交 layout edit 都以 `quoteProductionBuild(current, proposed)` 計算差異：

| 新建內容 | 價格 |
|---|---:|
| Belt | $2 |
| Splitter / Merger | $8 |
| Source | $12 |
| Sink | $6 |
| Machine | `10 × def.cost` |

- 同種類 routing 方向的改變視為重新建造該 tile。
- 機器移動、旋轉 footprint 或換 type 視為新建；只改 machine ID 不收費。
- 拆除免費但不退款。把 layout 改回舊狀態仍依當次新增內容重新計費。
- 報價必須是 non-negative safe integer；現金不足時 layout、runtime、cash 與 waste 原子不變。
- 非Erase tile edit不能覆蓋既有machine；Factory copy/cut/paste必須保存Source period、Splitter/Merger branches等完整tile payload。
- 接受 layout edit 後停止播放，以新 layout重建runtime，清除在途unit與runtime-local counters；**累積 waste 保留**。已進inventory的產品也不因建造消失。no-op、invalid或現金不足的rejection不改history，也不能暫停Production。
- Reset在已有runtime進度時先以可取消確認列出會清除在途unit／tick／runtime counters，以及會保留inventory／waste；initial runtime的Reset不可用。
- 擴廠開關（開或關）是獨立 destructive action；若會清 Production runtime／waste，UI 必須先確認。

Production 是唯一持續推進 factory tick 的場域。source、transport、machine、split／merge、sink 的實際結果決定 inventory、waste、throughput 與 Market 收入；沒有配方正確性前置判斷。每個 unit 在 fixed-capacity typed arrays 中帶 heading 與每張圖的 Swamp offset，machine 依同一 heading-relative stamp＋turn 規則改變藥；進入 Abyss 的 unit 成為廢品。Plan 的 sample 也用同一 pure traversal，但跑在 fog-masked planning map 上。

## 1.7 Connected transport

- renderer 從 sim 的 accept／emit sides 與旋轉後 machine ports 建立唯一 topology。
- 每格依六邊的實際 incident mask 顯示 isolated、endpoint、對向 straight、60°／120° turn或multi-way junction；方向錯誤的相鄰格不能假裝連上。
- belt、splitter、merger、source、sink 與 machine input/output 都使用同一 topology；port 必須顯示 connected／disconnected 狀態。
- transport 線延伸到格邊界，grid 畫在 transport 下方；runtime arrow animation 只由 deterministic tick phase 驅動。
- 拖曳 Belt 形成六鄰接連續的 hex route；每格朝下一格的 E／SE／SW／W／NW／NE 方向，末格沿最後切線。一個 gesture 只產生一筆 editor history。

## 1.8 Market 與 Technology

- Market demand board是公開的外部需求資訊，可列出本局所有疾病及Base／Sold／Next；它不代表Atlas上的Cure已發現，也不得提供Cure座標、region或hidden reference。
- Market 只販售 Production 產生且仍在 inventory 的實體 cure；一顆產品只能賣一次。
- **依到達難度的分區定價**：每個 cure region（easy／hard／fill）有自己的 id（`EffectMap.regionId`，Cure 格 ≥ 1、其他格 0）與價格（`DiseaseSpec.regions`）。生成最後，對每個疾病的 catalog tier 從起點做 bounded 最低成本搜尋（狀態＝格、沼澤半格 offset、heading；邊權＝machine cost；成本上限 `REGION_REACH_COST_BOUND`＝160；真實 traversal，不 import solver），取落在該區任一格的最便宜路線：
  `difficulty = min(120, reachCost + 6 × 穿過的窄段數 + 2 × 路線旁的 Abyss 格數)`，`price = 60 + 2 × difficulty`（`REGION_*` 常數、BigInt safe-integer 檢查）。搜尋上限內到不了的區記為 `capped`，difficulty＝120。同一疾病的 hard 區最高價必須高於 easy 區最高價；不成立時視同無法構造，從衍生 stream 重畫地形（≤4 次，最後一次保留結果）。`DiseaseSpec.basePrice` 是該疾病最便宜的區價，只作公開參考價。不同疾病各有獨立 demand/sold counter。
- 產品的 demand 價＝`nextUnitPrice(終點所在區的價格, 已售件數)`（`Outcome.regions` 與 `cured` 一一對應）。終點在該疾病 ★（tier 2）Cure 的產品，gross 是 `demand + floor(demand / 2)`；仍只消耗一件 demand。Market 的 Stock 列出 ★ 件數，Next unit 在最佳庫存是 ★ 時顯示加成後的價格與「★ price」。
- 某疾病第 0 件的 gross 是該件所在區的價格；每次出售後下一件是 `floor(previous × 19 / 20)`，持續衰減到 0，沒有永久正值底價。net 再扣實際 production cost 與每個 side effect 的 $25 penalty。
- Market 對同一疾病先排 side effect 較少、再排 production cost 較低、最後排 inventory ID 較早的產品。`Ship best` 掃描此順序並賣第一件正 net產品；`Ship profitable` 依同一順序掃描全部庫存、略過不賺錢的候選，只讓實際選中的產品消耗後續demand，不得因較前面的昂貴產品而封鎖後面的正net產品，也不得自動虧本出售。
- Market card必須把最佳庫存的Next gross、production cost、每effect $25 penalty與net直接列出；Clean／Tainted是庫存件數。Ship disabled時顯示「沒有治療庫存」或「沒有正net庫存」的原因；只有authority接受出售後才顯示`Shipped`成功回饋。
- 每種疾病另有 shipping contract，quota 固定為 3 件；HUD 顯示首個未完成疾病的 `sold / 3`，全部完成後顯示最後一份 completed contract。合約只由 accepted sales 推進，不另行消耗庫存。
- 測試期（D42）Technology 每個節點都是免費、獨立的開關：沒有成本、前置或合約 gate。可隨時開或關；關閉時若 Plan 或 Production 仍用到該機器、Splitter／Merger 或擴出來的格子，sim 拒絕並說明仍在使用。擴廠開或關都在遠端邊緣增減格子並重建 Production runtime、清 waste。正式的解鎖條件與樹狀圖留待之後（plan §7）。
- 白箱 progression 只打開該疾病 reference 實際用到的機器開關（不收費）。五個固定 seed 與更廣代表樣本的合法 reference/compiler 白箱路線必須從 $1000 完成四病，且全程保留至少 $100 作為一次合理 assay 重試或小幅改建預算；這只證明可達性，不代表真人探索有趣。
- Technology 可解鎖 factory machines、場地、Research PathStamps、motifs 或實際路徑的感測半徑；不能以跨層互動作現行進程。
- 會重生 Atlas 或清除 Production authority 的解鎖，必須顯示受影響資料並要求確認。

## 1.9 Blueprint v4

Blueprint 與 save slot 完全分離，Library envelope version 是 4，使用 `hexapharma.blueprint-library.v4`，可跨存檔、下載與上傳。

### `research-program`

- payload 保存 ordered `program.steps[] = {typeId}`。
- path、turn、cost、speed 由 fingerprint-compatible `DEFAULT_CATALOG` 還原（它仍是一條有效的 machine 序列，所以保留）。
- codec 與 Library 接受現行v4文件，以便strict validation、import、download與delete；Library card只顯示內容，不提供capture或`Load in Research`。
- 它不能直接成為試驗：UI／GameIntent不得藉此繞過付費 Run。
- 不保存 FactoryLayout、fog、seed、發現、outcome、economy 或 runtime。

### `factory-layout`

- 通用於 Production Plan 與 Production，保存 dimensions、使用`{q,r}`的非empty routing tiles，以及 machines `{id,typeId,anchor,footRot}`；`footRot`是0–5。
- fixed chemical path、turn、cost、speed、shape 與 ports 由 local catalog／shape content 還原。
- 可由 Production Plan 或 Production capture；套用時可免費開到 Plan，或依當前 Production 差異報價後 Commission。
- 不保存來源場域、ResearchProgram、diagnostics、Production runtime、inventory、waste 或 economy。

### Codec

- document version 是 **4**、ruleset 是 **5**（heading 規則改變了 machine 語意）；root 恰為 `{format,version,checksum,blueprint}`，`format = hexapharma-blueprint`，checksum 是 canonical payload 的 lowercase SHA-256。
- content fingerprint 涵蓋 ordered catalog 的 fixed path／turn／cost／speed 與 key-sorted shapes。
- decoder strict、bounded；unknown／missing／cross-kind fields、bad checksum/version/fingerprint、unknown type、duplicate tile/ID、collision、bounds 或 quota 都顯式拒絕。
- 舊v3 Blueprint document／Library key不猜測升級、不partial import；拒絕時保留原blob與legacy key。
- Library 上限 64 entries；單 document 1,048,576 bytes；整體 4,000,000 bytes。相同 canonical checksum 去重。
- 刪除是cross-save Library的永久操作；先以可取消確認列出entry名稱，確認後才移除，不改三個場域。只有`factory-layout` card提供開到Plan／Commission；`research-program` card只提供download／delete。

## 1.10 UI 與直接操作

- viewport-filling shell 以中央 world 為主；頂部導航、hotbar、按需 inspector 只留下可操作控制與必要狀態。
- 遊戲畫面不放設計註解、形容詞式副標或常駐教學段落。錯誤與危險確認仍必須清楚可見。
- Menu 提供 New Game seed 入口；確認後只建立新的目前 GameState，不刪 save checkpoints 或跨局 Blueprint Library。所有 modal 開啟時必須凍結背景指令與建築快捷鍵。
- touch 單指在 Factory 格內執行目前工具，可畫連續 Belt 或直接搬機；兩指才是 pan。點選既有 machine 後，畫面 Rotate 與鍵盤 `R` 都要旋轉該 footprint。
- F1 Research、F2 Production Plan、F3 Production；M／T／B 是可關閉 drawers。把 Plan 送進正式產線的玩家動詞固定為 `Commission`。
- Research 與 Factory 共用 pick／place／erase／pan／zoom 的肌肉記憶，但維持不同 authority 與 validators。
- Research 的 click target 只有規劃路線最後一個控制點（移除該步），不是任意 canvas click；程式條只投影本地規劃，送出時一次成為 `runResearchTrial`。hotbar 圖示依規劃終點的 heading 旋轉。
- Atlas 與 Factory 都使用 pointy-top axial true hex、`{q,r}` 與 E／SE／SW／W／NW／NE；兩者共用投影慣例，但 geometry payload 與 validator 仍分離。不得重新引入 Cartesian tile authority 或四方向 packing。
- 視覺語言見下方 [Visual language](#visual-language)；世界由 Pixi `Graphics` vector runtime 繪製，不使用 3D 透視、glass blur、glow／gradient，也不依賴 generated bitmap 或 runtime asset manifest。
- 詳細按鍵、建造費與驗證步驟集中在 [player-guide.md](player-guide.md)；畫面只提供短 label、icon、hotkey 與 tooltip。
- 完整視覺與互動規格見 [ui-interaction.md](ui-interaction.md)。

### Visual language

整體是「邊跑邊印出來的定向越野地圖」；產品真相見 `PRODUCT.md`，方向契約見 `.impeccable/surfaces/src-ui-game-tsx.md`。

- **紙與墨**：紙底 `#F6F3EC`、近黑墨 `#1E1F1C`；ISOM 色語——山是淡褐填色（`#CDB79A`，細褐邊）、水是藍色水平線、黑格（Abyss）是黑墨斷崖刻痕、治療區是綠色網點＋十字、副作用是琥珀網點、失敗是紅；Cure＋SideEffect 同格時兩種網點都要看得見。
- **路線紫 `#7B2CBF` 只屬玩家自己的線**：研究路線（起點三角、編號控制點圓、實線＝最近試驗的實際路線、虛線＝規劃路線）、選取與 Plan overprint。Production 以黑墨實印；Plan 以紫色 overprint 區分免費草稿與付費實體。
- **霧與等高線**：未揭露是未印的紙，山也不填色。等高線由 `EffectMap.elevation` 畫出：顯示場 `1 − exp(−k·|e|)`（k＝`CONTOUR_COMPRESSION`）加 seeded 低幅 decoys（`CONTOUR_DECOY_STRENGTH`），5 個 level、單一墨色、沒有計曲線色差；它穿霧可見（刻意的提示），也印在已揭露地面上，從不讀 fog、cell 或效果欄位。格線只畫在已揭露格；六角形外不畫。
- **字**：標題、數字、標籤用自帶 Barlow Condensed 600（`src/ui/fonts/`，OFL），內文系統字；所有數字 tabular。
- **手繪感**：只來自 `src/render/ink.ts` 的確定性抖動，用於斷崖刻痕、陰影線與路線墨線；不得作用於 port、belt 接點、hit-test 幾何或文字，同一狀態必須逐幀一致。
- **動態**：每個場域只有一個 authored moment（研究步驟的墨線描出 ≤250 ms），`prefers-reduced-motion` 時立即完成；Pixi auto-ticker 維持關閉。
- **Shell**：只有一條頂列（場域分頁；Cash、Stock→Market、Market／Technology／Blueprints、Menu）；Objective 是 stage 左上的釘選目標卡（下一步、合約 n / 3、直接動作；Research 時帶羅盤）；Market／Technology／Blueprints 是右側 legend 式抽屜，Guide 從 Menu 開啟（沒有 Formulas）；Plan／Production 沒有角標，Play 旁只有 run-state 圖示（D44）。

## 1.11 Save v14 — 開放、可編輯的 alpha 存檔

- 存檔是 plain JSON、可攜且可由玩家修改；不加密、不簽章、不持有 browser key，也不要求 Cash 的收入 trace 或 checksum。合法資源修改必須能載入。
- full envelope 是 `{version:14, contentBuild, game}`；直接保存完整冷狀態。compact envelope 是 `{version:14, contentBuild, snapshot}`，只有 inventory 將連續相同的產品資料分組、列出各件 ID，以便滿倉 24,500 件仍可放入原有 slot 預算。兩者都不重播歷史。
- GameState 不保存 `origin`、`intentTrace` 或 `replayTicks`。Research `lastTrial`／fog、Plan、Production layout／cold runtime／waste、economy／sold、patents、inventory／nextInventoryId／rng 都必須完整還原；在途 unit、加工進度、分流游標與 counters 不重設。
- replay 只供以明確 initial state + intents 重現行為；同一輸入仍須逐欄位／hash 相同。生產的 tick／work 限制只約束單次 API batch，不累積成遊戲壽命。存檔不接受或執行附帶的 trace。
- decoder 驗 exact fields、整數與 typed-array 可表示範圍、bounded collections、canonical machine content、合法 layout／runtime、heading 0–5、offset 只在 Swamp 內非零、`lastTrial` 重播後 cost／outcome 一致、inventory 結果（含 `Outcome.regions`：每個 cured 一個 1..65535 的 region id，重新 evaluate 必須相同）等可執行狀態不變式；不驗證資源或揭霧的歷史來源。
- `contentBuild` 是 catalog／shapes／patents 加手動 rules revision 的確定性相容性識別，不是存檔驗真。sim／mapgen／經濟邏輯改動須明確提升 rules revision；它不自動掃描所有原始碼。不同版本／content build 顯式拒絕。
- checkpoint 外層仍為 `{version:2, head, history}`；head/history 是 compact snapshot 字串，key 為 `hexapharma.save.v14.checkpoint.${slot}`。history 是最多 20 個獨立快照，按數量／characters（`string.length` 的 UTF-16 code units） 刪去最舊項並回報；不驗證 trace-prefix 或資源來源。同設定同 seed 的編輯狀態可保留在同一 history；不同地圖保存時替換 history。
- Load／Rewind 維持可取消的覆蓋確認；Rewind 成功後截斷後續快照。正常 Load 嚴格驗 envelope；明確 Recover 可另從同版本、可解析且字元／history array 數量有界的部分損壞 envelope，獨立驗證已知欄位的字串快照並取最新有效同地圖 suffix。讀取／復原檢查不寫入 storage，寫入失敗保留原 blob；storage 讀取失敗顯示原始原因且停用 Recovery。舊 alpha namespace 不讀取、不 migration、不自動刪除；新版存檔不可 silent reinterpret。
- 明確容量、數值上限及編輯方式見 [save.md](save.md)；alpha 不承諾跨 build migration，見 [development-policy.md](development-policy.md)。

# 2. 技術架構

## 2.1 資料流與邊界

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only drawing
Pure TS sim core  → authoritative deterministic transitions
```

- `src/sim/**` 禁止 import Pixi／React／DOM。
- mapgen、traversal、factory sim、economy、save/replay 都不使用 wall-clock 或非權威 randomness。
- Production 熱迴圈使用 fixed-capacity SoA／TypedArray 與預配置 buffers；冷路徑可用一般 immutable objects。
- renderer 不持有第二份 terrain、path、transport 或 runtime authority。

## 2.2 關鍵模組

- `drug-graph`：heading-relative fixed PathStamp traversal、machine turn、Swamp 半格、terrain／portal、preview／execution。
- `mapgen`：六角 Atlas 的整數 elevation 骨架（內環／外弧／盆地／湖）、BFS 驗證的隘口、tiered 效果區（★）、void filling、黑格、diverse constructive references。
- `construction`：Production layout 差異報價。
- `factory-geom`／`factory-sim`：footprint、ports、routing、tick、throughput、cold snapshot。
- `game`：三場域、Run-based Research 試驗、shipping contracts、paid Production build、inventory／economy。
- `blueprint`：Blueprint v4 strict codec 與跨存檔 Library。
- `save`：Save v14 開放冷快照與結構驗證；`replay-work`：單次 Production batch 的 work 估算。
- `render`：vector-only minimal flat hex Atlas 與 connected factory topology。
- `ui`：world-first shell、shared Factory editor、drawers/checkpoints。

## 2.3 Ownership 與確定性

- state、intent、program、catalog、layout 與 nested geometry 在進 authority 前 canonical validate、clone、own。
- EffectMap入口驗exact typed-array種類／area、cell與fog值域、ID metadata（`regionId` 恰在 Cure 格非 0），以及safe integer且在bounds內的origin/start；Cure與SideEffect overlay仍可同格共存。
- 同 seed + 完整 options + canonical intent trace 必須逐欄位及 hash 相等。
- 每個 bug 附 seed、tick／path segment、input trace 與第一個違反的不變式。
- 同一時間只有一位 owner 修改某 public interface；見 [module-ownership.md](module-ownership.md)。

# 3. 完成定義

- TDD：先有能失敗的 behavior/property/E2E test，再改實作。
- `npm run check`：typecheck、lint、unit/property/integration、headless Playwright 全部通過。
- `0.0.0.0:53346 --strictPort` 真人 smoke 必須從真正 fresh save 開始，不注入 cash、不讀 mapgen reference、不用 reference compiler 或預製 Blueprint，人工完成 planned-route Research trial → affordable build／Commission → Production → first profitable sale；另覆蓋 optional Production Plan、shipping contracts、patent gates、Blueprint、Save/Load/Rewind 與 responsive reachability。
- 自動 gate 證明 correctness，不宣稱樂趣。真人 fresh-loop 要另外記錄首次理解、嘗試次數、剩餘現金、第一次出售時間、困惑點與主觀是否願意再解下一種疾病。
- `npm run progression` 保存 34 個 unique seeds（0..31、42、100）的四疾病白箱資金 ledger（research、build、gross/net、sold、剩餘正利潤 demand、最低 cash與第一個不可達動作）；它可使用 dev-only reference/compiler，但不得接入遊戲。
- balance calibration 覆蓋上述34 seeds。`9/10` demand pacing 在樣本中多次阻擋後段建造，`47/50`仍有7個阻擋樣本；`19/20`配合Settle $700→$670後，全部都完成4份authority shipping contracts、每病正net且最低cash至少$100。v2 Step 4（8 台機器＋分區定價）後 34 seeds 全部完成、每病正 net，最低 cash $574（seed 9）。這是白箱存在性／容錯預算，不是human-fun證據。
- residue scan 不得把每步付費的 reveal–decide shot、Research 產生 formula、Swamp energy、截短 Research path、blank-click append、遮住 Wall、提前顯示未揭露互動物、protected universal reference、單一預設疾病、永久 demand floor、Production Plan 前置 Production、generated bitmap manifest、Blueprint 舊 schema 或 Save 舊 schema 當現行真相。
- 平衡數值與美術內容量可後續迭代；fresh-loop 可達性、seed／疾病解法差異、有限 demand、效果 overlap、上述 authority、資料邊界、可見性、付費建造與 strict codec 不可用「之後平衡」延後。
