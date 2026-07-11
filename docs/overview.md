# Overview

## What This Is

HexaPharma（暫定名）是一款融合兩種玩法的 2D 單人本地遊戲：在**程序化隨機生成、迷霧覆蓋的多張效果地圖**上探索、用人類創意解出藥方模板（Potion Craft 的鍊金地圖），再到工廠把藥方鋪成**確定性自動化產線、配平機器吞吐**量產（Big Pharma 的工廠）。美術走平面、極簡、俯視正交（Shapez 風）。

**核心模型一句話**：Big Pharma 的工廠 + Potion Craft 的地圖。把 BP 每種有效成分的 1D 濃度，換成「一張 2D 地圖上的位置」；多張地圖並存、一台機器同時移動所有圖；地圖隨機生成、seed + 生成設定即關卡身分。

**雙重目標**：(1) 把遊戲真正做出來、出貨；(2) 用它當 AI 多 agent 編排的實驗場。兩者同向——出貨一款確定性、可 headless 驗證的遊戲所需的工程紀律，恰好就是讓多 agent 平行、低人工介入協作的前提。

**規模錨點**：Potion Craft 級。中小型、機制驅動。同屏移動物件數百～低千，**非** Factorio 百萬級。效能不是瓶頸，故全程 code-as-truth（純程式碼、無隱藏編輯器狀態）。

完整設計見 [design.md](design.md)。

## Key Concepts / Domain

- **成分 / 基底 / 原料**（同義）= 一張效果地圖（+ 起始位置）。對應 Potion Craft 的「基底」。
- **效果地圖四特徵**：療效節點（治病目標，看最終位置）／副作用區（最終位置落入 → 降級可賣）／牆壁（擋移動，可當精準停點）／危險區（路徑經過即失敗變廢料）。
- **機器 = 對藥物多圖狀態的確定性變換**：translate（帶朝向、逐格掃動）／scale-to-origin（按有理比例往原點拉）／swap-maps（交換兩圖）。有形狀、processing cost、速度。Factory splitter 只收 `inDir` 並以 per-tile cursor round-robin，merger 只收 `inDirs` 且按陳列順序固定優先；mutable `FactoryRuntime` 綁定建立它的 layout + `MultiMap` identity。
- **關鍵性質**：輸送帶繞線不貢獻任何移動，效果只取決於「機器序列 + 各機器朝向」。→ 防無腦旋轉、工廠可重排、研究室專注邏輯路徑。
- **跨圖拉扯**：一機同時動所有圖；在 A 圖達標的同時別讓 B 圖踩進副作用/危險，是核心深度。
- **模板 / 藥方**：研究室產出的配方（機器序列 + 各機器朝向）；目標/療效由這份模板在目前地圖得到的 `Outcome` 推導，不另存一份會漂移的 target。
- **物理成品**：工廠 sink 交付實際 `DrugState` + `Outcome` + 經過機器累加的成本；失敗/無療效不入庫，副作用會扣價，一顆成品只能賣一次。
- **經濟 / 進程**：difficulty價格以BigInt exact rational計算；銷售取得cash/R&D，各疾病sold counter使單品遞減，現行無訂單。inventory ≤24,500、bulk ≤100,000 IDs。專利控制機器/揭霧/擴廠/2→3→4圖；手建entitlement是`9×6 + patent delta`，既存尺寸只有patent可改。public patent helpers拒絕invalid tree/state/cash/research，`activeEffects`的factory/reveal aggregate overflow也checked throw。
- **public core 與 Game/UI bounds**：public mapgen/factory-sim各容許至65,536格；Game map另限每邊32、每圖1,024格，Game factory另限每邊256、總計4,096格。前者保留headless API能力，後者是renderer-safe authority；Lab依實際dimensions縮cell並限制canvas ≤980×980，production preview覆蓋2-map最寬與4-map最大。效果圖`sideEffectId`使用`Int32Array`。
- **整局狀態 / Save v3**：單一state/head ≤4,096 trace/≤100,000 ticks/≤100,000,000 work，inventory ≤24,500。正常100,000-tick reference約31,000,000。full wire ≤5,000,000 chars才round-trip；full/compact load皆從raw origin+trace preflight後replay。
- **持久化 / UI**：rewind共用aggregate 12,000 ticks/8,192 entries/100,000,000；compact另限20/1,250,000 chars。`serializeSlots`/`deserializeSlots`同界，deserialize在任何state replay前驗raw list；legacy先history、必要時head-alone。timeline同origin/normalization-aware，跨run replace。Factory diagnostics另有100,000,000 pre-init work cap。
- **求解器**：僅供 tests/tools 驗證與稽核；production 建構式 mapgen 不 import 它，遊戲更**絕不**提供一鍵自動解。

## External Resources

- 靈感來源：Big Pharma（工廠/吞吐）、Potion Craft（鍊金地圖/基底）、Shapez（正方格極簡美術）。
- 技術棧：PixiJS v8、React、Vite、vitest、fast-check、Playwright、Node LTS 20+。
