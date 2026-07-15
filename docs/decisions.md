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
| D8 | 只有 Wall 無需探索即可看見並影響 preview；其餘互動物都由霧保護。 | Wall 提供可規劃的空間骨架，未知危險與傳送關係則保留出藥試錯成本。 |
| D9 | terrain 是 wall／abyss／swamp／同層 A→B portal；各有 pure traversal 語意。 | renderer 不能把它們當裝飾皮膚。 |
| D10 | mapgen 使用 seeded radial + motif constructive generation。 | production 不靠 solver rejection；同 seed 必須逐欄位重現。 |
| D11 | solver 只供 tests/tools。 | 人類試錯與組合固定形狀是核心樂趣。 |
| D12 | Pilot 是免費、零時間、可選的 FactoryLayout sandbox。 | 它讓玩家低風險設計，但不能成為阻擋正式建造的流程頁。 |
| D13 | Production 新局即有 non-null 24×12 editor；所有 edit 按差異付費。 | 直接操作取代線性網站式流程；成本而非頁面順序形成風險。 |
| D14 | Production layout edit 重建 runtime、保留累積 waste；拆除不退款。 | 避免在途 authority 與新幾何錯配，也防止用重建洗掉已承擔的廢料。 |
| D15 | Factory transport 使用 sim-derived connected topology。 | 端點、轉角、T／十字與 machine ports 必須反映真實 accept／emit edge，而非看相鄰格猜圖。 |
| D16 | Blueprint v3 分為 `research-program` 與通用 `factory-layout`。 | Research 只需保存 ordered machine type；同一工廠 layout 可進 Pilot 或 Production，不綁來源頁面。 |
| D17 | Save v7 是當前 full／compact／slots authority；舊開發版拒絕。 | Production 由 nullable 改為 non-null且新增 paid build intent，不能 reinterpret 舊 trace。 |
| D18 | release candidate 前不維護跨 build save migration。 | 早期設計變更速度優先；同 build correctness 仍必須完整。 |
| D19 | UI 遵循 simple-is-better；詳細教學集中到玩家指南。 | world 保留給空間操作，chrome 只顯示工具、短狀態、錯誤與危險確認。 |

## Current authority summary

- F1 Research、F2 Pilot Plant、F3 Production；M／T／B drawers。
- Research：ordered complete fixed paths；只有 Wall 始終可見，其餘互動物藏霧下；只有出藥揭露。
- Pilot：free/no-clock optional sandbox。
- Production：direct paid construction、live runtime、actual inventory/waste/economy。
- Blueprint：v3 ResearchProgram + generic FactoryLayout，跨存檔。
- Save：v7 strict same-build authority；checkpoint lineage/recovery 保持獨立外層版本。
