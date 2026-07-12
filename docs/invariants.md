# Invariants（不變式總表）

> 自動閘的脊椎。每條不變式都應有對應的 property/unit test；高頻 tick assert 在 debug build 啟用，init/restore/save 等不可信冷邊界在 production 也必須驗證。
> 違反不變式的 bug 一律以 `seed + tick 區間 + input trace` 回報，並指出壞掉的 tick。

## drug-graph（分子 / 多圖效果系統）

- **變換正確性**：translate 掃動 + 牆停 + 危險即死；scale 以固定有理比例往各圖原點拉；swap 交換兩圖位置。
- **朝向正確性**：旋轉 4 次 = 原狀；flip 兩次 = 原狀；旋轉/flip 對平移類變換施加正確。
- **療效判定可重現**：逐圖「最終位置」判定 deterministic、可重現。
- **重排不變**：保持每台機器朝向 + 單顆處理順序 → 各圖最終結果不變（與 belt 佈局無關）。
- **防抄性質**：多數藥方下，把所有平移步驟同步 +90° 會改變結果（藍圖無法無腦旋轉復用）。

## mapgen + solver

- **建構即可解**：生成器先選定 reference 機器序列、重播並保護逐圖路徑，再於端點放 cure，最後才在受保護路徑外長出牆、危險區與副作用；可解性由建構本身保證，production `mapgen` 不依賴求解器。
- **生成輸入 authority**：`GenOptions.seed` 必須是 uint32 `0..0xffffffff`（`-0` canonicalize 為 `0`），public mapgen 單圖 area ≤65,536、difficulty max ≤64、catalog ≤256 entries；進入 `GameState`/renderer 的 map authority 另限每邊 ≤64、每圖 ≤4,096 格。其他圖數/尺寸/疾病數/難度帶皆為合法 safe integer且範圍一致，catalog ID 唯一，cost/speed/transform 參數合法。fractional/unsafe/會被 RNG 截斷成別名的 seed 與未知輸入須在生成起點明確拒絕；Lab canvas 固定 `704×512`，不得為了顯示全圖而縮小，renderer只畫active layer與camera可見cells。production preview覆蓋最大`64×64` Game authority。
- **工具輸入邊界**：`npm run sim gen|run <seed>` 必須把完整 seed argument 解析成 uint32；空值、尾隨垃圾（如 `14junk`）、fractional、負數、unsafe/超界皆 fail，`-0` canonicalize 為 `0`。balance sweep count 必須是 `1..100,000` safe integers；超限在進 seed loop 前 fail-fast。
- **生成確定性**：同 build、同完整 `GenOptions`（含 seed）→ 逐欄位相等的地圖（含每圖原點）+ 相同難度分與藥價。牆/危險/副作用 scatter counts須以明示整數 rational `4/100`、`3/100`、`5/100` 向下取整，不用 float 比例參與離散決策。
- **feature ID 寬度**：`EffectMap.sideEffectId` 必須是 `Int32Array`，生成/clone/save/replay 不得降回 `Int16Array` 而把合法正 ID 靜默截斷。
- **難度界限**：難度分落在設定區間內（不無腦、不需荒謬機器數）。
- **定價一致 / 精確性**：基礎藥價 = `roundHalfUp(10 × (17/10)^difficulty) + 3 × refCost`；以 BigInt rational 精確計算、結果須為 safe integer，不得依賴浮點冪次。d=0..58 與舊曲線輸出相同；這是確定性修正，不宣稱人工平衡完成。
- **求解器健全（soundness）**：回傳非 null 的解，確實治到目標且全程未失敗。
- **中心與 phase 起點**：任意合法尺寸下 Layer A 的 start/origin 都是 `floor(width/2), floor(height/2)`；後續 layers 共享該 origin，但 start 使用互異、界內、靠近中心且只由 layer index/尺寸決定的 phase offset。預設 `63×63` 起點依序為 A `(31,31)`、B `(38,31)`、C `(31,38)`、D `(24,31)`。同一生成輸入必須逐欄位重現。
- **單層先行與跨圖張力**：mapgen 必須接受 N=1，且任意 N 都不得靠角落全牆或強制 reference 使用 `swap01` 才保證可解；多圖關卡至少保留一個不含 phase swap 的合法 reference。A↔B Phase Exchange 在 N=1 不得出現在可用 UI catalog；N≥2 才可用，並因 phase start 不同而確實交換兩個不同座標。求解器仍只在 tests/tools 作 oracle，不得由 production `mapgen` import 或在 runtime reject-until-valid。
- **探索遮蔽**：新局每張圖以 start 為中心揭露 Chebyshev radius 3（預設 `7×7 = 49/3969`）；實驗與 reveal-aid 可持久擴張。unrevealed cell 必須由 opaque fog texture 完全遮住，不能畫「?」或先畫 feature 再半透明蓋色而洩漏內容。UI 收到的 fog layer 數或 cell 數不符 authority 時必須顯示錯誤，不得靜默退回 mapgen 的全暗 fog。

