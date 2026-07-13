# Invariants（不變式總表）

> 自動閘的脊椎。違反時附 `seed + tick 區間 + input trace` 與第一個壞掉的不變式。

## Drug graph

- translate 逐格 sweep；牆停前一格，hazard sticky-fails。scale 使用 exact rational；swap 純交換兩層位置。
- 旋轉四次回原狀，flip 兩次回原狀。
- outcome 只由 final positions 決定；相同 effect steps/orientations/order 與 belt geometry 無關。
- preview、apply、Research reveal 使用同一套 sweep authority，不得各自近似。

## Map generation / fog

- 同 content build、同完整合法 `GenOptions` → map、origin/start、difficulty、price 逐欄位相等。
- seed 只收 canonical uint32；mapgen 不使用 `Math.random()`、wall-clock 或 production solver。
- Game map 每邊 ≤64、每圖 ≤4,096；public mapgen 單圖 area ≤65,536。
- A 層 start/origin 是 `floor(width/2),floor(height/2)`；預設 `63×63` 為 `(31,31)`，UI 相對座標為 `(0,0)`。
- 新局 fog 只揭 start Chebyshev radius 3；unknown features 必須被 opaque fog 完全遮蔽。
- Atlas 只畫 active layer/visible cells；每格 minor、每 5 格 origin-aligned major grid。不得畫跟玩家重疊的 XY 十字軸，也不得因 shot 移動 auto-follow。

## Research

- layout 必須符合 Game entitlement，且 route descriptor 只接受唯一 source、唯一 sink、完整連通、無 cycle/split/merge、至少一台機器的線性路徑。
- `Template.steps` 只能由實體 connectivity 推導；不得有第二份 editable Recipe authority。
- planning/editing 不改 fog、不扣 cash。
- `beginResearchShot` 只扣一次 `max(1, Σ route catalog cost)`；cash 不足原子拒絕。
- shot 執行中不可改 layout。每個 `advanceResearchShot` 只完成一個 machine effect，並只揭該步真實 trail 的 radius 1。
- 未完成的路徑不預先揭霧。Abort、failed、無療效不退款。
- 成功 transfer 必須有完成、非 failed、至少 cure 一病的 `lastOutcome`，且重新 evaluate 的 route 與 outcome 相同。

## Pilot Plant / exact transfer

- Pilot 沒有 tick、耗材、cash、inventory 或 waste authority；編輯 layout 是免費冷路徑。
- Research→Pilot 必須逐欄位 own 相同 layout，並攜帶 derived contract。
- Pilot→Production 必須由 `factoryOutcome(layout)` 證明與 Research contract 相同；不符/deadlock/budget exhaustion 顯式拒絕。
- transfer 禁止 auto-pack、reorder、silent rotate、silent repair。

## Production / factory-sim

- 只有 `productionTicks` 推進 runtime；正 ticks 沒有 Production layout 時拒絕，0 ticks 是 no-op。
- 質量守恆；`nextUnitId === unitCount + producedTotal`；每顆 active/event ID 唯一有序。
- sink event 保留實際 DrugState、failure 與累計 machine cost。只有符合 contract 的有效 cure 進 inventory；其他增加 waste。
- splitter 只收 `inDir` 並以 per-tile round-robin cursor 出貨；merger 只收 `inDirs`，同 tick 按宣告順序仲裁。
- cursor 進 runtime/cold state/hash/save。runtime 綁 layout + `MultiMap` identity。
- 成功 hot `stepFactory` 使用預配置 SoA/event/scratch buffers，不建立新 object/Array/Map。
- public factory area ≤65,536；Game layout 每邊 ≤256、area ≤4,096。diagnostics ≤100,000 ticks 且 ≤100,000,000 work，超界在 init/tick 前 fail-fast。
- true throughput deadlock 回 `0/1` + null bottleneck；不能偽裝成藥物 failure。其他 exhaustion 顯式 throw 並由 UI 顯示。

## Whole-game authority

- GameState 必須同時包含 owned `research`、`pilot`、`production`；不能用舊 recipe/factory 平行欄位形成雙 authority。
- 同 origin + canonical intent trace 重播逐欄位/hash 相同。trace ≤4,096、production ticks ≤100,000、weighted work ≤100,000,000。
- reducer 不 alias：有效 production tick 先 cold snapshot→restore；新 state 不修改舊 state/history。
- 每 tick 立即 drain/clear product event；不得 batch 只看最後 tick、漏貨或 load 後重收。
- inventory ≤24,500；一顆 physical product 只能賣一次。bulk sale 必須原子驗證 product IDs、disease 與 cure。
- 進 state/trace 的 options/catalog/template/layout/nested geometry 都 canonical clone + deep-freeze。
- map patent 清 Research/Pilot/Production layout、shot/outcome/contract/runtime/waste、inventory、fog、sales；保留扣款後資源、patents、next inventory ID。

## Economy / patents

- cash 變動 = 收入 − 支出；inventory、cash、Knowledge、costs、IDs 與 sold counters 都是合法 safe integers。
- 收益使用實體產品的 production cost/outcome；每顆合法 sale 恰增加 1 Knowledge。
- 同疾病收益隨 sold counter 遞減。現行沒有 order/demand scheduler。
- patent tree/state/effects 必須完整驗證；cost/reveal/layout aggregates 使用 checked safe-integer arithmetic。

## Blueprint v1

- document 只能有 `format/version/checksum/blueprint`；payload/nested objects 也拒絕 unknown/missing fields。
- version/ruleset/content fingerprint/kind/name/geometry/tile/machine/orientation 全部嚴格驗證；未知 machine、重複 tile/id、collision、越界或 >1 MiB 拒絕。
- `research-route` import/capture 必須立即通過唯一線性 route validator；不能把錯誤延後到 Dispense。`pilot-plant` 可保存 split/merge/parallel 幾何。
- checksum 是 canonical blueprint payload 的 SHA-256；decode 必須先驗 checksum 再 materialize。
- blueprint 不得包含 seed/fog/economy/patents/contract/outcome/runtime/inventory。
- Library 使用獨立 key，最多 64 entries/4 MiB；Save/Load/Rewind 不得改變它。

## Save v5 / checkpoints

- v5 full save round-trip 巢狀三場域；v4/unknown version 顯式拒絕，沒有 silent migration。
- full wire >5,000,000 chars 顯式拒絕；這不代表合法 GameState 失效。
- compact authority 由 origin + normalized trace + replayTicks + stateHash 組成；reader 從 raw trace 重算 ticks/work 後才 replay。
- single head ≤4,096 intents/100,000 ticks/100,000,000 work；rewind aggregate ≤8,192/12,000/100,000,000，compact ≤20 snapshots/1,250,000 chars。
- timeline 同 origin、normalization-aware prefix lineage；跨 run save 取代舊 timeline，不得混合。
- corrupt/partial/disagreeing blob 必須可見，Recover 前不得刪改；Load/Save/Rewind 不得踩壞原 blob。
