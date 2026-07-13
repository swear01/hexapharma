# Decisions（技術決策紀錄）

> 記錄不可從程式碼自然推導的關鍵選擇。數值可經玩測調整；authority、確定性與失敗語意不可偷偷改。

| # | 決策 | 理由／推翻條件 |
|---|---|---|
| D1 | 純 code-as-truth，不使用 engine scene/視覺 editor。 | 工廠內容是資料，runtime 生成；只有改成大量手工關卡才重議。 |
| D2 | TypeScript sim/core/tooling。 | CLI、headless、AI 協作與 Web 發布成本最低；規模到百萬實體才考慮移植 core。 |
| D3 | PixiJS v8 做 dumb renderer。 | 保留顯式 loop 與薄層；需要完整 scene/physics engine 才重議。 |
| D4 | React/DOM 疊 canvas 做 UI。 | 管理 UI 密集，但世界仍由 Pixi 呈現；UI 極簡化才可能移除。 |
| D5 | 確定性 tick sim + invariant/replay。 | 是除錯、save、平行開發的地基，不推翻。 |
| D6 | 模組邊界是 agent ownership 邊界。 | public interface 同時只有一位 owner；integrator 序列化共享面。 |
| D7 | 一張效果圖是一種成分；1–4 層，一台機器同時變換各層位置。 | 單層先教探索，後續 Phase Exchange 增加跨圖張力。 |
| D8 | Atlas 與三個 facility floor 都是正方格，100% 約 40px/cell。 | 共用方向、footprints、ports 與肌肉記憶；可調 pixel scale，不可分裂幾何 authority。 |
| D9 | 平面俯視正交；Atlas 使用原創 microscopic biochemical art。 | 不用競品圖像/trade dress；正式美術可替換薄層資產。 |
| D10 | catalog 的 transform/cost/speed 固定；機器以效果距離、footprint 與吞吐形成三軸取捨。 | 不提供任意 speed；數值屬未完成平衡，可在確定性測試下調整。 |
| D11 | translate 關係含 forward/reverse/perpendicular/offset。 | 異質方向防止無腦旋轉抄解；玩測太雜可減種類。 |
| D12 | Constructive procedural generation；seed + 完整 GenOptions 是關卡身分。 | production 不靠 solver rejection loop；求解器只供 tests/tools。 |
| D13 | `63×63` 大 Atlas 以局部 `704×512` viewport 探索；每格 minor、每 5 格 origin-aligned major grid；開局中心 `(0,0)`，無玩家 XY 十字軸、無 auto-follow。 | 地圖必須大於平常視野；Focus 只做明示一次置中。可調 grid contrast，不回退縮小全景。 |
| D14 | solver 絕不進遊戲內自動解。 | 人類試錯是核心樂趣，且 runtime 不需要搜尋。 |
| D15 | Save v5；full wire≤5,000,000 chars，checkpoint 使用 raw-preflight compact authority；single/rewind work/tick/entry budgets 明示。 | 防 replay-work DoS、lineage 混合與靜默 corruption；正式 migration framework才重議格式。 |
| D16 | map patent 代表 deeper level：1→2→3→4、seed+1、重生地圖並清三場域/庫存/fog/sales。 | 現階段一個存檔只保存目前 level；未來若做多關卡世界才重議。 |
| D17 | Production 使用 fixed-capacity SoA runtime、固定 event/scratch buffers、layout+map identity、cold snapshot ownership；只有 `productionTicks` 推進。 | 守熱 tick 零配置、確定性 routing/hash/save；profiling證明需 ECS 才重議實作。 |
| D18 | release candidate 前不維護跨 build save 相容或 legacy generator/migration chain。 | 早期迭代優先；宣告 format freeze 時才建立 migration matrix。 |
| D19 | **歷史／已被 D20 取代**：Lab = 同頁 Atlas + Pilot Bench，之後直送 Factory。 | 實作後仍混淆研究探索與免費打樣，overlay 與雙空間同頁過於生硬；不得作 active truth。 |
| D20 | 三個獨立建築：Research、Pilot Plant、Production。Research 付費 progressive shot 揭霧；Pilot 無時間零成本；Production 才連續 tick。兩段 transfer 都 exact，不 auto-pack。 | 分離探索試錯、免費空間試作與量產經濟，並讓三頁共用同一套直接操作語言。只有整體玩測證明角色分工無效才重議。 |
| D21 | Blueprint Library v1 獨立於 save：Research/Pilot portable layout、strict JSON + SHA-256、可匯入匯出、跨存檔保留。 | 藍圖是玩家知識與分享格式，不應跟單一 run 的 seed/fog/economy 綁定。雲端分享另案設計。 |

## Current authority summary

- Active UI：F1 Research、F2 Pilot Plant、F3 Production；M/T/B drawers。
- Active state：`research`、`pilot`、`production` 巢狀 GameState；Save v5。
- Active transfer：physical layout + derived contract，逐欄位 own/copy；沒有 Recipe-list authority、Pilot Bench overlay 或 Lab→Factory compiler path。