## factory-sim

- **質量守恆**：每 tick，流入 = 流出 + 在途 + 庫存增量。
- **runtime 質量式**：任何成功 tick/snapshot/restore 後，`nextUnitId === unitCount + producedTotal`；active unit 與當 tick product event 的 ID 各自嚴格遞增且不重複。
- **不憑空生滅**：無物品憑空生成或消失；merge/split 不複製、不吞物品。
- **實際成品**：sink 輸出保留該單位的實際 `DrugState`，且 `productionCost` 恰為它實際完成處理的機器成本總和；不得用 Lab recipe 或產出 count 代填結果。
- **catalog 權威**：玩家建造的機器 cost/speed 取自已解鎖 catalog；UI 不得讓玩家任意改 speed 來消除瓶頸。
- **effect orientation 與 footRot 分離**：玩家新增並聯機器時能明確設定藥物 transform 的 rotation/flip；footRot 只負責 footprint 打包，不得把兩者混用。
- **零配置成功熱 tick**：同一 immutable `FactoryLayout` 只冷編譯一次 geometry/index；`FactoryRuntime` 的 unit/drug/proc/cost、occupancy/target/move scratch、splitter cursors 與 product-event buffer 全部固定容量預配置。正常 `stepFactory` 不得建立 object/Array/Map 或 immutable clone；layout 編輯必須以新 identity 使 cache 失效。驗證採熱 call graph source/static guard + 長跑 buffer identity/mass/routing tests。init/snapshot/restore/throw、whole-game ownership clone 與永久 inventory 物化是明確冷邊界。
- **runtime authority identity**：`FactoryRuntime` 必須綁定 `initFactory`/`restoreFactory` 時的 immutable `FactoryLayout` 與 `MultiMap` object identity；`stepFactory` 收到另一份 layout/map（即使欄位或 map count 相同）必須顯式拒絕，禁止混用 authority。
- **routing state/方向**：splitter 只收 `inDir`，成功離開時依該 tile 的 round-robin cursor 從 `outDirs` 選路；merger 只收 `inDirs`，同 tick contender 按 `inDirs` 陳列順序固定優先。per-splitter cursor 影響未來行為，必須進 runtime、cold snapshot/restore、hash、Save v4 且範圍合法。
- **空間與 authority bounds**：public factory-sim area ≤65,536；Game factory 另限每邊 ≤256、總計 ≤4,096 格。machines ≤area、每 shape 的 cells/inPorts/outPorts 各 ≤256、aggregate shape cells ≤area、aggregate input/output ports 各 ≤262,144；hot runtime capacity 精確等於 carrier tiles + machines，不為空地配置 unit slots。active belt unit 必須在界內、位於 carrier tile且每格最多一顆，每台機器最多持有一顆。restore 即使在 production 也不得靠 TypedArray 靜默截斷非法值。
- **死鎖/分析 exhaustion 可見**：有界buffer下能偵測並標記死鎖tick。diagnostic最多100,000 ticks且layout-weighted work ≤100,000,000；`factoryOutcome`/`analyzeThroughput`必須在任何init/tick前驗`(area + machines + sources)² × observationTicks`，safe-integer/上限失敗即throw。`factoryOutcome`遇deadlock/首產品exhaustion不得偽裝藥物failed；`analyzeThroughput`對真deadlock回`0/1`且`bottleneck`/`bottleneckType`皆為`null`，不得把永久卡住的機器誤標為瓶頸；window/work無法bounded判定才throw。serpentine throughput守20×20成功/21×21拒絕；outcome守20×20成功/22×22拒絕（21×21 outcome仍低於cap）。Factory UI把exception顯示成`role="alert"`。
- **吞吐一致性**：分析成功時，穩態產出速率 = 瓶頸機器速率。
- **確定性**：同 build + seed + input → replay 兩次 hash 相同。

