# Project HexaPharma — 專案計劃書

> Canonical active design。程式碼與當前 commit 的 `npm run check` 才是完成證據；本文件不沿用舊 build 的驗證數字。

## 摘要

HexaPharma 是單人 2D 工廠解謎遊戲。玩家在遠大於 viewport 的程序化 **Research Atlas** 上開始 assay，每次選一台 catalog 定義的完整奇形 Machine `PathStamp`，立即付費、執行、揭露，再依新資訊決定下一步；也可在免費的 **Production Plan** 設計工廠，最後 **Commission** 到 **Production**，承擔持續生產、庫存、廢料與經濟結果。正常新局在同一張 Atlas 上生成 4 種獨立疾病，讓探索、配方發現、產品品質、出貨合約與有限需求形成反覆循環，而不是一條藍圖永久通殺。

三個場域彼此解耦：Research 提供地圖知識與已發現配方，Production Plan 提供免費設計空間，Production 提供有成本與時間的正式工廠。任一場域都不是另一場域的強制前置。內部 `pilot` state／intent 名稱可暫時保留，但不是玩家文案。

# 1. 遊戲設計

## 1.1 核心循環

```text
Research Atlas：開始 assay → 選一個完整 PathStamp → 付費執行並揭露 → 依結果再決定 → Cure／Failure
Production Plan：免費配置 FactoryLayout、觀察即時診斷、保存藍圖（可選）
Production：直接建造，或把 Plan Commission 到正式產線 → 連續生產 → Market
Market／Technology：完成出貨合約 → 解鎖機器 patents、探索輔助與場地
```

- **Research** 擁有單一 Atlas、探索遮罩、目前 session 已實際執行的 ordered program、shot 與 `DiscoveredFormula[]`；不持有工廠 layout。
- **Production Plan** 擁有可為空的 sandbox `FactoryLayout`；沒有 clock、建造費、inventory 或 waste。
- **Production** 新局即擁有空白 24×12 `FactoryLayout` 與 runtime；玩家可直接編輯。
- Blueprint Library 在 GameState／save slot 之外。目前 UI 只建立／套用 FactoryLayout；v4 codec可保存與驗證現行ordered `research-program`文件，但card只可import／download／delete，不能提交session、揭霧、產生outcome或建立formula。
- 正常新局以 $1000 開始；不用 query override、隱藏 reference、預製 Blueprint 或注入 Knowledge，就必須付得起一次有效 Research、對應建廠與第一件產品出售。

## 1.2 單層 Atlas、霧與地形

Active Research 只有一張單層 Atlas；不提供 layer tabs、跨層座標、跨層傳送或交換層工具。

Atlas 採 pointy-top axial true hex。離散位置是整數 `{q,r}`；六鄰接方向固定按 E／SE／SW／W／NW／NE 編號 0–5，dense map fields 一律以 `r * width + q` 索引。screen pixels 只存在 camera／renderer projection，不能回流成第二套 sim 座標 authority。

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

Atlas 起點位於 generator 宣告的世界中心附近；新局只揭露以起點為中心、hex distance radius 2 的 19-cell disk。camera 開局聚焦起點，地圖只顯示 viewport 覆蓋的一小部分。一般 pan／zoom 不改 authority；contextual focus固定明示Next並移到淡藍空心candidate endpoint。每個stamp在單一intent中立即resolve，UI不呈現timed Dose phase或自動camera follow；resolved outcome可保留，但建築重新啟用不能因stale outcome強制聚焦。Cure sites HUD只顯示已揭露位置的數量並可輪播已知Cure，不能讓玩家誤以為是已成功治療數，也不能以總數、disabled state、輪播順序或camera洩漏未知Cure。

每次 assay 的 mission readout 只提供目標相對起點的寬廣sector：local，或east／south-east／south-west／west／north-west／north-east。它不公開目標座標、距離、reference path、region大小或霧下內容；sector是方向線索，不是導航答案。

Cure 與 SideEffect 是同一格上的獨立效果欄位，不是互斥 cell kind。已揭露Cure使用綠色十字標記；constructed reference 精確命中的 cure endpoint 必須乾淨；同一治療區的部分其他格可同時帶有副作用，讓玩家在「碰到療效」與「命中乾淨位置」之間繼續最佳化。

## 1.3 Reveal–decide Research session 與完整 PathStamp

