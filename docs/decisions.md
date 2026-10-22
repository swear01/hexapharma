# Decisions（技術決策紀錄）

> 只列現行不可由單一函式自然推導的決策。完成證據仍是當前 commit 的 gate 與真人 smoke。

| # | 決策 | 理由／推翻條件 |
|---|---|---|
| D1 | 純 code-as-truth，不使用 engine scene 或視覺 editor。 | 內容是資料、runtime 生成；只有改成大量手工關卡才重議。 |
| D2 | TypeScript sim/core/tooling，PixiJS v8 dumb renderer，React/DOM 管理 chrome。 | 保持 headless、可 replay，且 world authority 不落入 UI。 |
| D3 | 確定性 sim + invariant + replay。 | 是除錯、save、程序生成與多人協作的地基。 |
| D4 | 模組 public interface 同時只有一位 owner。 | integrator 序列化共享面，避免平行修改漂移。 |
| D5 | Atlas 與 Factory 都採pointy-top axial true hex：`{q,r}`、E／SE／SW／W／NW／NE、dense `r * width + q`；Factory footprint／ports有六個60° rotations，但兩個domain的payload／validator仍分離。 | 共用orientation與手感不能變成共用layout authority。 |
| D6 | Active Research 是單層大型 Atlas；跨層互動暫停。 | 先讓固定路徑、terrain 與探索成本清楚可玩。 |
| D7 | Research machine 永遠使用 catalog 定義的完整奇形 PathStamp。 | 截短會消解形狀組合的主要謎題；需要新形狀時新增顯式 machine content。 |
| D8 | （2026-10-22 起由 D35 取代）只有 Wall 無需探索即可看見並影響 preview；其餘互動物都由霧保護，Portal 兩端都揭露後才公開配對。 | Wall 提供可規劃的空間骨架，未知危險與傳送關係則保留出藥試錯成本。 |
| D9 | terrain 是 wall／abyss／swamp／同層 A→B portal；各有 pure traversal 語意。 | renderer 不能把它們當裝飾皮膚。 |
| D10 | mapgen 使用 terrain-first seeded radial + motif constructive generation。 | 先完成地形再在真實 traversal 上找 diverse references；不得保護跨 seed 通用走廊，同 seed仍逐欄位重現。 |
| D11 | solver 只供 tests/tools 計算整個 Cure region 的 minima 與品質。 | 人類試錯與組合固定形狀是核心樂趣；runtime 不可提示 reference 或自動解。 |
| D12 | 玩家場域名為 Production Plan；它是免費、零時間、可選的 FactoryLayout sandbox，sample outcome 只讀 fog-masked planning map。內部 state／intent 可暫稱 pilot。 | Plan／Commission 建立清楚的玩家心智模型；它不能成為阻擋正式建造的流程頁或免費的隱藏效果探測器。 |
| D13 | Production 新局即有 non-null 24×12 editor；所有 edit 按差異付費。 | 直接操作取代線性網站式流程；成本而非頁面順序形成風險。 |
| D14 | 只有接受的Production layout edit停止播放並重建runtime、保留累積waste；拆除不退款。 | 避免在途authority與新幾何錯配，防止用重建洗廢料，也不讓rejected gesture干擾運作。 |
| D15 | Factory transport 使用 sim-derived connected topology。 | 端點、對向直線、60°／120°轉折、多向junction與machine ports必須反映六邊真實accept／emit edge，而非看相鄰格猜圖。 |
| D16 | Blueprint v4 codec識別`research-program`與通用`factory-layout`；Library envelope／namespace是v4／`hexapharma.blueprint-library.v4`，UI不capture/apply Research，只讓Research card import/download/delete。v2 起 ruleset 為 5（heading 規則改變 machine 語意），path／turn 仍由 catalog 還原。 | Research 試驗不可被藍圖繞過付費；同一工廠layout仍可進Production Plan或Commission到Production，不綁來源頁面。 |
| D17 | Save v12 使用開放、可編輯的 plain cold snapshots；full／compact／slots 不要求收入 trace；獨立 checkpoint/history 外層仍為 v2，key 為 `hexapharma.save.v12.checkpoint.${slot}`。 | alpha 舊版本直接拒絕；只驗結構、資源容量、可執行狀態與同 content build 相容性。 |
| D18 | release candidate 前不維護跨 build save migration。 | 早期設計變更速度優先；同 build correctness 仍必須完整。 |
| D19 | UI 遵循 simple-is-better；詳細教學集中到玩家指南。 | world 保留給空間操作，chrome 只顯示工具、短狀態、錯誤與危險確認。 |
| D20 | 單一大型 Atlas 正常生成 4 種獨立疾病，generator 支援最多 8 種。 | 多疾病與 tiered references 提供可持續探索；跨層仍不進 active design。 |
| D21 | Cure 與 SideEffect 是可重疊欄位；reference endpoint 乾淨、同區部分 Cure cell 污染。 | 找到療效不等於找到最佳產品，精準路徑才有品質取捨。 |
| D22 | （已由 D29 取代）Research 是 stepwise reveal–decide session：一次提交一個完整 candidate stamp，立即逐步扣款、執行、揭露與 evaluate；不預先提交 batch route。 | 每個決定都由剛揭露的地圖與結果驅動，操作與成本因果立即可讀。 |
| D23 | 正常新局 cash 為 $1000，fresh run 必須負擔 Research → build → first sale。 | bootstrap 可達性是結構 contract，不用測試注資掩蓋。 |
| D24 | 每疾病 demand 按 `floor(19/20)` 衰減到 0；Market 先乾淨、再低成本，且只自動出售正 net產品。 | 防止單線永久印錢，也避免 bulk action 默默虧損。 |
| D25 | （已由 D29 取代）成功 Cure 自動建立／覆寫每疾病唯一的 `DiscoveredFormula`，保存實際 program、累積 Research cost 與 outcome。 | 探索成果成為可讀的配方紀錄，但不暗中自動建廠或繞過 Production。 |
| D26 | 每疾病 shipping contract quota 固定為 3；Disease 1／2／3 分別 gate Skew／Dilute／Settle patents。 | Production 出貨回饋下一層 Research 工具，形成跨場域節奏，而非只靠抽象 currency。 |
| D27 | 視覺採定向越野地圖語言（2026-10-20 取代 minimal flat schematic）：紙底墨印、ISOM 色語、路線紫只屬玩家的線，世界由 Pixi vector runtime 繪製。 | 使用者要求現代乾淨線條＋手繪感、更有遊戲感但守住工廠可讀性；地圖探索與「路線疊在地形上」正是本作機制。 |
| D28 | assay 只透露目標的寬廣方向 sector，不提供座標或距離。 | 給玩家起步方向，又不把探索謎題降成導航。 |
| D29 | （2026-10-21 使用者決定）Research＝開圖：玩家在 UI 本地規劃整條路線，預估只用已知地圖（霧當平地；Wall 部分由 D35 更新）；`runResearchTrial` 付一次 Σ catalog cost，從關卡起點在真實地圖跑完整條，只揭露實際路徑，存 `lastTrial {program,cost,outcome}`。Research 不產生配方；移除 shot、`DiscoveredFormula` 與 Formulas 面板。 | 先規劃、後付費試驗讓「霧下偏離」成為解謎核心；配方由玩家在 Plan 自己組。 |
| D30 | 藥帶一個所有圖共用的 heading（起點 E）；machine path 相對 heading，stamp 完成且未失敗後依 catalog 固定 `turn` 轉向。`turn` 同時存在 `MachineCatalogEntry` 與 `Machine`，像 path 一樣對 catalog 驗證；暫定值 push +1、push2 0、pull 3、shear −1、skew +2、dilute 0、settle −2。沒有純轉向機器。 | 機器順序本身改變之後的方向，同一組機器有多種解；drug-graph 保持不依賴 catalog。 |
| D31 | Swamp 半格取代 energy：位置＝格＋兩倍單位 offset；Swamp 內每個 delta 走半格，離開到非 Swamp 格時對齊格中心。 | 沼澤改變步幅而不截斷路徑，與「完整 PathStamp」一致；整數 doubled 座標保持確定性。 |
| D32 | 規格未明處的 v2 Step 1 選擇：（a）目標格平手先取目前格，兩鄰格平手依固定 E／SE／SW／W／NW／NE 順序（不依移動方向）；（b）平手選中的格是 Wall／OOB 時照樣取消該 delta；（c）stamp 失敗時 heading 不轉；（d）試驗揭露每個實際進入的格（含 Swamp 內同格的半步）與終點；（e）空 program 拒絕，同一路線重跑照樣付費；（f）規劃路線是 UI 本地狀態，不存檔，New Game／Load 時清空；（g）Objective 以「目前疾病任一 Cure 格已在 fog 中揭露」切換到 Plan；（h）點最後一個控制點與右鍵都移除最後一步；（i）Blueprint `research-program` 保留（仍是有效 machine 序列），ruleset 升到 5；（j）full save 字元上限由 5M 升到 6M，因滿倉 24,500 件產品的 drug 多了 heading／offset。 | 都選最簡單的確定性選項；平衡與 UI 打磨留給後續步驟。 |
| D33 | （v2 Step 2）地圖生成器重寫為六角 Atlas：整數 elevation 骨架（內環、外弧、盆地、湖、內區小丘）＋BFS 驗證的隘口＋清理；tiered 效果區（easy 3–5 tier 1；hard 9–12 含 2–3 ★）、void filling 與黑格（Abyss）；不生成 Portal。generator 可以在生成期用 bounded local BFS 驗證隘口（initial catalog、真實 traversal、走廊＋兩端 2 格 pocket、≤10 步），也用 BFS 樹構造 reference；兩者都不 import solver，結果不進 runtime／UI。等高線改由 `EffectMap.elevation` 畫，霧下只見等高線。★ 產品售價 `floor(gross × 3 / 2)`。Save 升 v13（`Outcome.premium`），content rules 升 4。 | 使用者核可的 prototype（`tools/map-prototype/`）的結構以 seed 程序化重現；山與水在霧下相同，讓探索保有未知。 |
| D34 | 規格未明處的 v2 Step 2 選擇：（a）R＝⌊(min(w,h)−1)/2⌋，正常新局 49×49；R < 16 的合法小圖是無骨架平板（PR #17 review：骨架在 17–31 寬的小圖排不下，改為平板）（≥9 寬時保留舊的 radius-2 沼澤斷環）；（b）未揭露 Wall 仍留在 planning map（預覽會停在霧下的山前），只是不畫；（c）reference：single-Atlas 上先以 BFS 樹（cell、offset、heading）取最短 program，Disease 0 終點在內環內、其他疾病在內環外，評分偏好 seeded 目標 difficulty（寬 band ≥ 8）與不貼牆；失敗退回 sampled construction（前 32 個 ordinal 評分，之後到 128 取第一個可行），仍不行就以衍生 stream 重畫地形（≤4 次）；（d）easy 區就是 reference 終點的區（3–5 格，大小由 seed 決定）；hard 區先放盆地底，其餘取內環外步行距離最遠且周圍 19 格中 ≥12 格可用的位置；（e）hard／fill 區與其他疾病的效果保持 1 格間隔，easy 區只要求不重疊；reference 區也避開 hard 區的鄰格；（f）不再生成獨立 SideEffect 格；easy 區約一半非終點格、hard 區外緣約 1/3（不含 ★）、fill 區一格帶副作用；（g）★ 周圍黑格從兩步內、最靠近 ★ 的平地挑；陷阱在窄道終點後 2／3／1／4 格側邊；起點 radius 3（單格／黑帶 radius 4）內不放黑格；黑格放完後若隘口 BFS 失敗就清掉其兩端 pocket 內的黑格；（h）Market 排序不變，★ 只改 gross；Stock 顯示 ★ 件數；（i）等高線也印在已揭露地面上；decoy 由 |elevation| 的雜湊決定；內插用 19 格 C1 kernel；`CONTOUR_COMPRESSION`＝1.25、`CONTOUR_DECOY_STRENGTH`＝1；（j）Research 試驗以同一次 traversal 得到揭露與 outcome（`outcomeOf`），replay work＝steps×mapCells＋Σpath×nMaps＋4×mapCells；（k）drug 繪製點 helper（`drugDrawPoint`）由 App 與 renderer 共用。 | 都選最簡單、確定且可測的選項；數值留給平衡步驟。 |
| D35 | （2026-10-22，依使用者「霧中不應知道山在哪、水在哪」）霧下任何地形都不進入規劃：planning map 把 Atlas 內未揭露格（包括山）當空地，只保留 Atlas 外框。取代 D8 與 D34(b) 的 Wall 穿霧規則。 | 避免以預估路線探出霧下的山；預估本來就可能錯，Run 撞牆才揭露，符合「先規劃、一次試驗」。 |
| D36 | （2026-10-22 使用者決定）移除「同一條 reference 不得在多張 seed 地圖通殺」的跨 seed 檢查（mapgen 測試、balance 工具門檻與文件）。 | 使用者要的平衡是「依到達難度定價」與「機器前中後期的取捨」，不是地圖間差異；該門檻只會限制生成器。 |

