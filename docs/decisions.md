# Decisions（技術決策紀錄）

> 只列現行不可由單一函式自然推導的決策。完成證據仍是當前 commit 的 gate 與真人 smoke。

| # | 決策 | 理由／推翻條件 |
|---|---|---|
| D1 | 純 code-as-truth，不使用 engine scene 或視覺 editor。 | 內容是資料、runtime 生成；只有改成大量手工關卡才重議。 |
| D2 | TypeScript sim/core/tooling，PixiJS v8 dumb renderer，React/DOM 管理 chrome。 | 保持 headless、可 replay，且 world authority 不落入 UI。 |
| D3 | 確定性 sim + invariant + replay。 | 是除錯、save、程序生成與多人協作的地基。 |
| D4 | 模組 public interface 同時只有一位 owner。 | integrator 序列化共享面，避免平行修改漂移。 |
| D5 | Atlas 與 Factory 都採正方格與相近肌肉記憶，但 authority、geometry 與 validator 分離。 | 共用手感不能變成共用 layout。 |
| D6 | Active Research 是單層大型 Atlas；跨層互動暫停。 | 先讓固定路徑、terrain 與探索成本清楚可玩。 |
| D7 | Research machine 永遠使用 catalog 定義的完整奇形 PathStamp。 | 截短會消解形狀組合的主要謎題；需要新形狀時新增顯式 machine content。 |
| D8 | 只有 Wall 無需探索即可看見並影響 preview；其餘互動物都由霧保護，Portal 兩端都揭露後才公開配對。 | Wall 提供可規劃的空間骨架，未知危險與傳送關係則保留出藥試錯成本。 |
| D9 | terrain 是 wall／abyss／swamp／同層 A→B portal；各有 pure traversal 語意。 | renderer 不能把它們當裝飾皮膚。 |
| D10 | mapgen 使用 terrain-first seeded radial + motif constructive generation。 | 先完成地形再在真實 traversal 上找 diverse references；不得保護跨 seed 通用走廊，同 seed仍逐欄位重現。 |
| D11 | solver 只供 tests/tools 計算整個 Cure region 的 minima 與品質。 | 人類試錯與組合固定形狀是核心樂趣；runtime 不可提示 reference 或自動解。 |
| D12 | Pilot 是免費、零時間、可選的 FactoryLayout sandbox；sample outcome 只讀 fog-masked planning map。 | 它讓玩家低風險設計，但不能成為阻擋正式建造的流程頁或免費的隱藏效果探測器。 |
| D13 | Production 新局即有 non-null 24×12 editor；所有 edit 按差異付費。 | 直接操作取代線性網站式流程；成本而非頁面順序形成風險。 |
| D14 | 只有接受的Production layout edit停止播放並重建runtime、保留累積waste；拆除不退款。 | 避免在途authority與新幾何錯配，防止用重建洗廢料，也不讓rejected gesture干擾運作。 |
| D15 | Factory transport 使用 sim-derived connected topology。 | 端點、轉角、T／十字與 machine ports 必須反映真實 accept／emit edge，而非看相鄰格猜圖。 |
| D16 | Blueprint v3 分為 `research-program` 與通用 `factory-layout`。 | Research 只需保存 ordered machine type；同一工廠 layout 可進 Pilot 或 Production，不綁來源頁面。 |
| D17 | Save v7 是當前 full／compact／slots authority；舊開發版拒絕。 | Production 由 nullable 改為 non-null且新增 paid build intent，不能 reinterpret 舊 trace。 |
| D18 | release candidate 前不維護跨 build save migration。 | 早期設計變更速度優先；同 build correctness 仍必須完整。 |
| D19 | UI 遵循 simple-is-better；詳細教學集中到玩家指南。 | world 保留給空間操作，chrome 只顯示工具、短狀態、錯誤與危險確認。 |
| D20 | 單一大型 Atlas 正常生成 4 種獨立疾病，generator 支援最多 8 種。 | 多疾病與 tiered references 提供可持續探索；跨層仍不進 active design。 |
| D21 | Cure 與 SideEffect 是可重疊欄位；reference endpoint 乾淨、同區部分 Cure cell 污染。 | 找到療效不等於找到最佳產品，精準路徑才有品質取捨。 |
| D22 | Research 只能點 candidate endpoint commit；route strip 可移除任意完整 step並顯示單步／總費用。 | 空白 canvas 不作大型確認按鈕；操作與成本的因果必須在出藥前可讀。 |
| D23 | 正常新局 cash 為 $1000，fresh run 必須負擔 Research → build → first sale。 | bootstrap 可達性是結構 contract，不用測試注資掩蓋。 |
| D24 | 每疾病 demand 按 `floor(9/10)` 衰減到 0；Market 先乾淨、再低成本，且只自動出售正 net產品。 | 防止單線永久印錢，也避免 bulk action 默默虧損。 |

## Current authority summary

- F1 Research、F2 Pilot Plant、F3 Production；M／T／B drawers。
- Research：中心 5×5 起始視野、ordered complete fixed paths、endpoint commit、可移除 route strip；只有 Wall 始終可見，其餘互動物藏霧下；只有出藥揭露，camera 跟隨 shot。
- Atlas：正常 4 種獨立疾病；terrain-first diverse references、clean/contaminated Cure cells、最多 8 種。
- Pilot：free/no-clock optional sandbox。
- Production：direct paid construction、live runtime、actual inventory/waste/economy。
- Economy：$1000 bootstrap、linear seeded base prices、per-disease demand decay to zero、profitable clean-first shipping。
- Blueprint：v3 ResearchProgram + generic FactoryLayout，跨存檔。
- Save：v7 strict same-build authority；checkpoint lineage/recovery 保持獨立外層版本。
