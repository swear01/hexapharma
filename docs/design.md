# Project HexaPharma — 專案計劃書

> Canonical active design。程式碼與當前 commit 的 `npm run check` 才是完成證據；本文件不沿用舊 build 的驗證數字。

## 摘要

HexaPharma 是單人 2D 工廠解謎遊戲。玩家在遠大於 viewport 的程序化 **Research Atlas** 上，串接 catalog 定義的完整奇形 Machine `PathStamp`，出藥並探索治療區與副作用區；也可在免費的 **Pilot Plant** 設計工廠；最後在 **Production** 直接付費建造並承擔持續生產、庫存、廢料與經濟結果。正常新局在同一張 Atlas 上生成 4 種獨立疾病，讓探索、產品品質與有限需求形成反覆循環，而不是一條藍圖永久通殺。

三個場域彼此解耦：Research 提供地圖知識，Pilot 提供免費設計空間，Production 提供有成本與時間的正式工廠。任一場域都不是另一場域的強制前置。

# 1. 遊戲設計

## 1.1 核心循環

```text
Research Atlas：選完整奇形路徑 → 串成 ResearchProgram → 付費出藥 → 揭露發現
Pilot Plant：免費配置 FactoryLayout、觀察即時診斷、保存藍圖（可選）
Production：直接建造或套用藍圖 → 付建造費 → 連續生產 → Market
Technology：解鎖機器、探索輔助與場地
```

- **Research** 擁有單一 Atlas、探索遮罩、`ResearchProgram` 與執行狀態；不持有工廠 layout。
- **Pilot Plant** 擁有可為空的 sandbox `FactoryLayout`；沒有 clock、建造費、inventory 或 waste。
- **Production** 新局即擁有空白 24×12 `FactoryLayout` 與 runtime；玩家可直接編輯。
- Blueprint Library 在 GameState／save slot 之外，保存可攜的 ResearchProgram 或 FactoryLayout。
- 正常新局以 $1000 開始；不用 query override、隱藏 reference、預製 Blueprint 或注入 Knowledge，就必須付得起一次有效 Research、對應建廠與第一件產品出售。

## 1.2 單層 Atlas、霧與地形

Active Research 只有一張單層 Atlas；不提供 layer tabs、跨層座標、跨層傳送或交換層工具。

地圖資訊分成兩個探索層：

- **只有牆始終可見**：Wall 的輪廓與阻擋規則不受探索遮罩影響。
- **其他互動物藏在霧下**：Abyss、Swamp、Portal、治療區與副作用區在揭露前都當作普通基底繪製，也不能由 hover、ghost、藍圖載入、preview 或 outcome 文案洩漏。
- pure planning map 只保留未揭露區的 Wall；已揭露的互動物才進入固定路徑預覽。Portal 必須入口與出口都揭露後才公開配對、方向與 preview jump；單獨揭露一端只顯示未配對 portal，不洩漏另一端。真正出藥仍依完整權威地圖執行，因此未知危險保留試錯成本。
- 只有明示出藥後，實際走過的 path segment 才更新探索遮罩。傳送跳躍不揭露兩點之間不存在的直線。

互動語意：

- **Wall／OOB**：取消該 delta，繼續處理該機器剩餘 path。
- **Abyss**：藥物進入後 sticky fail，停止該次執行。
- **Swamp**：該步消耗 2 energy；一般可進入格消耗 1。
- **Portal A→B**：從入口立即到同圖的配對出口，剩餘 path 從 B 繼續。B 不可反向當入口；trail 必須在跳躍處斷開。

