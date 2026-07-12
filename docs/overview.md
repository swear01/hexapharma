# Overview

## What This Is

HexaPharma（暫定名）是一款融合兩種玩法的 2D 單人本地遊戲：在**程序化隨機生成、迷霧覆蓋的多張效果地圖**上探索、用人類創意解出藥方模板（Potion Craft 的鍊金地圖），再到工廠把藥方鋪成**確定性自動化產線、配平機器吞吐**量產（Big Pharma 的工廠）。美術走平面、極簡、俯視正交（Shapez 風）。

**核心模型一句話**：Big Pharma 的工廠 + Potion Craft 的地圖。把 BP 每種有效成分的 1D 濃度，換成「一張 2D 地圖上的位置」；多張地圖並存、一台機器同時移動所有圖；地圖隨機生成、seed + 生成設定即關卡身分。

**雙重目標**：(1) 把遊戲真正做出來、出貨；(2) 用它當 AI 多 agent 編排的實驗場。兩者同向——出貨一款確定性、可 headless 驗證的遊戲所需的工程紀律，恰好就是讓多 agent 平行、低人工介入協作的前提。

**規模錨點**：Potion Craft 級。中小型、機制驅動。同屏移動物件數百～低千，**非** Factorio 百萬級。效能不是瓶頸，故全程 code-as-truth（純程式碼、無隱藏編輯器狀態）。

完整設計見 [design.md](design.md)。

## Key Concepts / Domain

- **成分 / 基底 / 原料**（同義）= 一張效果地圖（+ 起始位置）。對應 Potion Craft 的「基底」。
- **開場與探索視野**：預設只有 `63×63` Layer A，起點／origin 在正中央 `(31,31)`；visibility radius 3 先揭露 `49/3969` 格。Effect Atlas 是固定 `704×512` 的局部 viewport，100% cell 約 `40px`、可見約 `17×13` 格；每格 minor grid、每 5 格 major grid，格線可穿迷霧但不洩漏 feature。
- **效果地圖四特徵**：5–9格連通療效區（最終位置落入即治療；目前所有區內格等價，沒有 potency 核心）／5%密度連通副作用 biome（最終位置落入 → 降級可賣）／4%密度連通牆鏈（擋移動，可當精準停點）／3%密度連通危險團塊或走廊（路徑經過即失敗變廢料）。
- **機器 = 對藥物多圖狀態的確定性變換**：translate（帶朝向、逐格掃動）／scale-to-origin（按有理比例往原點拉）／Phase Exchange A↔B（交換兩圖座標）。效果距離以 small 3、medium 4–5、large 6–9+ 分級，footprint／ports、processing cost 與速度另形成空間和吞吐取捨。Factory splitter 只收 `inDir` 並以 per-tile cursor round-robin，merger 只收 `inDirs` 且按陳列順序固定優先；mutable `FactoryRuntime` 綁定建立它的 layout + `MultiMap` identity。
- **關鍵性質**：輸送帶繞線不貢獻任何移動，效果只取決於「機器序列 + 各機器朝向」。→ 防無腦旋轉、工廠可重排、研究室專注邏輯路徑。
- **跨圖拉扯**：一機同時動所有圖；在 A 圖達標的同時別讓 B 圖踩進副作用/危險，是核心深度。
- **Lab 空間與 authority**：Lab = Effect Atlas + Pilot Bench。Bench 與 Factory 以約40px地板格共用 footprint、ports、belt、碰撞、旋轉與 buildability；初期只允許唯一、無循環、無 split/merge 的 source→sink 路徑。權威是 exact `ProductionBlueprint`，Recipe／`Template.steps` 由拓撲推導；timeline 只讀 breadcrumb／scrubber／Run playhead。
- **無縫轉移**：保存 Lab 原型時保存 layout 尺寸、tiles、machine anchors、footRot、effect orientation／flip、ports、source/sink 與 routing；Factory 逐欄位接收，不 auto-pack、不重排。進 Factory 後才在保持 effect order contract 下搬移、並聯與重新 routing。
- **物理成品**：工廠 sink 交付實際 `DrugState` + `Outcome` + 經過機器累加的成本；失敗/無療效不入庫，副作用會扣價，一顆成品只能賣一次。
- **經濟 / 進程**：difficulty價格以BigInt exact rational計算；銷售取得cash/R&D，各疾病sold counter使單品遞減，現行無訂單。inventory ≤24,500、bulk ≤100,000 IDs。`new-map`／`new-map-4`／`deep-map-4` 依序解鎖 B／C／D，完成1→2→3→4圖且每層維持`63×63`；手建entitlement是`24×12 + patent delta`，既存尺寸只有patent可改。public patent helpers拒絕invalid tree/state/cash/research，`activeEffects`的factory/reveal aggregate overflow也checked throw。
- **public core 與 Game/UI bounds**：public mapgen/factory-sim各容許至65,536格；Game map另限每邊64、每圖4,096格，Game factory另限每邊256、總計4,096格。前者保留headless API能力，後者是renderer-safe authority；Lab固定`704×512`、只畫active layer並cull viewport外 cells，production preview覆蓋最大`64×64` authority。效果圖`sideEffectId`使用`Int32Array`。
- **整局狀態 / Save v4**：單一state/head ≤4,096 trace/≤100,000 ticks/≤100,000,000 work，inventory ≤24,500。正常`24×12` Pilot reference的100,000-tick trace約85,313,612。full wire ≤5,000,000 chars才round-trip；full/compact load皆從raw origin+trace preflight後replay。
- **早期開發相容範圍**：存讀檔、rewind與replay只保證同 content build；目前不維護跨 build migration／legacy generator，breaking update 可要求清除舊 localStorage。詳見 [development-policy.md](development-policy.md)。
- **持久化 / UI**：rewind共用aggregate 12,000 ticks/8,192 entries/100,000,000；compact另限20/1,250,000 chars。`serializeSlots`/`deserializeSlots`同界，deserialize在任何state replay前驗raw list；legacy先history、必要時head-alone。timeline同origin/normalization-aware，跨run replace。Factory diagnostics另有100,000,000 pre-init work cap。UI 是全螢幕工廠遊戲 shell；Factory 以畫布直接拖建／拆除、pan／zoom、pipette、clipboard 與 50 步 history 操作。現行 Lab 會把 Recipe 指令軌自動排列成真實 Pilot Bench layout，玩家可直接選機器、移動 anchor、旋轉 footprint 並即時重路由；送廠逐欄位保留 layout。Recipe 指令軌仍是過渡編輯入口，Bench 直接增刪機器／belt、history、ghost、雙向高亮與唯讀 timeline 尚屬 Phase 4 未完成工作，不能視為已交付。只有 active view 接 gameplay hotkeys。
- **求解器**：僅供 tests/tools 驗證與稽核；production 建構式 mapgen 不 import 它，遊戲更**絕不**提供一鍵自動解。

## External Resources

- 靈感來源：Big Pharma（工廠/吞吐）、Potion Craft（鍊金地圖/基底）、Shapez（正方格極簡美術）。
- 技術棧：PixiJS v8、React、Vite、vitest、fast-check、Playwright、Node LTS 20+。
