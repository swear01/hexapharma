# Project HexaPharma — 專案計劃書（canonical 活文件）

> 目前是早期開發；跨 build 存檔相容與數值平衡不在本階段完成定義內。實際行為若改變，必須同時更新本文、測試與相關 active docs。

## 摘要

HexaPharma 是一款單人 2D 工廠解謎遊戲：在程序化生成、迷霧覆蓋的多層 **Effect Atlas** 中，以實體機器路線探索藥效；把已驗證路線送入無時間、零成本的 **Pilot Plant** 做空間打樣；再原樣交付 **Production** 連續量產、販售並投入 Technology。

玩法借鏡 Big Pharma 的工廠資訊密度、shapez 1 的低摩擦直接操作、Factorio 的一致工具語言與 Potion Craft 的大地圖局部探索，但不複製競品素材或 trade dress。所有內容都是資料；runtime 生成並由程式碼渲染。

# 1. 遊戲設計

## 1.1 核心循環

```text
Research Route Floor 擺出唯一 source→machines→sink 路線
  → 付費 Dispense 一顆實驗藥
  → 藥逐台經過機器，只有完成步驟才沿實際掃動路徑揭霧
  → 找到非失敗療效後，把 exact layout + derived effect contract 送到 Pilot Plant
  → Pilot Plant 在零時間、零耗材下搬移、重排、驗證完整實體排布
  → exact transfer 到 Production
  → Production 才有連續 tick、在途藥、庫存與 waste
  → Market 賣出實體成品，取得現金與 Knowledge
  → Technology 解鎖機器、建地、揭霧與更深地圖
```

三個建築是三份獨立 authority，不是同一頁的 mode：

- **Research** 承擔未知、實驗成本與逐步探索。
- **Pilot Plant** 承擔免費的幾何試作與量產前驗證。
- **Production** 承擔時間、吞吐、庫存、廢料與經濟。

## 1.2 多層效果地圖

- 一張 map 代表一種成分／基底；一關支援 1–4 層。
- 每顆藥在每層有一個整數座標；一台機器同時變換所有層的位置。
- cell 種類：empty、wall、hazard、side effect、cure。療效與副作用只由最後位置決定。
- `translate` 逐格掃動；牆使藥停在前一格，hazard 使整顆藥 sticky-failed。
- `scale` 以有理數往各層 origin 拉；`swap` 交換兩層座標。
- 機器的 effect orientation 與實體 footprint rotation 分離。保持效果步驟與各步 orientation，即使改 belt routing，藥效仍相同。
- 新局為單一 `63×63` A 層；A 的 start/origin 在 `(31,31)`。B/C/D 使用由 layer index 決定的近中心 phase offsets，讓 Phase Exchange 不是 no-op。
- 生成器先構造可解 reference，再在保護路徑外生成連通 cure/side-effect/wall/hazard regions。同 seed + 完整 `GenOptions` 在同 content build 逐欄位相等。
- 求解器只存在於 tests/tools，永不接入遊戲內自動解。

## 1.3 Research

Research 建築包含兩個工作面：

### Effect Atlas

- 大圖遠大於 viewport；平時只能看到一小部分。
- 固定 `704×512` canvas，frame 僅能等比縮放以維持正方格；100% 約 40px/cell；drag pan、wheel cursor-anchor zoom。
- 開局鏡頭精確以藥物所在的 `(0,0)` 相對座標置中；這是 `63×63` authority 的 `(31,31)`。
- 每格有 minor grid，每 5 格有 origin-aligned major grid；**不畫穿過玩家的 X/Y 十字軸**。
- `Focus`／`F` 只在按下當下重新置中，之後不 auto-follow；揭霧或 shot 移動不能搶回鏡頭。
- 未知 feature 由 opaque fog 完全遮蔽；格線可在 fog 上提供距離感，但不得洩漏地形。
- 多層一次只顯示 active layer，A–D 各自保存 camera。

### Route Floor

- 使用與 Pilot/Production 相同的 `FactoryLayout`、footprints、ports、belts、碰撞、旋轉、ghost/buildability 與直接操作語言。
- 初期 Research authority 必須是唯一、無循環、無 split/merge、完整連通的 source→machines→sink 路線。
- `Template.steps` 只能由實體 connectivity 確定性推導；不存在另一份可獨立排序的 Recipe timeline。
- 缺 source/sink、斷線、分支、合流、循環、歧義或零機器都必須顯式拒絕，不得猜順序或 auto-repair。

### Dispense 語意

- 規劃、放置、搬移、旋轉不揭霧，也不收取研究費。
- Route Floor 只驗可放置幾何，不執行或顯示免費 `factoryOutcome`；藥效只能由付費 shot 揭示。
- `Dispense` 開始時只收一次 `max(1, Σ route machine cost)`，建立一顆 `ResearchShot`。
- shot 依 route 一步一步前進；每個完成步驟用 sim 的真實 sweep trail 揭露 Chebyshev radius 1。
- 尚未完成的後續機器不得提前揭霧。失敗時在該步結束，成功時在最後一步產生 `lastOutcome`。
- Abort、hazard failure 或無療效皆不退款；編輯中的路線不能在 shot 執行時被改寫。
- 只有完成且非 failed、至少治療一種疾病的結果，才能 exact transfer 到 Pilot Plant。

