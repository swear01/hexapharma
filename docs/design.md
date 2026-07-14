# Project HexaPharma — 專案計劃書（canonical 活文件）

> 狀態：**current implemented and verified design**。舊Route Floor／contract／multi-layer truth已從active Game/UI/Blueprint/Save authority移除；2026-07-14完整gate通過。

## 摘要

HexaPharma 是一款單人 2D 工廠解謎遊戲：玩家在一張遠大於 viewport 的程序化 **Research Atlas** 上，以固定奇形 Machine `PathStamp` 組出可執行的 `ResearchProgram` 並探索未知地形；再到無時間、無成本的 **Pilot Plant** 自由設計合法工廠；最後把 Pilot layout 原樣 commission 到 **Production**，由連續 runtime 承擔所有產品與經濟結果。

玩法借鏡 Big Pharma 的工廠資訊密度、shapez 1 的低摩擦直接操作、Factorio 的一致工具語言與 Potion Craft 的大地圖局部探索，但不複製競品素材或 trade dress。所有內容都是資料；runtime 生成並由程式碼渲染。

# 1. 遊戲設計

## 1.1 核心循環

```text
Research Atlas：用固定奇形 PathStamp + prefix calibration 組 ResearchProgram
  → 執行 program，沿權威路徑探索 wall／abyss／swamp／同層 A→B portal 與 fog
  → 將發現轉成玩家知識；Research 不產生 contract，也不 transfer factory layout
  → Pilot Plant：零時間、零成本建立任意合法 FactoryLayout，反覆看診斷
  → Commission：只驗 layout 合法，逐欄位複製到 Production
  → Production：連續 tick，實際產出 cure／side effect／failure／waste
  → Market / Technology
```

三個建築是三份獨立 authority：

- **Research** 擁有 Atlas、fog 與 `ResearchProgram`；只負責探索。
- **Pilot Plant** 擁有 sandbox `FactoryLayout`；只負責免費空間試作與診斷。
- **Production** 擁有 commissioned layout 與 runtime；負責時間、產品、庫存、廢料與經濟。

Research 不再是 Pilot 的 contract author。三建築仍共享方向、直接操作與視覺語言，但不共享一個可互相 alias 的資料物件。

## 1.2 單層 Atlas 與 terrain

Active milestone 只有一張 Research Atlas：

- 不提供 A–D layer tabs、跨層座標、跨層 palette 或 swap／Phase Exchange。
- 低階 `MultiMap` 資料結構可供mapgen/tooling未來研究，但production `GameState`強制單一Atlas；UI、Blueprint、Save與playtest不得將多層當現行玩法。
- **Wall／OOB**取消該次delta但繼續剩餘path；**Abyss**進入後sticky fail並停止；**Swamp**消耗2 energy（其他可進入格消耗1）。energy用完就停止該stamp。
- **Portal** 是同一 Atlas 內成對、定向的 A→B transition。B 不得反向偷當 A；portal jump 在 path/trail 上必須顯式斷段，不能畫成穿越中間格。
- 進入Portal A後立刻到同圖B，剩餘path從B繼續；path API、unit/property tests與UI feedback共用這套規則，renderer不得自行猜測。

Atlas 仍維持「世界大於 viewport、開局在中心附近、未知資訊由 opaque fog 遮蔽、玩家主動 pan/zoom」的核心。固定 map pixel/格數是可調內容值，不是本 breaking milestone 的完成證據。

## 1.3 ResearchProgram 與 PathStamp

Research 只有 Atlas；**不存在 Route Floor、FactoryLayout、source/belt/sink、linear route descriptor 或 editable Recipe timeline**。

### Machine PathStamp

- 每個 Research machine content 定義一個固定、可為凹形／轉折／不規則的 `PathStamp`。
- stamp 的 cell path、入口、出口與 terrain interaction 是 catalog authority；玩家不能用 Factory footprint rotate/flip/scale 暗中改變它。若需要變體，必須是顯式 catalog content，而不是 UI 猜測。
- `ResearchProgram` 保存ordered stamp references與每個prefix的calibration；每個stamp都從前一個authority endpoint接續，不另存任意anchor。renderer只畫authority，不自行重建近似path。
- pure core的actual-step preview與execution共用同一terrain-aware path function。idle placement會先把hidden cells中性化：已揭露terrain使用相同path規則，hidden terrain／未成對揭露的portal仍按in-bounds nominal path，避免由ghost洩漏wall、swamp、abyss、portal B或outcome。

### Prefix calibration

