# Plan

## Current milestone — viable fresh loop and replayable Atlas

這是 structural TDD pass，不是單純調平衡。舊 build 的測試數量、截圖、準備資金存檔與 reference-generated layout 都不能作完成證據；每個最終 commit 重新跑 gate，並另外完成人類 fresh-save loop。

### TDD implementation order

1. **Freeze gameplay contracts and RED tests**
   - 單一大型 Atlas 正常生成 4 種獨立疾病，generator 支援 1–8 種。
   - fresh fog 恰為 start-centered 5×5；只有 Wall 穿霧可見。
   - Cure／SideEffect 是可重疊欄位，Outcome 可同時含 cure 與 side effect。
   - 正常 starting cash 是 $1000；無注資 fresh run 必須可達 first sale。
   - 先寫 seed diversity、terrain relevance、solver region-minima、endpoint commit、finite demand、profitable Market與fresh-start integration tests。

2. **Terrain-first seeded mapgen**
   - 先依 seed 生成 radial/motif terrain、swamp/abyss/portal，再在權威 terrain traversal 上 constructive 地找reference。
   - 移除 protected reference corridor；正常尺寸reference的actual endpoint必須反映terrain，而不是空白圖答案。
   - 每個疾病有不同reference signature、endpoint與不重疊cure region；跨seed不可由單一Blueprint通殺。
   - constructed endpoint是乾淨Cure；同區部分其他Cure cells加SideEffect overlay。
   - default 4 disease references依initial、`skew`、`dilute`、`settle`逐tier可用catalog；第一個目標只需initial machines。
   - 同seed + 完整GenOptions仍逐欄位相等。

3. **Solver and balance truth**
   - solver goal是整個Cure region，不只第一個cell；回報minimum steps與minimum cost。
   - balance sweep驗reference quality、疾病／seed diversity、terrain relevance、clean/contaminated coverage與fresh-loop affordability。
   - solver只留tests/tools；runtime、UI與generator rejection loop禁止依賴solver。

4. **Research direct interaction and feedback**
   - 第一個`advanceResearchShot`原子建立並執行reveal–decide session；selected machine只產生從目前actual drug state接續的完整candidate ghost。
   - 一次commit一個canonical完整stamp；當步立即扣款、執行、揭露與evaluate。blank map click不改program，沒有batch route submission或editable pending queue。
   - no-cure保留session供下一次決定；Failure／Cure結束，Abort不退款也不回滾fog。
   - 成功Cure自動建立或覆寫每疾病唯一的`DiscoveredFormula`；formula ribbon顯示已執行steps、累積cost與side effects。
   - assay mission只提示local／八方向的寬廣sector；不暴露座標、距離或reference。
   - 保持complete fixed PathStamp、no partial path、planning不揭霧、actual segments才揭霧。

5. **Bootstrap, economy and Market**
   - default cash改為$1000，保證人工Research後仍能直接或經optional Production Plan支付第一條有效Production line。
   - base price固定為`12 + 4 × difficulty + 2 × referenceCost`。
   - 每疾病gross由base開始，每售一件next=`floor(previous × 9 / 10)`直到0；移除永久正值floor。
   - Cure與SideEffect overlap完整流入physical inventory與sale penalty。
   - Market stable order是side effects少、production cost低、inventory ID早；`Ship best`／`Ship profitable`只出售正net產品。
   - 每疾病shipping contract quota=3；Disease 1／2／3合約分別gate Skew／Dilute／Settle patents。
   - Production Plan維持free/no-clock/optional、使用Commission玩家文案；Production維持direct/paid，不能重加頁面前置。

6. **Integration, docs and repeated audit**
   - focused unit/property → typecheck/lint → integration/E2E → full `npm run check`。
   - residue scan：batch Research route、partial path、blank-click append、非Wall穿霧、universal corridor、default one disease、互斥effects、$200 start、permanent price floor、Pilot Plant玩家文案、generated bitmap manifest與fixture-only full loop都不得留作active truth。
   - 更新README、design、overview、notes、decisions、invariants、structure、UI contract、player guide、roadmap與playtest。
   - Orbital Wet-Lab Schematic收斂為black-blue／graphite／bone-white／steel基底，語意色只用cyan／amber／lime／magenta／red；vector runtime不再依賴generated lab bitmap manifest。
   - 重建Research／effects／Market screenshots，做至少一輪邏輯、視覺與文件audit；Atlas／Factory保持正方格，不在此milestone遷移hex geometry。

7. **Human fun validation on 53346**
   - 清Save與Blueprint Library；不用`?cash`／`?research`、hidden reference、solver、compiler、預製Blueprint或注入Knowledge。
   - 人工完成stepwise Research → DiscoveredFormula → affordable direct build或Plan Commission → Production → first profitable sale，再嘗試完成quota-3 contract並理解下一疾病。
   - 記錄首次理解、嘗試數、first cure／sale時間、最低cash、layout重做、困惑點與是否願意繼續。
   - automated correctness不能代替這份human evidence；任何無資訊、破產或不可達first sale都是blocker。

## Completion rule

- 自動 correctness：當前 commit 的`npm run check`全通過，balance/fresh-start checks沒有universal solution、region-minima或affordability退化。
- 真人玩法：依[playtest.md](playtest.md)在`0.0.0.0:53346 --strictPort`完成無fixture fresh loop，沒有blocker或未記錄fallback。
- 文件不記錄會迅速過期的test count；提交訊息與執行回報保存該次實際數字。

## Deliberately deferred

- 在上述structural contracts成立後，依真人資料調motif密度、terrain比例、cost/speed、linear price係數、unlock pacing與正式內容量。
- final art/audio polish、帳戶、雲端Blueprint repository。
- release candidate前的跨build save migration。

平衡可逐步調整；fresh-loop可達性、stepwise reveal–decide、auto formula、quota-3 contracts／patent gates、seed／disease解法差異、finite demand、overlap effects、完整PathStamp、Wall-only穿霧、direct paid Production、optional Production Plan、Blueprint v3、Save v9與strict gate不能後置。