## Current authority summary

- F1 Research、F2 Production Plan、F3 Production；M／T／B drawers；Plan 以 Commission 送入正式產線。
- Research：中心radius-two 19-cell hex disk起始視野、寬廣 assay sector；本地規劃整條 heading-relative 路線，Run 付一次費在真實地圖試驗並只揭露實際路徑；Swamp 半格；霧下只見由地勢畫出的等高線（山與水同樣是線），所有地表與互動物揭露後才印出；不產生配方。
- Atlas：49×49 六角 Atlas（R＝24）；骨架＋BFS 驗證隘口；正常 4 種獨立疾病，各有 easy 與含 ★ 的 hard 區、void filling、黑格；terrain-first diverse references、clean/contaminated Cure cells、最多 8 種。
- Production Plan：free/no-clock optional sandbox；內部仍可稱 pilot。
- Production：direct paid construction、live runtime、actual inventory/waste/economy。
- Economy：$1000 bootstrap、linear seeded base prices、per-disease demand decay to zero、profitable clean-first shipping、quota-3 contracts與machine patent gates。
- Blueprint：v4 codec（ruleset 5）保留ResearchProgram文件，但UI只create/apply generic FactoryLayout；Library跨存檔。
- Save：v13 plain、開放、可編輯的同 build cold state；checkpoint history/recovery 保持獨立外層 v2。
- Geometry／visual：Atlas 與 Factory 都使用pointy-top axial true hex與六方向／六rotation contract，但payload／validator分離；世界維持俯視2D vector 地圖（定向越野語言），不做3D migration。
