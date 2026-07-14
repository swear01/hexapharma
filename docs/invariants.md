# Invariants（不變式總表）

> 這是目前 build 的 invariant 集。違反時附 `seed + tick/path segment 區間 + input trace/ResearchProgram` 與第一個壞掉的不變式。

## Research path core

- `PathStamp`幾何由catalog固定；program接續不得用Factory `footRot`、effect flip或renderer transform改寫path cells。
- pure core actual-step preview在同stamp、prefix endpoint、calibration、terrain下與execution逐cell相同；idle planning先中性化hidden cells，已揭露terrain必須影響ghost，未知terrain不得改形或洩漏。
- `ResearchProgram`的ordered stamps與每個prefix calibration是唯一authority；stamp anchor隱含為前一prefix endpoint，不得另存任意placement、Recipe或Route Floor layout。
- calibration 只能把下一 stamp 接到當前 prefix endpoint；不能改 stamp、跳過 prefix、auto-solve 或 silent repair。
- program／calibration 進 state、trace、save、Blueprint 前必須 canonical validate + own/freeze。

## Terrain / portal

- Active Research 只有單層座標；跨層位置、swap／Phase Exchange 與 A–D layer progression 不得出現在 active program、palette、mapgen、Blueprint 或 save v6 authority。
- Wall／OOB取消單次delta後繼續；Abyss進入後sticky fail並停止；Swamp消耗2 energy、其他可進入格消耗1，energy耗盡停止。renderer不得自行猜另一套結果。
- portal 是同層、成對、定向 A→B；進A後立即到B並從B繼續剩餘path。A只能到配對B，未配對、重複或反向偷用都拒絕。
- portal transition 在 trail 中是 discontinuity；不得 reveal 或繪製 A/B 中間未走過的直線格。
- A與B都是同一pair的可讀glyph，但只有A可啟動；任一端hidden時不得由另一端洩漏pair marker／方向。
- 未知 fog 內的 terrain、portal B、outcome 不得由 hover/preview/calibration 洩漏。

## Map generation / fog

- 同 content build、同 canonical seed + 完整 generation options → Atlas、terrain、portal pairing、motifs、difficulty/quality metrics 與 reference ResearchProgram 逐欄位相同。
- mapgen 使用唯一 seeded RNG，不使用 `Math.random()`、wall-clock、Production sim 或 production solver rejection loop。
- generator 以 radial progression + motifs constructive 產生合法 program；reference program 的每個 prefix calibration 都能由同一 path core 執行。
- start 位於 generator 宣告的中心 authority；Atlas 必須大於正常 viewport，未知 feature 由 opaque fog 完全遮蔽。
- planning、ghost、hover、Blueprint load 不改 fog。只有實際完成的 Research path segment 可以更新 fog；尚未執行的 suffix 不得提前揭露。
- Technology探索輔助只可調整已完成segment的sensor radius；unlock intent本身不得改fog。
- map size、radial bands、motif weights 與 reveal radius 可調，但 bounds 必須顯式且 fail-fast。

## Research

- Research 只持有單一 Atlas、fog、ResearchProgram 與 execution/progress state；不持有 FactoryLayout、source/belt/sink route、Pilot contract 或 Production token。
- F1 不得存在 Route Floor mode、linear route validator、Factory sample outcome 或常駐教學面板。
- program planning 不產生免費真實 outcome。執行只能依已提交 program 推進，不可在 renderer/UI 直接 mutate fog/progress。
- Research 成功／失敗／發現任何 terrain 都不建立 Pilot contract，也不自動建立／改寫 Pilot layout。
- planning不收費；Dispense原子扣`max(1, Σ catalog machine cost)`且abort/failure不退。金額用safe integer；扣款失敗時program/fog/progress原子不變。

## Pilot Plant / exact commission

- Pilot 沒有 tick、建造成本、耗材、inventory 或 waste authority；編輯 layout 是免費冷路徑。
- Pilot 可獨立於 Research 從空地建立任意符合 entitlement/catalog/geometry bounds 的 FactoryLayout，包括 split/merge/parallel。
- diagnostics 可同步分析 actual outcome、side effects、endpoint、throughput、bottleneck/deadlock，但不能推動 Production time或建立產品。
- commission 不要求 ResearchProgram、contract、cure、特定 outcome 或「diagnostics matches」。no-cure/failure/deadlock 是可帶入 Production 的玩家選擇。
- Pilot→Production 的 initial layout 必須逐欄位 own/copy；禁 auto-pack、reorder、silent rotate、silent repair 或依 Research 編譯。