Atlas 起點位於 generator 宣告的世界中心附近；新局只揭露以起點為中心的 5×5 方格。camera 開局聚焦起點，地圖只顯示 viewport 覆蓋的一小部分。一般 pan／zoom 不改 authority；規劃時contextual focus明示Next並移到橙色candidate endpoint，只有shot執行中明示Dose並移到實際藥物。resolved outcome可繼續顯示，但一回到規劃就必須讓Next focus指向下一個candidate，不能被舊Dose狀態綁住。出藥期間camera自動跟隨當前藥物，結束後仍可自由移動；建築重新啟用不能因stale outcome再次強制聚焦。Cure sites HUD只顯示已揭露位置的數量並可輪播已知Cure，不能讓玩家誤以為是已成功治療數，也不能以總數、disabled state、輪播順序或camera洩漏未知Cure。

Cure 與 SideEffect 是同一格上的獨立效果欄位，不是互斥 cell kind。已揭露Cure使用明顯receptor與target ring；constructed reference 精確命中的 cure endpoint 必須乾淨；同一治療區的部分其他格可同時帶有副作用，讓玩家在「碰到療效」與「命中乾淨位置」之間繼續最佳化。

## 1.3 ResearchProgram 與完整 PathStamp

Research 不使用 FactoryLayout、source／belt／sink、線性 route descriptor 或 DOM recipe timeline。

- 每種 Research machine 由 catalog 定義一條**完整**、可凹折、回繞或不規則的 `PathStamp`。
- 選擇機器只建立從目前 endpoint 接續的完整 candidate ghost；玩家必須點擊 candidate endpoint 才加入整條 path。點空白地圖只處理 world interaction，不得 append program。沒有長度滑桿、截短按鈕或只走部分 path 的資料欄位。
- `ResearchProgram.steps[]` 只保存 `{typeId, path}` 的 canonical machine authority；下一步從前一步的實際 endpoint 繼續。
- 畫面上的 ordered route strip 依序顯示 step、機器、單步費用與總出藥費；未出藥時可移除任意完整 step，移除後由 authority 重算後續 endpoint。
- 玩家用不同完整形狀安排先後順序，處理牆、深淵、沼澤與傳送門。UI 不 auto-route、不修路、不呼叫 solver。
- 規劃只顯示由當前可知資訊算出的路徑。執行與 preview 共用 pure traversal；renderer 不自行近似或重建另一條路。
- 出藥時原子扣 `max(1, Σ machine cost)`；中止或失敗不退款。每個完成 segment 以基礎 radius 1 揭露，Technology 只能增加這個實際 segment 的感測半徑。結果列同時顯示 cure 與已揭露的 side effects；不能只報 Cure 而隱藏同一終點的已知污染。

## 1.4 程序地圖

- mapgen 只由 canonical seed 與完整 generation options 決定；禁止 `Math.random()`、wall-clock 與有副作用的容器 iteration 假設。同 seed + 完整 options 必須逐欄位重現 terrain、疾病、reference、cure／side-effect overlays、difficulty 與 price。
- generator 先建立中心起點、radial progression、motifs 與可通行地形，再在這份**已完成地形**上 constructive 地尋找彼此不同的 reference endpoint；不得先畫固定答案再保護一條不受地形影響的安全走廊。
- wall／abyss／swamp／portal 由 motif rules 放置並通過各自 invariants；portal 必須一對一且同層有向。reference 必須實際受到 terrain traversal 影響，而不是等同空白地圖的路線。
- 一張 Atlas 支援 1–8 種疾病，正常新局為 4 種。各疾病的 reference signature、endpoint、cure region、difficulty 與 price 必須有 seed／疾病差異，且 cure regions 不重疊。
- default 4-disease progression 採 catalog tier：第一種只用 initial machines，後續 reference 依序可使用 `skew`、`dilute`、`settle`；第一個可解目標不得要求尚未解鎖的進階機器。
- 每個 cure region 都在起始 5×5 之外，以乾淨 constructed endpoint 為權威 reference 命中點；區域維持連通但不是固定圓形／十字模板，其餘格中有一部分是 Cure + SideEffect overlay，保留更短但污染或更精準乾淨的多解空間。
- generator 輸出 reference ResearchProgram 只供 property/balance tests 驗證 solvability、portal pairing、bounds、seed diversity 與同 seed相等；runtime UI 不讀取或提示 reference。
- solver 只供 tests/tools 做 soundness、整個 cure region 的 minimum steps／cost、reference quality 與跨 seed退化檢查，不進遊戲內自動解，也不作 production rejection loop。