## whole-game state

- **無憑空鑄藥（no mint）**：只有 sink 實際交付且未失敗、至少治一病的實體成品能進庫存；source→sink、錯機器/順序與 sticky failure 都不能冒充保存的 recipe 產物。
- **單顆單售**：庫存按 physical product id 記錄；一顆多療效藥只能選一個疾病市場賣一次，成功出售後必須移除。單售與 bulk sale 對未知疾病、不存在／已售／重複產品或錯誤療效都必須原子地顯式拒絕，不得把非法 intent 當成 no-op。
- **完整 intent replay**：同初始state+intents→逐欄位/hash相同；trace ≤4,096、factory ticks ≤100,000、weighted work ≤100,000,000。正常`24×12` Pilot reference的100,000-tick trace約85,313,612，緊密佈局的24,500-inventory流程更低。no-op省略，連續ticks/layout/same-disease sales正規化；`replayTicks`恰等raw trace總和。
- **reducer 不 alias**：mutable factory runtime 只能由新回傳的 `GameState` 擁有；每個有效 `factoryTicks` intent 必須先由 cold `FactoryState` snapshot→restore clone，apply/replay 不得改動呼叫者傳入的舊 state/history。`FactoryState` 因此不只用於 save/replay/debug，也用於 whole-game ownership boundary。
- **逐 tick 不漏貨**：multi-tick intent 每一 tick 都直接 drain 固定 product-event buffer且恰收一次，再清空；不得只看 batch 最後一 tick，也不得在 save/load 後重收。
- **intent authority/ownership**：儲存藥方必須由 core 驗證為非失敗且至少治一病；template ≤256 steps；inventory ≤24,500 physical products；bulk sale 為 1..100,000 個不重複、可售的 physical product IDs；tick batch 必須是非負 safe integer。`factoryTicks: 0`是合法 no-op，但正數 ticks 必須已有 authoritative factory layout，否則顯式拒絕。無 recipe/既存 layout 時，手建 `setFactory` 尺寸必須恰為 base `24×12` 加已解鎖 patent expansion；已有 layout 後編輯只能維持既存尺寸，只有 patent reducer 能擴張。鎖定/未知機器、篡改 catalog 定義、非法方向/source period、重複 ID、越界/重疊/壓 tile footprint 必須在 intent 邊界拒絕。進入 state/trace 的 `GenOptions`、catalog、Template、FactoryLayout（含 nested transform/shape/ports）須 canonical clone + deep-freeze；`DEFAULT_CATALOG`、`DEFAULT_SHAPES`、`DEFAULT_PATENTS` 也須凍結。sink 收集不是可由外部注入的 intent。
- **patent authority**：public `canUnlock`、`unlockPatent`、`activeEffects`都必須先驗tree/state；unknown/duplicate node或unlocked ID、prerequisite cycle/order錯誤、非法effect、unsafe cash、負/unsafe research都要顯式拒絕。`activeEffects`累加`factoryDw`/`factoryDh`/`revealAid`時須checked safe-integer add，aggregate overflow顯式throw，不得略過或讓Number失真。
- **deeper-level 破壞範圍**：map patent 必須清 recipe/factory/runtime/waste/inventory/fog 與 `economy.sold`，保留扣款後 cash/R&D、patents 與全域 next inventory ID；Patents UI 必須先完整警告並要求 confirmation，不能單擊即破壞。

