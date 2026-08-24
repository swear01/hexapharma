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
| D8 | 只有 Wall 無需探索即可看見並影響 preview；其餘互動物都由霧保護，Portal 兩端都揭露後才公開配對。 | Wall 提供可規劃的空間骨架，未知危險與傳送關係則保留出藥試錯成本。 |
| D9 | terrain 是 wall／abyss／swamp／同層 A→B portal；各有 pure traversal 語意。 | renderer 不能把它們當裝飾皮膚。 |
| D10 | mapgen 使用 terrain-first seeded radial + motif constructive generation。 | 先完成地形再在真實 traversal 上找 diverse references；不得保護跨 seed 通用走廊，同 seed仍逐欄位重現。 |
| D11 | solver 只供 tests/tools 計算整個 Cure region 的 minima 與品質。 | 人類試錯與組合固定形狀是核心樂趣；runtime 不可提示 reference 或自動解。 |
| D12 | 玩家場域名為 Production Plan；它是免費、零時間、可選的 FactoryLayout sandbox，sample outcome 只讀 fog-masked planning map。內部 state／intent 可暫稱 pilot。 | Plan／Commission 建立清楚的玩家心智模型；它不能成為阻擋正式建造的流程頁或免費的隱藏效果探測器。 |
| D13 | Production 新局即有 non-null 24×12 editor；所有 edit 按差異付費。 | 直接操作取代線性網站式流程；成本而非頁面順序形成風險。 |
| D14 | 只有接受的Production layout edit停止播放並重建runtime、保留累積waste；拆除不退款。 | 避免在途authority與新幾何錯配，防止用重建洗廢料，也不讓rejected gesture干擾運作。 |
| D15 | Factory transport 使用 sim-derived connected topology。 | 端點、對向直線、60°／120°轉折、多向junction與machine ports必須反映六邊真實accept／emit edge，而非看相鄰格猜圖。 |
| D16 | Blueprint v4 codec識別`research-program`與通用`factory-layout`；Library envelope／namespace是v4／`hexapharma.blueprint-library.v4`，UI不capture/apply Research，只讓Research card import/download/delete。 | stepwise Research不可被藍圖批次提交；同一工廠layout仍可進Production Plan或Commission到Production，不綁來源頁面。 |
| D17 | Save v10 是當前 full／compact／slots authority；checkpoint lineage外層仍為v2，內層使用`hexapharma.save.v10.checkpoint.${slot}`；舊開發版拒絕。 | stepwise Research、formula、hex geometry與trace schema不可reinterpret舊存檔。 |
| D18 | release candidate 前不維護跨 build save migration。 | 早期設計變更速度優先；同 build correctness 仍必須完整。 |
| D19 | UI 遵循 simple-is-better；詳細教學集中到玩家指南。 | world 保留給空間操作，chrome 只顯示工具、短狀態、錯誤與危險確認。 |
| D20 | 單一大型 Atlas 正常生成 4 種獨立疾病，generator 支援最多 8 種。 | 多疾病與 tiered references 提供可持續探索；跨層仍不進 active design。 |
| D21 | Cure 與 SideEffect 是可重疊欄位；reference endpoint 乾淨、同區部分 Cure cell 污染。 | 找到療效不等於找到最佳產品，精準路徑才有品質取捨。 |
| D22 | Research 是 stepwise reveal–decide session：一次提交一個完整 candidate stamp，立即逐步扣款、執行、揭露與 evaluate；不預先提交 batch route。 | 每個決定都由剛揭露的地圖與結果驅動，操作與成本因果立即可讀。 |
| D23 | 正常新局 cash 為 $1000，fresh run 必須負擔 Research → build → first sale。 | bootstrap 可達性是結構 contract，不用測試注資掩蓋。 |
| D24 | 每疾病 demand 按 `floor(9/10)` 衰減到 0；Market 先乾淨、再低成本，且只自動出售正 net產品。 | 防止單線永久印錢，也避免 bulk action 默默虧損。 |
| D25 | 成功 Cure 自動建立／覆寫每疾病唯一的 `DiscoveredFormula`，保存實際 program、累積 Research cost 與 outcome。 | 探索成果成為可讀的配方紀錄，但不暗中自動建廠或繞過 Production。 |
| D26 | 每疾病 shipping contract quota 固定為 3；Disease 1／2／3 分別 gate Skew／Dilute／Settle patents。 | Production 出貨回饋下一層 Research 工具，形成跨場域節奏，而非只靠抽象 currency。 |
| D27 | 視覺採嚴格俯視 Orbital Wet-Lab Schematic，世界由 Pixi vector runtime 繪製；語意色限於 flow／selection／cure／side-effect／failure。 | 保留 2D 系統圖可讀性與原創身份，移除 generated bitmap manifest、玻璃 UI 與任意玩具色。 |
| D28 | assay 只透露目標的寬廣方向 sector，不提供座標或距離。 | 給玩家起步方向，又不把探索謎題降成導航。 |

## Current authority summary

- F1 Research、F2 Production Plan、F3 Production；M／T／B drawers；Plan 以 Commission 送入正式產線。
- Research：中心radius-two 19-cell hex disk起始視野、寬廣 assay sector、逐步完整 fixed stamp／即時付費揭露；只有 Wall 始終可見，其餘互動物藏霧下；Cure 自動記錄 formula。
- Atlas：正常 4 種獨立疾病；terrain-first diverse references、clean/contaminated Cure cells、最多 8 種。
- Production Plan：free/no-clock optional sandbox；內部仍可稱 pilot。
- Production：direct paid construction、live runtime、actual inventory/waste/economy。
- Economy：$1000 bootstrap、linear seeded base prices、per-disease demand decay to zero、profitable clean-first shipping、quota-3 contracts與machine patent gates。
- Blueprint：v4 codec保留ResearchProgram文件，但UI只create/apply generic FactoryLayout；Library跨存檔。
- Save：v10 strict same-build authority；checkpoint lineage/recovery保持獨立外層v2。
- Geometry／visual：Atlas 與 Factory 都使用pointy-top axial true hex與六方向／六rotation contract，但payload／validator分離；Orbital Wet-Lab維持俯視2D vector schematic，不做3D migration。