radial band、motif 權重、地形比例、治療區密度與獎勵 pacing 是後續平衡項；確定性與 constructive validity 不是。

## 1.5 Pilot Plant

- Pilot 是獨立 F2 world page，使用與 Production 相同的 Factory editor 與幾何規則。
- 建造、旋轉、移動、刪除、undo／redo、copy／paste 都免費；沒有時間、耗材、inventory 或 waste。
- source、belt、machine、splitter、merger、sink 可以組成任意合法 layout；不要求 Research 結果或特定產品。
- 即時 diagnostics 可顯示 throughput、bottleneck、deadlock 或分析錯誤；sample outcome 只能依 Research fog 遮罩後的 planning map 計算，不能用免費 Pilot 洩漏未發現的 cure、side effect、portal pairing 或權威終點。
- Pilot 的 layout 可保存為通用 Factory Blueprint，或按 `Build $N` 依 Production 當前 layout 的差異付費建造。
- 玩家可以完全跳過 Pilot，直接在 Production 建造。

## 1.6 Production 與建造經濟

新局立即建立空白 24×12 Production layout 及其 runtime；不顯示封鎖頁，也沒有 Pilot 前置條件。預設 $1000 bootstrap budget 是 fresh-loop contract：玩家在正常 Research 支出後，仍能以直接建造或 Pilot 藍圖支付第一條有效產線，不能靠注入資金才到達第一次出售。

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
- 擴廠 Technology 是獨立 destructive action；若會清 Production runtime／waste，UI 必須先確認。

Production 是唯一持續推進 factory tick 的場域。source、transport、machine、split／merge、sink 的實際結果決定 inventory、waste、throughput 與 Market 收入；沒有配方正確性前置判斷。

## 1.7 Connected transport

- renderer 從 sim 的 accept／emit sides 與旋轉後 machine ports 建立唯一 topology。
- 每格依實際 incident connections 顯示 isolated、endpoint、straight、corner、tee 或 cross；方向錯誤的相鄰格不能假裝連上。
- belt、splitter、merger、source、sink 與 machine input/output 都使用同一 topology；port 必須顯示 connected／disconnected 狀態。
- transport 線延伸到格邊界，grid 畫在 transport 下方；runtime arrow animation 只由 deterministic tick phase 驅動。
- 拖曳 Belt 從起點到游標形成單一正交轉角；目前方向決定先走水平或垂直段。每格朝下一格、末格沿最後切線，不產生對角階梯。

## 1.8 Market 與 Technology

- Market demand board是公開的外部需求資訊，可列出本局所有疾病及Base／Sold／Next；它不代表Atlas上的Cure已發現，也不得提供Cure座標、region或hidden reference。
- Market 只販售 Production 產生且仍在 inventory 的實體 cure；一顆產品只能賣一次。
- 每個疾病的 mapgen base price 使用整數線性式 `12 + 4 × difficulty + 2 × referenceCost`；不同疾病各有獨立 demand/sold counter。
- 某疾病第 0 件的 gross 是 base price；每次出售後下一件是 `floor(previous × 9 / 10)`，持續衰減到 0，沒有永久正值底價。net 再扣實際 production cost 與每個 side effect 的 $25 penalty。
- Market 對同一疾病先排 side effect 較少、再排 production cost 較低、最後排 inventory ID 較早的產品。`Ship best` 掃描此順序並賣第一件正 net產品；`Ship profitable` 依同一順序掃描全部庫存、略過不賺錢的候選，只讓實際選中的產品消耗後續demand，不得因較前面的昂貴產品而封鎖後面的正net產品，也不得自動虧本出售。
- 每件成功出售增加1 Knowledge。Market card必須把最佳庫存的Next gross、production cost、每effect $25 penalty與net直接列出；Clean／Tainted是庫存件數。Ship disabled時顯示「沒有治療庫存」或「沒有正net庫存」的原因；只有authority接受出售後才顯示Knowledge成功回饋。
- Technology 可解鎖 factory machines、場地、Research PathStamps、motifs 或實際路徑的感測半徑；不能以跨層互動作現行進程。
- 會重生 Atlas 或清除 Production authority 的解鎖，必須顯示受影響資料並要求確認。