## 1.4 Pilot Plant

- 是獨立建築頁面，不是可關不掉的 overlay。
- 使用和 Research Route Floor／Production 同一套空間編輯器與幾何 authority。
- **沒有時間流動、沒有耗材、沒有現金成本、沒有庫存或 waste**；玩家可立即反覆搬移、重排、並聯與驗證。
- 即時 sample 必須完整顯示 cures、side effects 與各層 final endpoint，另顯示 throughput、bottleneck 與 contract match。
- 從 Research 收到逐欄位相同的 layout 與由 Research 證明的 effect contract。
- `Commission` 以真實 `factoryOutcome` 驗 layout 是否實現 contract；不符、deadlock 或 bounded diagnostic exhaustion 都顯式拒絕。
- 通過後將 Pilot 的 layout 與 contract 逐欄位送入 Production；禁止 auto-pack、偷偷旋轉、改接線或修復。

## 1.5 Production

- 唯一持續流動時間的建築；`productionTicks` 推動 source、belt、machine、splitter、merger 與 sink。
- sink 交付一顆實體藥，攜帶實際 `DrugState`、`Outcome` 與完成機器的累計 processing cost。
- 只有未失敗、至少治療一種疾病、且符合 commissioned contract 的藥能進庫存；其餘成為 waste。
- splitter 只收 `inDir`，以每 tile round-robin cursor 選 `outDirs`；merger 只收 `inDirs`，同 tick 依陳列順序仲裁。
- cursor、runtime、cold snapshot、hash 與 save 都是 authority。每次 layout edit 重建 runtime 並清該線 waste。
- 玩家用並聯、routing 與空間最佳化提高吞吐；機器 speed/cost 固定，不提供任意速度滑桿。
- public factory-sim area 可到 65,536；Game/UI 每邊 ≤256、總格數 ≤4,096。同步 diagnostics 同時受 100,000 ticks 與 100,000,000 weighted work 上限。

## 1.6 經濟與 Technology

- Market 只販售庫存中的實體藥；一顆多療效藥只能選一個疾病市場賣一次。
- 收入依疾病 base price、實際 production cost、副作用與該疾病已售數結算；單一疾病收益遞減。
- 每顆合法銷售增加 1 Knowledge（sim 欄位仍名為 `research`）。目前沒有訂單 scheduler。
- Technology 消耗現金與 Knowledge 解鎖機器、建地、揭霧輔助或下一深度。
- 地圖專利把 1→2→3→4 layers、seed uint32 +1 並重生關卡；清三場域 layout/contract/runtime/shot/outcome、waste、inventory、fog 與 sales counters，保留扣款後資源、patents 與全域 inventory ID。UI 必須先完整警告並要求確認。

## 1.7 Blueprint Library v1

Blueprint 與 save slot 完全分離，使用獨立 localStorage key；因此 Load/Rewind/換存檔不會改變 Blueprint Library。

- kinds：`research-route`、`pilot-plant`。
- 保存 portable layout：尺寸、非 empty tiles、machine ids/types、anchors、effect orientation/flip、footRot。
- 不保存 seed、fog、cash、Knowledge、patents、疾病、shot、outcome、contract、runtime、inventory 或 production waste。
- 格式標識 `hexapharma-blueprint`、version 1、ruleset 1；payload 另含由目前 machine catalog + shapes 推導的 content fingerprint，並以 WebCrypto SHA-256 checksum 驗 canonical payload。
- decoder 嚴格拒絕未知／缺少欄位、錯誤 version/ruleset/content fingerprint/checksum、越界座標、非法 geometry、重複 tile/id、未知 machine 或超過 1 MiB。`research-route` 另外必須通過唯一線性 topology validator。
- Library 最多 64 筆、總量 4 MiB；新增相同 checksum 取代同一筆，不建立假副本。
- UI 可 capture Research/Pilot、下載 JSON、貼上或上傳匯入、套用到同 kind 建築與刪除。
- 藍圖是標準化本地檔案，可手動分享；本階段沒有帳戶或雲端服務。

## 1.8 UI 與直接操作