Research 不使用 FactoryLayout、source／belt／sink、線性 route descriptor 或 DOM recipe timeline。

- 每種 Research machine 由 catalog 定義一條**完整**、可凹折、回繞或不規則的 `PathStamp`；每一步都是 canonical 六方向之一，不保存 pixel delta。
- 第一次`advanceResearchShot`在同一個原子 intent 內從 Atlas start 建立 step 0／cost 0 的 session、清掉前一輪 program／outcome，再立即執行所選machine；UI不先提交一個空 session。
- 玩家一次只選擇**下一台**可用 machine。candidate ghost 從目前實際 drug state 接續完整 path；點 blank world 只處理 camera，不提交 action。沒有 batch route、可編輯待執行 queue、長度滑桿或部分 path 欄位。
- `advanceResearchShot` 接受一個 canonical 完整 `Machine`，可原子開始或延續session。authority 立即扣除該 machine 的 catalog 費用、執行完整 stamp、揭露實際 trails、evaluate 並把這個已執行 step append 到 session program；下一個決定只能根據更新後的 fog、drug、累積 cost 與 outcome 作出。
- no-cure 讓 session 保持 active，`lastOutcome` 立即可見；Failure 或任一 Cure 結束 session。`abortResearchShot` 清除 active program／shot／outcome，但不退款，也不回滾已執行步驟造成的 fog reveal。
- UI 只預覽由當前 fog-masked knowledge 算出的下一個 stamp。執行與 preview 共用 pure traversal；renderer 不自行近似、auto-route、修路或呼叫 solver。
- session program 是**已實際執行**的 ordered stamps，不是待提交的 batch。每步 cost 在該步提交時原子扣除，累積 cost 只是已付金額的讀數。
- 每個完成 segment 以基礎 radius 1 揭露，Technology 只能增加這個實際 segment 的感測半徑。結果同時顯示 cure 與已揭露的 side effects；不能只報 Cure 而隱藏同一終點的已知污染。
- 成功 Cure 自動建立該疾病的不可變 `DiscoveredFormula {disease, program, researchCost, outcome}`。每種疾病最多一份；再次治癒會以最新完整 session 覆寫並移到 latest。Formulas 面板以疾病選擇器查全部已發現成果，顯示完整 ordered steps／名稱、累積 assay cost 與副作用，但不自動建造或驗證 Production layout。

## 1.4 程序地圖

- mapgen 只由 canonical seed 與完整 generation options 決定；禁止 `Math.random()`、wall-clock 與有副作用的容器 iteration 假設。同 seed + 完整 options 必須逐欄位重現 terrain、疾病、reference、cure／side-effect overlays、difficulty 與 price。
- generator 先建立中心起點、radial progression、motifs 與可通行地形，再在這份**已完成地形**上 constructive 地尋找彼此不同的 reference endpoint；不得先畫固定答案再保護一條不受地形影響的安全走廊。
- wall／abyss／swamp／portal 由 motif rules 放置並通過各自 invariants；portal 必須一對一且同層有向。reference 必須實際受到 terrain traversal 影響，而不是等同空白地圖的路線。
- 一張 Atlas 支援 1–8 種疾病，正常新局為 4 種。各疾病的 reference signature、endpoint、cure region、difficulty 與 price 必須有 seed／疾病差異，且 cure regions 不重疊。
- default 4-disease progression 採 catalog tier：第一種只用 initial machines，後續 reference 依序可使用 `skew`、`dilute`、`settle`；第一個可解目標不得要求尚未解鎖的進階機器。
- 每個 cure region 都在起始 radius-two hex disk 之外，以乾淨 constructed endpoint 為權威 reference 命中點；區域維持連通但不是固定模板，其餘格中有一部分是 Cure + SideEffect overlay，保留更短但污染或更精準乾淨的多解空間。
- generator 輸出 reference ResearchProgram 只供 property/balance tests 驗證 solvability、portal pairing、bounds、seed diversity 與同 seed相等；runtime UI 不讀取或提示 reference。
- solver 只供 tests/tools 做 soundness、整個 cure region 的 minimum steps／cost、reference quality 與跨 seed退化檢查，不進遊戲內自動解，也不作 production rejection loop。

radial band、motif 權重、地形比例、治療區密度與獎勵 pacing 是後續平衡項；確定性與 constructive validity 不是。

## 1.5 Production Plan