## 1.9 Blueprint v3

Blueprint 與 save slot 完全分離，Library 使用 `hexapharma.blueprint-library.v3`，可跨存檔、下載與上傳。

### `research-program`

- payload 保存 ordered `program.steps[] = {typeId}`。
- path、cost、speed 由 fingerprint-compatible `DEFAULT_CATALOG` 還原。
- 不保存 FactoryLayout、fog、seed、發現、outcome、economy 或 runtime。

### `factory-layout`

- 通用於 Pilot 與 Production，保存 dimensions、非 empty routing tiles，以及 machines `{id,typeId,anchor,footRot}`。
- fixed chemical path、cost、speed、shape 與 ports 由 local catalog／shape content 還原。
- 可由 Pilot 或 Production capture；套用時可免費開到 Pilot，或依當前 Production 差異報價後付費建造。
- 不保存來源場域、ResearchProgram、diagnostics、Production runtime、inventory、waste 或 economy。

### Codec

- document version 與 ruleset 均為 **3**；root 恰為 `{format,version,checksum,blueprint}`，`format = hexapharma-blueprint`，checksum 是 canonical payload 的 lowercase SHA-256。
- content fingerprint 涵蓋 ordered catalog 的 fixed path／cost／speed 與 key-sorted shapes。
- decoder strict、bounded；unknown／missing／cross-kind fields、bad checksum/version/fingerprint、unknown type、duplicate tile/ID、collision、bounds 或 quota 都顯式拒絕。
- 舊 Blueprint 文件不猜測升級、不 partial import。
- Library 上限 64 entries；單 document 1,048,576 bytes；整體 4,000,000 bytes。相同 canonical checksum 去重。
- 刪除是cross-save Library的永久操作；先以可取消確認列出entry名稱，確認後才移除，不改三個場域。

## 1.10 UI 與直接操作

- viewport-filling shell 以中央 world 為主；HUD、rail、hotbar、inspector 只留下可操作控制與必要狀態。
- 遊戲畫面不放設計註解、形容詞式副標或常駐教學段落。錯誤與危險確認仍必須清楚可見。
- 正常 HUD 提供 New Game seed 入口；確認後只建立新的目前 GameState，不刪 save checkpoints 或跨局 Blueprint Library。所有 modal 開啟時必須凍結背景指令與建築快捷鍵。
- touch 單指在 Factory 格內執行目前工具，可畫連續 Belt 或直接搬機；兩指才是 pan。點選既有 machine 後，畫面 Rotate 與鍵盤 `R` 都要旋轉該 footprint。
- F1 Research、F2 Pilot Plant、F3 Production；M／T／B 是可關閉 drawers。
- Research 與 Factory 共用 pick／place／erase／pan／zoom 的肌肉記憶，但維持不同 authority 與 validators。
- Research 的 place target 是完整 candidate 的 endpoint，不是任意 canvas click；route strip 是 program 的可讀／可刪投影，不是第二份 route authority。
- 詳細按鍵、建造費與驗證步驟集中在 [player-guide.md](player-guide.md)；畫面只提供短 label、icon、hotkey 與 tooltip。
- 完整視覺與互動規格見 [ui-interaction.md](ui-interaction.md)。

## 1.11 Save v7