## economy

- **經濟輸入 authority**：價格、疾病 ID、成本、扣分、R&D 與 sold counters 都必須是範圍合法的 safe integer；stored sold entries 為正數且 disease ID 唯一升序。不得以 fractional/Infinity/負成本觸發隱式 rounding、長迴圈或溢位。
- **帳務守恆**：現金變動 = 收入 − 支出。
- **庫存非負**。
- **實際結算**：成本取自售出物理成品的累計 `productionCost`；副作用扣分取自其實際 `Outcome.sideEffects`，不得固定為 0 或取原 recipe 推定值。
- **研發守恆**：每次合法售出恰增加 1 R&D；解鎖專利恰扣除節點的 cash + researchCost。
- **反退化**：各疾病的 sold counter 確實讓該單品收益遞減（狂產單一藥物 ≠ 簡單最佳解）；現行經濟沒有訂單或 demand scheduler，不得把不存在的訂單狀態寫進 authority 說明。

## save

本節只約束**目前 content build 內**的 save correctness，不構成跨 build 相容承諾。早期開發可直接淘汰舊 checkpoint；見 [development-policy.md](development-policy.md)。

- **兩種 wire 邊界不可混稱**：只有當 materialized full wire ≤5,000,000 characters 時，完整 Save v4 API 才保證 `deserializeGame(serializeGame(state))` 深等於全 `GameState`（live runtime以cold `FactoryState` snapshot round-trip）；超限必須顯式拒絕。合法Game authority（例如24,500-item inventory）可能full wire超過5,000,000 characters，不得因此稱state非法。localStorage checkpoint v2 retained entries使用compact replay authority，只存self-declared `origin`、canonical normalized `intentTrace`、`replayTicks`與non-cryptographic `stateHash`；authority replay後仍須重建逐欄位等值的recipe、runtime/cursors、inventory/outcome/cost、fog、economy/R&D、patents、IDs與RNG。
- **語意 authority / provenance 邊界**：compact與full `deserializeGame`皆須從materialized raw的origin+intentTrace重算ticks/work，通過才semantic replay；不得信declared metadata。full load仍拒絕非canonical/偽造/runtime不相容state；hash只證declared-origin reachability。
- **rewind aggregate不可繞過**：phase共用≤12,000 ticks/≤8,192 entries/≤100,000,000 work。compact checkpoint、`serializeSlots`、`deserializeSlots`皆同界；`deserializeSlots`在任何`parseGameState`前inspect整段raw，serialize也先驗aggregate。legacy read先history preflight，必要時才head-alone。single head仍受100,000/4,096/100,000,000，compact另受20/1,250,000 chars；head不因history pruning移除。
- **可見錯誤、不靜默覆寫**：reducer intent rejection、invalid save、corrupt/partial/disagreeing checkpoint 與 storage failure都要顯示錯誤，不得 crash/靜默繼續。玩家按 Recover 前不得刪或覆寫原 blob；Load 遇錯誤不得改目前遊戲或壞 checkpoint，Save/Rewind 也不得踩掉它。legacy migration也必須驗同origin、normalization-aware trace lineage；mixed legacy timeline回可見invalid result與clean head-only recovery，不得從migration path throw或保留跨run history。只有完整驗證成功的legacy timeline可migration（legacy原文仍保留），或玩家明確按Recover才覆寫canonical checkpoint。