- Production Plan 是獨立 F2 world page，使用與 Production 相同的 Factory editor 與幾何規則；內部 `PilotFacilityState`／`setPilotLayout` 名稱暫不改變玩家語意。
- 建造、旋轉、移動、刪除、undo／redo、copy／paste 都免費；沒有時間、耗材、inventory 或 waste。
- source、belt、machine、splitter、merger、sink 可以組成任意合法 layout；不要求 Research 結果或特定產品。
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
- 擴廠 Technology 是獨立 destructive action；若會清 Production runtime／waste，UI 必須先確認。

Production 是唯一持續推進 factory tick 的場域。source、transport、machine、split／merge、sink 的實際結果決定 inventory、waste、throughput 與 Market 收入；沒有配方正確性前置判斷。

## 1.7 Connected transport

- renderer 從 sim 的 accept／emit sides 與旋轉後 machine ports 建立唯一 topology。
- 每格依六邊的實際 incident mask 顯示 isolated、endpoint、對向 straight、60°／120° turn或multi-way junction；方向錯誤的相鄰格不能假裝連上。
- belt、splitter、merger、source、sink 與 machine input/output 都使用同一 topology；port 必須顯示 connected／disconnected 狀態。
- transport 線延伸到格邊界，grid 畫在 transport 下方；runtime arrow animation 只由 deterministic tick phase 驅動。
- 拖曳 Belt 形成六鄰接連續的 hex route；每格朝下一格的 E／SE／SW／W／NW／NE 方向，末格沿最後切線。一個 gesture 只產生一筆 editor history。

## 1.8 Market 與 Technology

- Market demand board是公開的外部需求資訊，可列出本局所有疾病及Base／Sold／Next；它不代表Atlas上的Cure已發現，也不得提供Cure座標、region或hidden reference。
- Market 只販售 Production 產生且仍在 inventory 的實體 cure；一顆產品只能賣一次。
- 每個疾病的 mapgen base price 使用整數線性式 `12 + 4 × difficulty + 2 × referenceCost`；不同疾病各有獨立 demand/sold counter。
- 某疾病第 0 件的 gross 是 base price；每次出售後下一件是 `floor(previous × 19 / 20)`，持續衰減到 0，沒有永久正值底價。net 再扣實際 production cost 與每個 side effect 的 $25 penalty。
- Market 對同一疾病先排 side effect 較少、再排 production cost 較低、最後排 inventory ID 較早的產品。`Ship best` 掃描此順序並賣第一件正 net產品；`Ship profitable` 依同一順序掃描全部庫存、略過不賺錢的候選，只讓實際選中的產品消耗後續demand，不得因較前面的昂貴產品而封鎖後面的正net產品，也不得自動虧本出售。
- 每件成功出售增加1 Knowledge。Market card必須把最佳庫存的Next gross、production cost、每effect $25 penalty與net直接列出；Clean／Tainted是庫存件數。Ship disabled時顯示「沒有治療庫存」或「沒有正net庫存」的原因；只有authority接受出售後才顯示Knowledge成功回饋。
- 每種疾病另有 shipping contract，quota 固定為 3 件；HUD 顯示首個未完成疾病的 `sold / 3`，全部完成後顯示最後一份 completed contract。合約只由 accepted sales 推進，不另行消耗庫存。
- machine patent gates 依疾病順序綁定：Disease 1 contract 完成後才可取得 Skew，Disease 2 才可取得 Dilute，Disease 3 才可取得 Settle；cash、Knowledge 與既有 patent prerequisites 仍同時適用。其他 patents 不受 shipping contract gate 影響。
- 四疾病必要 Technology 的 cash 成本為 Skew $100、Bench expansion $120、Dilute $180、Settle $670。五個固定 seed 與更廣代表樣本的合法 reference/compiler 白箱路線必須從 $1000 完成四病，且全程保留至少 $100 作為一次合理 assay 重試或小幅改建預算；這只證明可達性，不代表真人探索有趣。
- Technology 可解鎖 factory machines、場地、Research PathStamps、motifs 或實際路徑的感測半徑；不能以跨層互動作現行進程。
- 會重生 Atlas 或清除 Production authority 的解鎖，必須顯示受影響資料並要求確認。

## 1.9 Blueprint v4

Blueprint 與 save slot 完全分離，Library envelope version 是 4，使用 `hexapharma.blueprint-library.v4`，可跨存檔、下載與上傳。