- calibration 的目的只是在當前 program prefix 的權威 endpoint 上接續下一個固定 stamp。
- calibration 是 program authority 的一部分，必須 canonical、deterministic、可驗證、可序列化與可進 Blueprint。
- calibration 不得改 stamp 幾何、跳過既有 prefix、auto-solve terrain 或在失敗時 silent repair。
- 每次 prefix 變更後，後續 calibration 必須重新由 authority 驗證；非法／歧義 program 原子拒絕。

### 探索語意

- 規劃、hover、ghost、calibration 與 Blueprint load 不改 fog，也不產生免費真實 outcome。
- 只有明示執行 ResearchProgram 才沿權威 traversed path 更新探索狀態。
- reveal 必須只來自已實際完成的 path segment；portal jump 不揭露 A/B 之間不存在的直線。
- planning免費；按Dispense時原子扣`max(1, Σ catalog machine cost)`，abort／failure不退費。每個actual traversed point以base radius 1揭霧，Technology只可增加這個actual-segment sensor radius。具體數值仍可平衡，但這套扣款／揭霧時機是authority。
- Research 結果是探索知識，不生成 `Template contract`、Pilot layout 或 Production commission token。

## 1.4 Seeded radial + motif mapgen

- mapgen 由 canonical seed + 完整 generation options 決定；禁止 `Math.random()`、wall-clock 與依賴容器 iteration side effect。
- generation 先建立中心起點、radial progression 與可組合 motifs，再以 constructive ResearchProgram 安排可走的探索結構。
- wall／abyss／swamp／portal 必須由 motif rules 放置並通過 terrain-specific invariants；不能先亂撒再用 production solver rejection loop 過濾。
- generator 同時輸出或可重建 reference ResearchProgram，讓 tests 驗證 solvability、prefix calibration、portal pairing 與同 seed 逐欄位相等。
- solver 只供 tests/tools 做 soundness、quality metrics 與平衡觀測，絕不接進遊戲內自動解。
- radial band 數、motif 權重、地形密度與 reward pacing 屬平衡，可後續調；確定性、constructive validity 與無跨層內容不是平衡。

## 1.5 Pilot Plant

- Pilot 是獨立 F2 world page，使用完整 Factory editor 與 `FactoryLayout` geometry authority。
- **沒有時間、建造成本、耗材、inventory 或 waste**；玩家可從空地開始建立任意合法 source/belt/machine/splitter/merger/sink layout。
- Pilot 與 Research 解耦：不接收 Research layout、`ResearchProgram`、cure proof 或 contract。
- 即時 diagnostics 可顯示 actual outcome、side effects、final endpoint、throughput、bottleneck、deadlock 或 bounded analysis error，但不建立 live runtime authority。
- **Commission 不要求 cure、特定 outcome、Research contract 或 diagnostics 成功。**只要 layout 通過目前 entitlement、geometry、catalog 與 Production 初始化所需的結構驗證，就可以送出。
- no-cure、side effect、failure、deadlock 或低吞吐是玩家可選擇帶入 Production 的結果；Pilot 必須警示但不能偷偷 repair 或替玩家禁止。

## 1.6 Production

- 第一次進入 live Production 前必須由 Pilot commission；不能在空白 Production 頁繞過 Pilot 建廠。
- commission 將 Pilot `FactoryLayout` 的 dimensions、tiles、machine IDs/types、paths/strokes、anchors、footRot、ports/routing **逐欄位 copy/own** 到 Production。
- 禁止 auto-pack、reorder、rotate、重新接線、依 ResearchProgram 編譯或建立隱藏 contract。
- Production 是唯一持續流動時間的建築；`productionTicks` 推動 source、belt、machine、splitter、merger 與 sink。
- sink 交付實際 `DrugState`、`Outcome` 與 processing cost。有效 cure 可進 inventory；failed/no-cure 等結果成為 waste，side effects 進實際市場計價。沒有 contract mismatch 這一層判斷。
- splitter/merger cursor、runtime、cold snapshot、hash 與 save 都是 authority。layout edit 重建 runtime 並清該線 runtime-local counters。
- 玩家可在 commission 後編輯 Production，但後續後果由 live layout 承擔；「initial exact copy」仍必須可逐欄位驗證。
- public factory-sim area、Game/UI bounds 與 diagnostics work caps 必須繼續 fail-fast；具體既有數值可在 v6 實作時保留或顯式改版，不可靜默放寬。

## 1.7 經濟與 Technology