## Production / factory-sim

- 未有 Pilot commission 時不得建立／編輯 live Production layout；只有 commissioned Production 顯示 transport controls。
- 只有 `productionTicks` 推進 runtime；Pilot/Research diagnostics 永不增加 tick、inventory 或 waste。
- 質量守恆；active units、sink events 與 inventory IDs 唯一且不重收。
- sink event 保留實際 DrugState、failure、side effects、cures 與 processing cost。有效 cure 依實際 outcome 進 inventory；failed/no-cure 增加 waste。不存在 contract mismatch 判斷。
- splitter/merger cursor 進 runtime/cold state/hash/save。runtime 綁 Production layout + content/map identity。
- 成功 hot tick 使用預配置 SoA/event/scratch buffers，不在熱迴圈配置新 object/Array/Map。
- area、unit、tick、diagnostic work 都有顯式 bounds；deadlock 是實際可保存／顯示的結果，不是 commission error。

## Whole-game authority

- target GameState 同時包含 owned `research`、`pilot`、`production`，但三者不以 contract 或 shared layout alias 耦合。
- 只有 Pilot commission 會建立 Production initial layout；Research intent 不能直接寫 Pilot/Production。
- 同origin + canonical intent trace重播逐欄位/hash相同；Save v6 core固定單head上限4,096 intents／100,000 ticks／100,000,000 work。
- reducer 不修改舊 state/history；Production 每 tick 即時 drain/clear product events。
- inventory/cash/Knowledge/costs/IDs/sold counters 都是合法 safe integers；一顆 physical product 只能賣一次。
- Atlas reset 必須明確列出會清除的 Research/Pilot/Production/fog/inventory/sales authority，確認前原子不變。
- Factory expansion若會重建commissioned Production runtime／waste，UI必須先顯示destructive confirmation；unlock不得中止active Research shot。

## Blueprint breaking schema

- Library 與 save slots 使用分離的 namespace/lifecycle；Save/Load/Rewind 不得改 Blueprint Library。
- wire/ruleset 固定 v2；Research kind 必須是 `research-program`，payload 只能是 ordered `{typeId,stroke}` steps。fixed path 由 fingerprint-compatible `DEFAULT_CATALOG` 還原，不可重複保存 path/placement/FactoryLayout。
- Pilot kind 必須是 `pilot-plant`，payload 是 sparse routing + machines `{id,typeId,stroke,anchor,footRot}`。不得保存 chemical orientation/path/cost/speed/shape、ResearchProgram、diagnostic result、Production runtime、inventory、economy 或 fog。
- kind-specific decoder 必須拒絕 unknown/missing fields、wrong kind/version/content fingerprint/checksum、duplicate IDs、invalid calibration、unknown stamp/machine、collision、越界與超過 cap。
- checksum 驗證必須先於昂貴 materialization/path execution；失敗不能 partial-write Library。
- 舊 layout-based `research-route` v1 必須顯式拒絕，不得被 v2 `research-program` silent reinterpret。

## Save v6 / checkpoints

- core wire固定v6。full保存`game`；compact保存`origin + normalized intentTrace + replayTicks + stateHash`；slots保存bounded full states。不得混入Research layout、contract或transform/orientation authority。
- full/compact/slots必須逐欄位重建ResearchProgram/shot、contract-free Pilot/Production、path/stroke catalog/layout及cold runtime；typed/runtime資料不得alias原物件。
- reader從raw origin + trace重算budgets後才semantic replay；不能信declared counters。full與slots也必須做raw work preflight及完整trace replay equivalence。
- v5顯式拒絕；unknown/missing fields、unsafe integers、invalid path/stroke、geometry/runtime forgery與unknown schema都顯式失敗，不建立legacy migration。
- 單blob≤5,000,000 characters；slots≤20；single head≤4,096 intents／100,000 ticks／100,000,000 work；rewind aggregate≤8,192 intents／12,000 ticks／100,000,000 work。
- corrupt/partial/disagreeing blob必須可見，Recover前不得刪改；Save/Load/Rewind不得踩壞原blob。Checkpoint UI lineage/recovery已整合；完整gate仍必須同時覆蓋core與browser workflow。
- checkpoint storage外層lineage envelope是獨立version 2，內層`head/history`仍使用Save v6 authority；不得因外層版本號而reinterpret內層schema。