### `research-program`

- payload 保存 ordered `program.steps[] = {typeId}`。
- path、cost、speed 由 fingerprint-compatible `DEFAULT_CATALOG` 還原。
- codec 與 Library 接受現行v4文件，以便strict validation、import、download與delete；Library card只顯示內容，不提供capture或`Load in Research`。
- 它不能成為active route：UI／GameIntent不得把它套入session，也不得藉此批次提交stamps。
- 不保存 FactoryLayout、fog、seed、發現、outcome、formula、economy 或 runtime，也不能直接改 `DiscoveredFormula[]`。

### `factory-layout`

- 通用於 Production Plan 與 Production，保存 dimensions、使用`{q,r}`的非empty routing tiles，以及 machines `{id,typeId,anchor,footRot}`；`footRot`是0–5。
- fixed chemical path、cost、speed、shape 與 ports 由 local catalog／shape content 還原。
- 可由 Production Plan 或 Production capture；套用時可免費開到 Plan，或依當前 Production 差異報價後 Commission。
- 不保存來源場域、ResearchProgram、diagnostics、Production runtime、inventory、waste 或 economy。

### Codec

- document version 與 ruleset 均為 **4**；root 恰為 `{format,version,checksum,blueprint}`，`format = hexapharma-blueprint`，checksum 是 canonical payload 的 lowercase SHA-256。
- content fingerprint 涵蓋 ordered catalog 的 fixed path／cost／speed 與 key-sorted shapes。
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
- Research 的 place target 是下一個完整 candidate 的 endpoint，不是任意 canvas click；session readout 只投影已執行 program，不是可重排或批次送出的第二份 route authority。
- Atlas 與 Factory 都使用 pointy-top axial true hex、`{q,r}` 與 E／SE／SW／W／NW／NE；兩者共用投影慣例，但 geometry payload 與 validator 仍分離。不得重新引入 Cartesian tile authority 或四方向 packing。
- 極簡、偏 pixel 的俯視 2D：中性炭灰／冷灰底、近白文字與機身；青藍僅標流動、白／淡藍標選取與 candidate、綠標 cure、紫紅標副作用、紅標失敗。平塗硬邊，無黃光、青色 halo、裝飾圈環或全表面亮邊；Pixi vector runtime 保留 canonical true hex。
- 世界使用 Pixi `Graphics` 的平塗 vector runtime，不使用 3D 透視、glass blur、過量 glow／gradient／rounding，也不依賴 generated lab bitmap 或 runtime asset manifest。
- 詳細按鍵、建造費與驗證步驟集中在 [player-guide.md](player-guide.md)；畫面只提供短 label、icon、hotkey 與 tooltip。
- 完整視覺與互動規格見 [ui-interaction.md](ui-interaction.md)。

## 1.11 Save v11 — 開放、可編輯的 alpha 存檔

- 存檔是 plain JSON、可攜且可由玩家修改；不加密、不簽章、不持有 browser key，也不要求 Cash／Knowledge 的收入 trace 或 checksum。合法資源修改必須能載入。
- full envelope 是 `{version:11, contentBuild, game}`；直接保存完整冷狀態。compact envelope 是 `{version:11, contentBuild, snapshot}`，只有 inventory 將連續相同的產品資料分組、列出各件 ID，以便滿倉 24,500 件仍可放入原有 slot 預算。兩者都不重播歷史。
- GameState 不保存 `origin`、`intentTrace` 或 `replayTicks`。Research／formulas／fog、Plan、Production layout／cold runtime／waste、economy／sold、patents、inventory／nextInventoryId／rng 都必須完整還原；在途 unit、加工進度、分流游標與 counters 不重設。
- replay 只供以明確 initial state + intents 重現行為；同一輸入仍須逐欄位／hash 相同。生產的 tick／work 限制只約束單次 API batch，不累積成遊戲壽命。存檔不接受或執行附帶的 trace。
- decoder 驗 exact fields、整數與 typed-array 可表示範圍、bounded collections、canonical machine content、合法 layout／runtime、Research／formula／inventory 結果等可執行狀態不變式；不驗證資源或揭霧的歷史來源。
- `contentBuild` 是 catalog／shapes／patents 加手動 rules revision 的確定性相容性識別，不是存檔驗真。sim／mapgen／經濟邏輯改動須明確提升 rules revision；它不自動掃描所有原始碼。不同版本／content build 顯式拒絕。
- checkpoint 外層仍為 `{version:2, head, history}`；head/history 是 compact snapshot 字串，key 為 `hexapharma.save.v11.checkpoint.${slot}`。history 是最多 20 個獨立快照，按數量／characters（`string.length` 的 UTF-16 code units） 刪去最舊項並回報；不驗證 trace-prefix 或資源來源。同設定同 seed 的編輯狀態可保留在同一 history；不同地圖保存時替換 history。
- Load／Rewind 維持可取消的覆蓋確認；Rewind 成功後截斷後續快照。讀取／復原檢查不寫入 storage，寫入失敗保留原 blob。舊 alpha namespace 不讀取、不 migration、不自動刪除；新版存檔不可 silent reinterpret。
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