- Market 只販售 Production 產生的實體 cure；一顆產品只能賣一次。
- 收入依實際 production cost、cure、side effects 與市場 sold counters 結算，不依已移除的 contract。
- Technology 可解鎖 factory machines、建地、Research PathStamps、motifs 或探索輔助；不得以「新增 layer/swap」作為 active milestone 進程。
- 探索輔助只增加實際dispensed path segment的sensor radius；unlock本身、planning與hover都不得改fog。
- 任何重生 Atlas 的 unlock 都必須先顯示會清除哪些 Research/Pilot/Production/fog/inventory authority，並要求確認。
- 具體 tree、cost 與 pacing 待新 mapgen/PathStamp authority 穩定後再平衡。

## 1.8 Blueprint Library（breaking schema）

Blueprint 與 save slot 仍完全分離，使用獨立 storage namespace；Load/Rewind/換存檔不得改變 Library。

### Research kind

wire kind 是 `research-program`。保存 portable ordered Research Template：`program.steps[] = {typeId, stroke}`。`typeId` 指向 `DEFAULT_CATALOG` 的固定 PathStamp，`stroke` 是該 stamp 的 prefix calibration；import/materialize 時由本 build catalog 還原並驗證固定 path。wire 不重複保存 path cells、placement/anchor 或 Factory shape。

不保存 FactoryLayout、source/belt/sink、fog、seed、discovered terrain、outcome、economy 或 runtime。

### Pilot kind

wire kind 是 `pilot-plant`。保存 portable `FactoryLayout`：dimensions、非 empty routing tiles，以及 machines `{id,typeId,stroke,anchor,footRot}`。chemical path/cost/speed/shape 由 local catalog/content fingerprint 還原；**不保存 chemical orientation**。允許合法 split/merge/parallel geometry；不保存 ResearchProgram、fog、seed、diagnostic result、Production runtime、inventory 或 economy。

### Codec rules

- document wire/version 與 ruleset 均固定為 **v2**：root 恰為 `{format,version,checksum,blueprint}`，`format = hexapharma-blueprint`，checksum 是 canonical blueprint payload 的 lowercase SHA-256。
- content fingerprint 是 `fnv1a32:` digest，涵蓋 ordered `DEFAULT_CATALOG` fixed paths/cost/speed 與 key-sorted `DEFAULT_SHAPES`；catalog/content 改變就顯式 incompatible。
- decoder strict、bounded；unknown/missing/cross-kind fields、bad checksum/version/fingerprint/calibration、unknown type、duplicate tile/ID、footprint collision、routing collision、越界或 cap 都顯式拒絕。
- Research 和 Pilot payload 使用 kind-specific validator；不得把一種 payload 猜成另一種。
- Blueprint v1 layout-based `research-route` 文件顯式拒絕，不能沿用同 version、猜測轉成 program 或 partial import。
- Library namespace/version 是 `hexapharma.blueprint-library.v2`／v2；最多 64 entries、單 document 最多 1,048,576 bytes、整個 Library 最多 4,000,000 bytes。download/upload/paste/delete 與跨 save 行為保留。

## 1.9 UI 與直接操作

- viewport-filling shell，中央 world 優先；HUD、rail、hotbar、inspector 不把世界壓成 web form。
- `F1` Research、`F2` Pilot Plant、`F3` Production；`M/T/B` 是可關閉 drawers。
- Research 不再顯示 Atlas/Route Floor modebar，也沒有常駐長篇教學文。操作提示使用短 tooltip、hotkey hint、首次出現且可消失的提示，不佔固定世界空間。
- Research PathStamp placement與Factory placement共用pick/place/erase/pan/zoom/undo的肌肉記憶，但資料類型與幾何validator不可混用。Research以LMB commit、RMB／Backspace erase last、Enter Dispense；committed prefix與held candidate使用不同trail/token樣式。
- Pilot/Production 共用 Factory editor；Production transport controls 只在 live Production 顯示。
- 錯誤、storage、renderer、diagnostic 與 migration failure 必須可見；禁止 silent fallback。
- 詳細契約見 [ui-interaction.md](ui-interaction.md)。

## 1.10 Save v6（implemented）

Save core wire與checkpoint UI／lineage／recovery已breaking freeze為v6；全repo gate與真人流程仍要對最終commit驗證。

