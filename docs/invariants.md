# Invariants（不變式總表）

## Research path core

- 每個 `Machine` 恰為 `{typeId,path}`；`path` 是 catalog 定義的完整 fixed `PathStamp`。
- UI、GameIntent、Save 與 Blueprint 都不得表示「只走完整 path 的一部分」。加入或移除 Research step 必須以整台 machine 為單位。
- 同 program、start 與 terrain 下，planning preview 和 execution 使用同一 pure traversal，逐 cell 與 portal discontinuity 相同。
- `ResearchProgram` 是 ordered machines；下一步從前一步的實際 endpoint 繼續。不得另存任意 anchor、auto-route 結果或 FactoryLayout。
- program 進 state、trace、save 前必須 canonical validate、own 與 freeze。

## Terrain、portal 與 fog

- Active Research 只有單層座標；跨層位置或交換層操作不得出現在 active program、palette、mapgen、Blueprint 或 Save v7 authority。
- Wall／OOB、Abyss、Swamp 與 Portal 各有 pure、deterministic、共享於 preview／execution 的語意。
- 每個 portal entry 恰有一個同層 destination；每個 destination 最多一個 entry。B 不可反向作 A；trail 在 jump 處斷開。
- Wall 不受探索遮罩隱藏，未揭露時仍必須可讀並影響 preview。
- Abyss、Swamp、Portal entry／exit、Cure與SideEffect只有揭露後才能出現在 renderer、planning map、region 邊界、hover、ghost 或 outcome UI；未揭露時等價於普通 substrate。
- planning、選工具、放置 program step、載入 Blueprint 或移動 camera 都不改 fog。
- 只有實際完成的 Research path segment 依 sensor radius 揭露；portal 不揭露兩端之間的直線。

## Map generation

- canonical seed + 完整 options 唯一決定 Atlas、terrain、portal、disease、price、difficulty 與 reference program。
- start 是 generator 宣告的中心 authority；開局 camera 聚焦 start，正常 viewport 只涵蓋世界的一部分。
- mapgen 禁 `Math.random()`／wall-clock；不依賴 Set／Map iteration side effect。
- radial progression + motifs constructive 產生可執行 reference program；solver 只供 tests/tools，不進 runtime 或生成 rejection loop。

## Research facility

- Research 只持有 Atlas fog、ResearchProgram、shot 與 last outcome；不持有 source／belt／sink routing 或 FactoryLayout。
- Research shot 必須有至少一個 step，開始時只扣一次完整 cost；中止、fail 或 no-cure 不退款。
- shot progress 只能向前；已完成的 segment 才能改 fog。編輯 program 時不得有 active shot。
- Research intent 不能寫 Pilot／Production layout、runtime、inventory 或 waste。

## Pilot Plant

- Pilot layout nullable；空 Pilot 不阻止玩家打開或編輯 Production。
- Pilot edit 不扣 cash、不推進 tick、不產生 inventory／waste，也不改 Research。
- Pilot diagnostics 是 bounded read-only analysis；no-cure、side effect、failure、deadlock 或低吞吐不是 layout rejection。
- 從 Pilot 建到 Production 必須走與直接 Production edit 相同的 paid `buildProductionLayout` authority。

## Production construction

- `createGameState` 必須建立 owned、non-null、24×12 空 Production layout 及相符的 initial runtime。
- Production 不依賴 Pilot state；玩家從新局即可直接提交合法 layout edit。
- `quoteProductionBuild(current, proposed)` 必須只按新增／改建內容計費：belt 2、splitter／merger 8、source 12、sink 6、machine `10 × def.cost`。
- 相同 tile 方向不收費；方向改變按新 tile 收費。機器 type／anchor／footRot 相同即已安裝，ID 差異不收費；移動／旋轉／換 type 按新機器收費。
- removal 不收費、不退款；報價必須是 non-negative safe integer。
- 現金不足或 layout 無效時，cash、layout、runtime、waste、trace 原子不變。
- 接受 edit 時只扣一次報價、own layout、建立相符的 initial runtime，保留累積 waste 與既有 inventory。
- paid build intent 不得與相鄰 layout intent 合併或從 replay trace 消失。

## Factory runtime 與 transport

- 只有 `productionTicks` 推進 runtime；Pilot diagnostics 永不增加 tick、inventory 或 waste。
- runtime layout identity 必須等於 Production layout；layout edit 後不存在舊在途 unit 或 cursor。
- transport topology 只由 tile accept／emit sides 和 rotated machine ports計算；方向錯誤的相鄰格不形成 edge。
- topology cell 的 incident mask 唯一決定 isolated／endpoint／straight／corner／tee／cross；machine port 的 connected flag 與 edge authority 一致。
- renderer 不得為視覺連續性虛構 sim 沒有的 connection；animation phase 只由 runtime tick 決定。
- Belt drag rasterization 必須保持四向相鄰；各格方向朝下一格，末格沿最後切線；一個 gesture 只產生一筆 editor history。
- factory area、unit、tick、diagnostic work 皆有顯式 bounds；熱 tick 禁 per-unit 配置。

## Whole-game authority 與 economy

- GameState 同時 own `research`、`pilot`、`production`，三者不得 alias layout 或以隱藏 token 耦合。
- Market 每個 inventory product 只可賣一次；收入由實際 cure、side effects、production cost 與 sold counters 決定。
- 同 origin + canonical intent trace replay 必須逐欄位與 hash 相同。
- 擴廠若清 runtime／waste，確認前全部 authority 原子不變；解鎖不得中止 active Research shot。

## Blueprint v3

- document／ruleset 固定 version 3，checksum 是 canonical blueprint payload 的 lowercase SHA-256。
- Research kind 只能是 `research-program`，payload 只能有 ordered `{typeId}`；不得存 path cells、FactoryLayout、fog、seed、outcome 或 economy。
- Factory kind 只能是 `factory-layout`，payload 是 dimensions、sparse routing 與 `{id,typeId,anchor,footRot}`；不得存來源場域、fixed content、diagnostics、runtime、inventory、waste 或 economy。
- strict decoder 必須拒絕 unknown／missing fields、wrong kind/version/content/checksum、unknown type、duplicate IDs/tiles、collision、越界與 quota violation。
- Library namespace/lifecycle 與 save slots 分離；Load／Rewind／換 slot 不改 Library。舊文件不得 silent reinterpret。

## Save v7 與 checkpoints

- full／compact／slots／rewind 都使用 Save v7，逐欄位重建 Research、nullable Pilot、non-null Production、fixed path、layout 與 cold runtime；typed/runtime data 不得 alias。
- compact reader 在 semantic replay 前先驗 raw ticks／intent count／work caps，之後比對 canonical trace 與 state hash。
- `buildProductionLayout` 的費用與次序是 replay authority；不能只保存最後 layout 而漏掉 cash 歷史。
- decoder 對 unknown／missing fields、unsafe integers、invalid path/layout/runtime、oversize 與 replay forgery 顯式失敗；舊 schema 不 migration。
- checkpoint lineage 外層 version 2 與內層 Save v7 是兩個獨立版本；不得交叉 reinterpret。
- corrupt blob 不得被空/default game 偷換；Recover 前保留 raw data，且 recovery 原子。