- full envelope 是 `{version:7, game}`；Research 保存 program／shot／lastOutcome／fog，Pilot 保存 nullable layout，Production 永遠保存 non-null layout／cold runtime／waste。
- compact authority 是 `{version:7, authority:{origin,intentTrace,replayTicks,stateHash}}`；reader 先作 raw-work preflight，再 semantic replay 並比對 canonical trace 與 hash。
- slots／rewind 同樣使用 v7 authority，逐欄位重建 fixed path、FactoryLayout 與 cold runtime，不共享可變資料。
- Load在saved head與current game不同時先以可取消確認列出會覆蓋目前遊戲；Rewind先確認會永久移除最新saved checkpoint並以較舊state取代current game。Cancel不改storage或GameState。
- `buildProductionLayout` 是 Production edit intent；每次付費建造都保留在 trace，不能合併掉其經濟語意。
- decoder 對 unknown／missing fields、unsafe integers、非法 path／layout／runtime、oversize 與 replay forgery 顯式失敗；舊開發版顯式拒絕。
- checkpointStorage 外層 lineage envelope 仍是獨立 version 2；內層 head/history 是 Save v7，兩者不可混為同一 schema。
- 早期開發不承諾跨 build migration，詳見 [development-policy.md](development-policy.md)。

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

- `drug-graph`：fixed PathStamp traversal、terrain／portal、preview／execution。
- `mapgen`：terrain-first seeded radial + motif Atlas、多疾病／重疊效果區、diverse constructive references。
- `construction`：Production layout 差異報價。
- `factory-geom`／`factory-sim`：footprint、ports、routing、tick、throughput、cold snapshot。
- `game`：三場域、Research shot、paid Production build、inventory／economy。
- `blueprint`：Blueprint v3 strict codec 與跨存檔 Library。
- `save`／`replay-work`：Save v7、raw-work preflight、replay/hash。
- `render`：Atlas layer rendering 與 connected factory topology。
- `ui`：world-first shell、shared Factory editor、drawers/checkpoints。

## 2.3 Ownership 與確定性

- state、trace、program、catalog、layout 與 nested geometry 在進 authority 前 canonical validate、clone、own。
- EffectMap入口驗exact typed-array種類／area、cell與fog值域、ID metadata，以及safe integer且在bounds內的origin/start；Cure與SideEffect overlay仍可同格共存。
- 同 seed + 完整 options + canonical intent trace 必須逐欄位及 hash 相等。
- 每個 bug 附 seed、tick／path segment、input trace 與第一個違反的不變式。
- 同一時間只有一位 owner 修改某 public interface；見 [module-ownership.md](module-ownership.md)。

# 3. 完成定義

- TDD：先有能失敗的 behavior/property/E2E test，再改實作。
- `npm run check`：typecheck、lint、unit/property/integration、headless Playwright 全部通過。
- `0.0.0.0:53346 --strictPort` 真人 smoke 必須從真正 fresh save 開始，不注入 cash／Knowledge、不讀 mapgen reference、不用 reference compiler 或預製 Blueprint，人工完成 Research → affordable build → Production → first profitable sale；另覆蓋 optional Pilot、Blueprint、Save/Load/Rewind 與 responsive reachability。
- 自動 gate 證明 correctness，不宣稱樂趣。真人 fresh-loop 要另外記錄首次理解、嘗試次數、剩餘現金、第一次出售時間、困惑點與主觀是否願意再解下一種疾病。
- residue scan 不得把截短 Research path、blank-click append、遮住 Wall、提前顯示未揭露互動物、protected universal reference、單一預設疾病、永久 demand floor、Pilot 前置 Production、Blueprint 舊 schema 或 Save 舊 schema 當現行真相。
- 平衡數值與美術內容量可後續迭代；fresh-loop 可達性、seed／疾病解法差異、有限 demand、效果 overlap、上述 authority、資料邊界、可見性、付費建造與 strict codec 不可用「之後平衡」延後。