- `drug-graph`：fixed PathStamp traversal、terrain／portal、preview／execution。
- `mapgen`：terrain-first seeded radial + motif Atlas、多疾病／重疊效果區、diverse constructive references。
- `construction`：Production layout 差異報價。
- `factory-geom`／`factory-sim`：footprint、ports、routing、tick、throughput、cold snapshot。
- `game`：三場域、stepwise Research session、formula、shipping contracts、paid Production build、inventory／economy。
- `blueprint`：Blueprint v4 strict codec 與跨存檔 Library。
- `save`：Save v11 開放冷快照與結構驗證；`replay-work`：單次 Production batch 的 work 估算。
- `render`：vector-only minimal flat hex Atlas 與 connected factory topology。
- `ui`：world-first shell、shared Factory editor、drawers/checkpoints。

## 2.3 Ownership 與確定性

- state、intent、program、catalog、layout 與 nested geometry 在進 authority 前 canonical validate、clone、own。
- EffectMap入口驗exact typed-array種類／area、cell與fog值域、ID metadata，以及safe integer且在bounds內的origin/start；Cure與SideEffect overlay仍可同格共存。
- 同 seed + 完整 options + canonical intent trace 必須逐欄位及 hash 相等。
- 每個 bug 附 seed、tick／path segment、input trace 與第一個違反的不變式。
- 同一時間只有一位 owner 修改某 public interface；見 [module-ownership.md](module-ownership.md)。

# 3. 完成定義

- TDD：先有能失敗的 behavior/property/E2E test，再改實作。
- `npm run check`：typecheck、lint、unit/property/integration、headless Playwright 全部通過。
- `0.0.0.0:53346 --strictPort` 真人 smoke 必須從真正 fresh save 開始，不注入 cash／Knowledge、不讀 mapgen reference、不用 reference compiler 或預製 Blueprint，人工完成 stepwise Research → formula → affordable build／Commission → Production → first profitable sale；另覆蓋 optional Production Plan、shipping contracts、patent gates、Blueprint、Save/Load/Rewind 與 responsive reachability。
- 自動 gate 證明 correctness，不宣稱樂趣。真人 fresh-loop 要另外記錄首次理解、嘗試次數、剩餘現金、第一次出售時間、困惑點與主觀是否願意再解下一種疾病。
- `npm run progression` 保存 34 個 unique seeds（0..31、42、100）的四疾病白箱資金 ledger（research、build、unlock、gross/net、sold、剩餘正利潤 demand、最低 cash與第一個不可達動作）；它可使用 dev-only reference/compiler，但不得接入遊戲。
- balance calibration 覆蓋上述34 seeds。`9/10` demand pacing 在樣本中多次阻擋後段建造，`47/50`仍有7個阻擋樣本；`19/20`配合Settle $700→$670後，全部都完成4份authority shipping contracts、每病正net且最低cash至少$100。這是白箱存在性／容錯預算，不是human-fun證據。
- residue scan 不得把 batch route submission、截短 Research path、blank-click append、遮住 Wall、提前顯示未揭露互動物、protected universal reference、單一預設疾病、永久 demand floor、Production Plan 前置 Production、generated bitmap manifest、Blueprint 舊 schema 或 Save 舊 schema 當現行真相。
- 平衡數值與美術內容量可後續迭代；fresh-loop 可達性、seed／疾病解法差異、有限 demand、效果 overlap、上述 authority、資料邊界、可見性、付費建造與 strict codec 不可用「之後平衡」延後。