- full envelope是`{version:6, game}`。Research保存`program/shot/lastOutcome`與fog；Pilot只保存獨立`layout`；Production保存`layout/runtime cold snapshot/waste`。不存在Research layout或Pilot/Production contract。
- compact envelope是`{version:6, authority:{origin,intentTrace,replayTicks,stateHash}}`。reader先從raw trace重算ticks/work，再semantic replay並比對canonical trace與state hash。
- slots envelope是`{version:6, slots:[game...]}`；serialize/deserialize與rewind同樣重建Research shot、factory authority與cold runtime，不共享可變runtime。
- Catalog、Research step與Factory machine使用fixed `path/stroke`；舊`transform/orientation/orientable`欄位不是v6 authority。
- decoder對unknown/missing fields、非safe integers、非法path/stroke/layout/runtime、oversize與replay forgery顯式失敗；不能partial/default load。
- v5顯式拒絕，不建立Route Floor/contract/multi-layer migration chain。
- core caps：單blob最多5,000,000 characters、slots最多20 states、單head最多4,096 intents／100,000 ticks／100,000,000 replay work；rewind aggregate最多8,192 intents／12,000 ticks／100,000,000 work。
- `src/ui/checkpointStorage.ts`已接v6 lineage/recovery與corrupt-blob recovery UX；v5仍顯式拒絕。
- checkpoint外層lineage envelope使用獨立storage version 2；其中`head/history`保存的game authority仍是Save v6，兩個版本號不可混為同一wire。

# 2. 技術架構

## 2.1 技術棧與資料流

TypeScript 6、React 19、PixiJS 8、Vite 8、Vitest 4、fast-check、Playwright。

```text
React UI         → 讀 GameState、發 GameIntent
Pixi renderer    → 只讀 ResearchProgram／Factory state、畫 world
pure TS sim core → path execution、mapgen、factory tick、economy、save/replay
```

`src/sim/**` 禁止 import Pixi/React/DOM。地圖與 sim 禁 `Math.random()`／wall-clock；離散量用整數、比例用 exact representation。Production 成功熱 tick 繼續使用預配置 SoA buffers。

## 2.2 關鍵模組（target）

- `drug-graph`：PathStamp traversal、terrain/portal interaction、program preview/execution。
- `mapgen`：seeded radial/motif constructive Atlas + reference ResearchProgram；solver 僅 tests/tools。
- `factory-sim`／`factory-geom`：Pilot/Production geometry、runtime、routing、throughput、cold snapshots。
- `game`：ResearchProgram、Pilot sandbox、exact Pilot→Production commission、products/economy、intent replay/hash。
- `replay-work`／`save`：Save v6 raw preflight、full/compact authority。
- `blueprint`：kind-specific ResearchProgram／Pilot layout codec + independent Library。
- `render`：single Research Atlas 與 Factory dumb Pixi renderers。
- `ui`：三建築 shell、Atlas PathStamp tools、shared Pilot/Production editor、drawers/checkpoint/Blueprint Library。

舊 `recipe` linear-route/contract path 不是新 Research authority；只有仍被其他非 Research tooling 明確需要時才能保留，否則應刪除或隔離。

## 2.3 確定性與 ownership

- 進 state/trace 的 program、stamp refs、calibration、generation options、catalog、layout 與 nested geometry都 canonical clone + deep-freeze。
- prefix preview 與 execution 使用同一 pure authority；renderer 不重算另一條路。
- `FactoryRuntime` 綁定建立它的 Production layout 與 map/content identity；不同 authority 不得混跑。
- reducer 的有效 Production tick 不修改舊 history；product events 每 tick drain/clear。
- bug 回報附 seed、tick/path segment range、input trace／ResearchProgram 與第一個壞掉的不變式。

# 3. 驗證與完成定義

## 3.1 TDD 與自動測試

- unit/property：fixed PathStamp、prefix calibration、terrain/portal、radial/motif mapgen determinism/constructive validity、Pilot legal layouts、exact commission、Production outcomes、Blueprint kind validators、Save v6 replay。
- integration：Research exploration 與 Pilot→Production 是兩條解耦 authority；完整 Production→Market/Technology loop。
- Playwright：single Atlas、無 Route Floor/常駐教學、PathStamp preview/commit、無跨層 controls、Pilot 任意 layout/no-contract commission、exact Production copy、Blueprint cross-save、responsive reachability。
- 唯一gate仍是`npm run check`；任何後續改動都必須保持通過。

## 3.2 手動玩測

真人伺服器固定 `0.0.0.0:53346 --strictPort`。依 [playtest.md](playtest.md) 驗 single Atlas Research、Pilot sandbox、no-contract commission、Production actual consequences、Blueprint kinds 與 Save v6。舊 seed-14 Research route fixture 已不適用。

## 3.3 本階段完成／未完成

single-Atlas core、三場域UI、Blueprint v2、Save v6、checkpoint integration、browser acceptance與完整gate已實作並於2026-07-14重跑。主觀密度、cost、reward、difficulty與後續美術量可再平衡，但以下不是平衡問題：單一Atlas、固定PathStamp、prefix calibration、無跨層互動、Research無contract、Pilot no-contract commission、exact copy、kind-specific Blueprint、Save v6 authority。