- viewport-filling shell，中央世界優先；HUD、建築 rail、bottom hotbar、inspector 不把畫布壓成網頁小卡。
- `F1` Research、`F2` Pilot Plant、`F3` Production；三個建築頁面保持 mounted 以保存 camera/tool state，但只有 active page 接收 gameplay keys。
- `M` Market、`T` Technology、`B` Blueprints 是可關閉 drawers，不佔用第四個建築頁。
- Factory-style editor 的主要動詞：pick、place/drag、erase、rotate、mirror、pipette、copy/cut/paste、undo/redo、pan、zoom；不是表單提交。
- 管理型的 Market/Technology/Blueprint cards 可以使用 DOM buttons，因其不是空間建造。
- 錯誤必須可見且有 alert 語意；save/load/storage/renderer/diagnostic 失敗不得靜默 fallback。
- 詳細契約與截圖見 [ui-interaction.md](ui-interaction.md)。

## 1.9 存檔

- Save v5 保存巢狀 `research`、`pilot`、`production` 三場域、經濟、專利、庫存、fog、RNG 與 canonical intent trace。
- full serializer 僅在 materialized wire ≤5,000,000 characters 時保證 round-trip；localStorage checkpoint 使用 compact origin + normalized trace + replayTicks + stateHash authority。
- 單一 state/head：≤4,096 entries、≤100,000 production ticks、≤100,000,000 weighted replay work。
- rewind aggregate：≤12,000 ticks、≤8,192 entries、≤100,000,000 work；compact 另限 20 snapshots／1,250,000 chars。
- reader 先從 raw origin + trace 重算 work，再做 semantic replay；不能信 declared counters。
- timeline 必須同 origin 且形成 normalization-aware prefix lineage；跨 run save 明示取代舊 timeline。
- corrupt/partial/disagreeing checkpoint 必須顯示錯誤，玩家按 Recover 前不得刪或覆寫。
- 正式 release candidate 前不維護跨 build migration；v4 與更舊格式由 v5 顯式拒絕。

# 2. 技術架構

## 2.1 技術棧與資料流

TypeScript 6、React 19、PixiJS 8、Vite 8、Vitest 4、fast-check、Playwright。

```text
React UI         → 讀 GameState、發 GameIntent
Pixi renderer    → 只讀 sim、畫世界
pure TS sim core → tick、mapgen、economy、save/replay
```

`src/sim/**` 禁止 import Pixi/React/DOM。地圖與 sim 禁 `Math.random()`／wall-clock；離散量用整數、比例用有理數。Production 的成功熱 tick 使用預配置 SoA TypedArrays 與固定 scratch/event buffers，不配置新物件。

## 2.2 關鍵模組

- `drug-graph`：transform、supercover sweep、preview、fog reveal、evaluate。
- `mapgen`：seed-pure constructive levels；`solver` 僅 tests/tools。
- `factory-sim`／`factory-geom`：共用 geometry、runtime、routing、throughput、cold snapshots。
- `recipe`：從 Research layout 驗證並推導唯一線性 route；不在 transfer path auto-pack。
- `game`：三場域 reducer、實體庫存、deeper reset、intent replay/hash。
- `replay-work`／`save`：raw preflight、Save v5 full/compact authority。
- `blueprint`：獨立 portable v1 codec/storage。
- `render`：Lab/Factory dumb Pixi renderers；renderer 載入失敗可見。
- `ui`：三建築 shell、shared facility editor、drawers、checkpoint 與 Blueprint Library。

## 2.3 確定性與 ownership

- 進入 state/trace 的 `GenOptions`、catalog、Template、FactoryLayout 與 nested geometry 都 canonical clone + deep-freeze。
- `FactoryRuntime` 綁定建立它的 layout 與 `MultiMap` object identity；不同 authority 即使欄位相等也不得混跑。
- reducer 的每個有效 `productionTicks` 先 snapshot→restore，避免新 state 修改舊 history。
- 每 tick drain 並清固定 product-event buffer，不漏收或重收產品。
- bug 回報附 seed、tick range、input trace 與第一個被破壞的不變式。

# 3. 驗證與完成定義

## 3.1 自動測試

- unit/property：transform、mapgen、route descriptor、Research shot、factory mass/routing/runtime、economy、save、Blueprint strict codec/storage。
- integration：Research→Pilot→Production→Market→Technology；save/replay/checkpoint lineage。
- Playwright：三頁 navigation、atlas center/grid/fog/camera、shared editors、exact transfers、drawers、Blueprint cross-save、production preview 與 responsive reachability。
- 唯一 gate：`npm run check`，即 `tsc --noEmit && eslint . && vitest run && playwright test`。

## 3.2 手動玩測

真人伺服器固定 `0.0.0.0:53346 --strictPort`。依 [playtest.md](playtest.md) 從 Research 付費探索、Pilot 免費驗證、Production 量產到 Market/Technology/Blueprint/Save 全走一次。

## 3.3 本階段完成／未完成

三場域 authority、Research progressive reveal、shared spatial editor、exact transfer、Blueprint v1、Save v5、world-first shell 與自動測試屬 correctness/UX 必修。**主觀數值平衡、正式內容量、正式美術 polish 與跨 build save migration 刻意後置**，不得把它們混稱為程式缺漏，也不得用它們掩蓋 gate 失敗。
