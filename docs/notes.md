# Notes

> Tacit knowledge an agent can't infer from reading code.

## Gotchas

- **真人測試 / demo server 綁 `0.0.0.0:53346`**：使用者在 Oracle Cloud 上**只對這個 port 開了白名單**，其他 port 從外部連不上。Vite dev/preview：`vite --host 0.0.0.0 --port 53346 --strictPort`。`--strictPort` 確保 port 被佔用時直接報錯，而非靜默換 port（換了使用者就連不上）。
- **效果結果只看「機器序列 + 各機器朝向」**，與 belt 佈局完全無關。任何「重排優化」必須保持每台機器朝向 + 單顆處理順序不變，否則效果會變。
- **sink 交付的是物理藥，不是 recipe count**：成品必須攜帶實際 `DrugState`、`Outcome`、實際機器成本；失敗/無療效丟棄，一顆多療效成品售出後整顆移除，禁止靠原 recipe 憑空鑄造庫存。
- **現行 economy 沒有訂單**：反退化來自各疾病各自的 sold counter／售價遞減與隨機關卡，不要在 UI、save 或文件杜撰 order/demand scheduler。
- **difficulty price 用精確 rational，不用浮點 pow**：公式是 `roundHalfUp(10 × (17/10)^d) + 3 × refCost`，以 BigInt 分子/分母計算並拒絕 safe-integer overflow。d=0..58 保持舊輸出；這是 determinism 修正，不代表完成人工平衡。
- **機器速度是 catalog 資料**：palette 只顯示固定速度，玩家不得任意輸入 speed；吞吐優化靠並聯、routing 與空間打包。
- **危險區 = 路徑判定，不是落點判定**：掃動路徑**經過**任一危險格 → 整顆失敗變廢料；療效/副作用則只看**最終位置**。兩種判定別搞混。
- **牆是停點不是失敗**：掃動遇牆 → 停在牆前一格（可當精準卡位用，像 Potion Craft 拿骨頭）。
- **scale 用有理數（分子/分母），不要用 float**：浮點累積誤差會破壞跨機確定性與離散決策。格子座標/物品數/tick 一律整數。
- **swap 是純 relabel**：不掃動、不會失敗、需 ≥2 圖。
- **固定 e2e baseline 是工作成果的一部分**：`toHaveScreenshot` 的 expected images 在 `test/e2e/*.spec.ts-snapshots/`，必須和相關 UI 變更一起納入最終 diff/交付；不要在尚未 commit 的工作樹宣稱「已提交」。`test/e2e/__screenshots__/`、`test-results/`、`playwright-report/` 都只是輸出 artifact。
- **CLI parser 不用 `parseInt` 寬鬆吃字串**：`npm run sim gen|run <seed>` 以完整 argument 轉數值，只接受 safe integer uint32；`14junk`、`1.5`、空字串、負數、`4294967296` 等都報錯，`-0` 統一為 `0`。`npm run balance [count]` 的 practical cap 是 100,000 seeds；所有 API/CLI 入口在配置 seed loop 前 fail-fast，不能先跑部分 sweep。
- **求解器絕不進 production dependency graph**（D14）。建構式 mapgen 自己保證 reference 可解；solver 只在 tests/tools 驗證 soundness、解耦與平衡，更不能接成遊戲內「一鍵解謎」。
- **完整/compact都先驗raw work**：full wire ≤5,000,000 chars才round-trip；合法24,500-item state可超wire cap。compact與full `deserializeGame`都從raw origin+intentTrace算work後才replay；single state ≤4,096 entries/≤100,000 ticks/≤100,000,000 work。Factory tick charge 是 `area + 4×(carriers+machines) + (carriers+machines+sources)²`，另計 cold/layout 與 `saveRecipe` 的 outcome analysis。正常`24×12` Pilot reference的100,000-tick trace約85,313,612、緊密佈局的24,500-inventory流程更低。
- **rewind aggregate共用**：phase常數為12,000 ticks/8,192 entries/100,000,000 work。compact、`serializeSlots`與`deserializeSlots`同界；deserialize在任何`parseGameState`前驗整段raw，serialize也先驗。legacy storage先history preflight，必要時才head-alone，不能用5,000,000-character full slots繞過。compact另限20/1,250,000 chars且不prune head。
- **rewind timeline 不是任意 snapshot 清單**：同槽 history 必須同 origin 並形成 trace lineage。因 canonical normalization，較後 snapshot 的最後一筆可延伸 `factoryTicks`、同疾病 sale ID prefix，或以新 `setFactory` 取代舊 layout。把另一個 run/branch Save 到已佔用 slot 時必須明示 replace 舊 timeline，不能混出跨 origin rewind；unit test 要守 mixed-slot replacement。
- **legacy 雙 key 只能驗證 timeline 後 migration**：舊 `hexapharma.save.slot.*` / `history.*` 除各自反序列化與head/latest一致外，history也必須同origin、符合normalization-aware trace lineage。mixed legacy timeline不從migration path throw：回可見invalid result；若head有效，只提供clean head-only recovery。migration不刪legacy原文。corrupt/partial/disagreeing blob在玩家按Recover前不刪不覆寫；Load不改目前game，Save/Rewind也拒絕踩掉。只有valid legacy會自動寫canonical key，或明按Recover才覆寫。
- **effect orientation ≠ footRot**：Factory 的 effectRot/effectFlip 會進 machine `def.orientation`，footRot 只旋轉 footprint/ports；複製 recipe stage 做並聯時兩者都要各自正確。
- **FactoryLayout immutable、FactoryRuntime mutable且綁 authority identity**：factory-sim 依 layout identity 用 WeakMap 冷編譯 geometry/index；runtime 的 unit/drug/proc/cost、occupancy/target/move scratch、per-splitter cursors 與 product events 都是固定 SoA TypedArray，並綁定 init/restore 時的 layout + `MultiMap` identity。即使另一份 map 欄位/count相同也不可交給既存 runtime。splitter只收 `inDir`、cursor per tile round-robin；merger只收 `inDirs`且依陳列順序固定優先。cursor必須進 snapshot/hash/save。編輯 layout 必須建立新 identity；成功 `stepFactory` 熱 tick只原地更新。`FactoryState`是save/replay/debug **以及 whole-game ownership clone** 的cold snapshot/restore。
- **Game reducer 必須隔離 mutable runtime**：每個有效 `factoryTicks` intent 都先 `snapshotFactory`→`restoreFactory` 做 cold ownership clone，再批次 step；每 tick 直接讀/清固定 event buffer。這使舊 `GameState`、history 與 replay initial 不被 alias 污染。抵達 sink 時建立永久 inventory/Outcome 是 Game 的領域輸出邊界，不可把它誤稱為 factory tick 的 temporary allocation。熱路徑證據是 source/static allocating-syntax guard + 長跑 buffer identity/mass/routing tests。
- **UI 不得顯示 stale authority 或吞錯**：Lab編輯/Run/Reset/換level時清outcome；Factory分標total sink outcomes與Game waste。diagnostic除≤100,000 ticks外另有100,000,000 work cap，init/tick前以`(area + machines + sources)² × observationTicks`fail-fast，避免合法大layout在同步`useMemo`鎖UI；exception顯示`factory-analysis-error`。真正throughput deadlock是有效`0/1`且兩個bottleneck欄位皆null，不能把永久卡住機器誤標成瓶頸。Shop Sell all單一intent ≤100,000 IDs（inventory ≤24,500）；dispatch用latest-state ref，reducer/save/storage failure全顯示。
- **保留 mounted 不等於保留 active**：Game 為保存 camera/tool state 會保留已造訪 view，但 hidden Lab/Factory 絕不能繼續接 window gameplay keys；每個 handler 必須受 `active` guard。Factory pointer/wheel handler 只掛在 canvas frame，不可掛在包含 transport/hotbar 的 world section，否則矮螢幕點 chrome 會穿透建造、wheel 也會搶走工具列捲動。pointercancel 只取消、不可提交半成品。
- **Pixi 多 Application teardown 不可傳 `true`**：`app.destroy(true)` 會要求 renderer `releaseGlobalResources`，清掉其他/下一個 Application 共用的 TexturePool；React StrictMode async mount 會因此在 Text unload crash。先銷毀 label children，再用 `app.destroy({ removeView: true })`，不要釋放 global pools。
- **renderer 是真正 code split 且失敗可見**：Lab/Factory 對 Pixi renderer 使用 `await import()`；載入/初始化失敗要顯示 Lab/Factory error，不能空白 canvas 靜默繼續。禁止用會打亂 Pixi 類別初始化順序的手動 vendor groups，也禁止只調高 chunk warning threshold。`npm run check` 內的 Playwright production-preview project 會先 build、在 `127.0.0.1:53348` 實際切四個 tab 驗 lazy chunks 與 pageerror/console.error；一般 Chromium e2e 用 dev `:53347`。Playwright 預設 headless，CLI 不要加額外 headless flag；真人 playtest 仍只用 `0.0.0.0:53346`。
- **Lab 大圖是局部鏡頭，不是縮小全景**：每張地圖預設 `63×63`，Lab canvas 固定 `704×512`，100% 約看 `17×13` 格；drag pan、wheel anchor zoom、`F` follow，A–D tabs 一次只顯示 active layer並保存各自camera。renderer依可見cell bounds cull；production-preview直接載最大`64×64` authority。禁止回退成2-column全圖、動態縮cell或≤980全景。
- **Layer start 與 Phase Exchange**：A 的 start/origin 位於正中央；B/C/D 共用中心 origin，但使用 deterministic near-center phase offsets。單層時 A↔B Phase Exchange 鎖定；B 解鎖後交換 A/B 的實際座標，因此不是沒有作用的0/1圖切換按鈕。internal type id `swap01` 只為資料/存檔身份，玩家文案用 Phase Exchange A↔B。
- **map patent 是 deeper-level reset，不是 append**：`new-map` / `new-map-4` / `deep-map-4` 會把 nMaps 1→2→3→4、seed +1、維持`63×63`並重生整個目前 level；清 recipe/factory/runtime/waste/inventory/fog **與 `economy.sold`**（reveal-aid 會套到新 fog），保留扣款後 cash/R&D、patents 與全域 inventory ID 序列。Patents UI 必須完整列出破壞範圍並要求 confirmation，不能單擊即清。
- **Lab atlas 不得洩霧或偷用競品素材**：`public/assets/lab/manifest.json` 是 substrate/fog/六種world sprites 的 runtime contract，旁邊 `README.md` 記錄原創生成來源與權利。先以opaque fog遮住unknown，只有revealed terrain才畫substrate/features；資產載入失敗須顯示renderer error，不能靜默退回debug格或「?」。
- **Recipe preview 不能另寫一套效果引擎或洩霧**：`drug-graph.previewStep` 與 `applyStep`/`revealAlong` 共用逐格 sweep authority；UI 只 fold 成 frames/trails/failedStep。候選插入或 drag reorder 要重算完整後續序列，swap 前後斷線。public preview 將 unknown cell feature 正規化，首次進入 unknown 即停止公開該步與 downstream，回 `uncertainStep`；hidden empty/wall/hazard 必須 indistinguishable，不能用紅卡、提早牆停或 ghost 偷渡答案。
- **早期開發不維護跨 build 存檔**：Save／Load／Rewind 的 correctness 是同 content build 契約。地圖、schema、經濟或 sim 語意改動可直接使舊 localStorage 失效或要求清除，不建立 legacy generator／migration chain。測試中的 `legacy` 指目前 storage layout reader，不是歷史 build 支援承諾；詳見 [development-policy.md](development-policy.md)。
- **map scatter 比例也是整數規則**：wall/hazard/side-effect counts分別用 `floor(len×4/100)`、`floor(len×3/100)`、`floor(len×5/100)`；不要改回 `0.04/0.03/0.05` float，即使目前輸出看似相同。
- **authority inputs 要 owned + frozen，public/Game bounds 不可混寫**：whole-game reducer 會 canonical clone/deep-freeze `GenOptions`/catalog、Template、FactoryLayout 與 nested transform/shape/ports，再依 owned options identity 快取 seed-pure `GeneratedLevel`；caller 後續 mutation不得改 state/trace/cache。共享 `DEFAULT_CATALOG`、`DEFAULT_SHAPES`、`DEFAULT_PATENTS`也 deep-freeze。seed只收uint32，`-0` canonicalize為`0`，map patent `+1`明確uint32 wrap。public mapgen area ≤65,536，但 Game map ≤64/side、≤4,096 cells（renderer-safe，production max-map preview守住）；public factory area ≤65,536，但 Game factory ≤256/side、≤4,096 cells。template ≤256 steps、inventory ≤24,500、bulk sale ≤100,000、cumulative factory ticks ≤100,000、Game weighted replay ≤100,000,000；每 shape cells/inputs/outputs ≤256、aggregate shape cells ≤area、aggregate input/output ports各 ≤262,144。`sideEffectId` 是 `Int32Array`，不能降回Int16。
- **工廠尺寸由 Game/patent 授權**：沒有 saved recipe/既存 factory 時，手建 `setFactory` 必須恰為 base `24×12` 加目前 expand-patent delta；有既存 layout 後只能同尺寸編輯，只有解鎖 expansion patent 能改尺寸。不要讓 UI 自己改 entitlement，也不要保留舊尺寸作 bypass 選項。
- **patent helper 不是 tolerant parser**：`canUnlock`/`unlockPatent`/`activeEffects`會驗tree、effect、state順序、unknown/duplicate IDs、cash/research safe integers；`activeEffects`累加factoryDw/factoryDh/revealAid也做checked safe-integer add，aggregate overflow必須throw，不能略過或帶著失真Number繼續。

## Decisions

完整決策表（D1–D18，含推翻條件）見 [decisions.md](decisions.md)。幾條最容易被「好心改掉」的：

- **為什麼是 TypeScript 而非 C#/Unity**（D2）：此規模效能非瓶頸；TS 對 AI agent 友善、純 CLI/headless 工具強；有 hook 時 worktree 隔離，shared-tree runner 則只平行 disjoint files。sim core 是純邏輯，日後要換語言/渲染只重寫薄層。
- **為什麼正方格**（D8）：效果圖方向需與工廠物理方向對齊 → 同一種格子；工廠主導 → 正方形；旋轉/flip 四態最好預測、AI 最不易錯。
- **為什麼型別一開始支援多圖、玩家卻先從單層開始**（D7）：core/mapgen 從一開始支援 N=1–4，避免把跨圖語意事後硬接；玩家新局先在A層學探索與變換，再用專利逐步解鎖B/C/D，把跨圖拉扯當成進程展開而非開場認知負擔。
- **為什麼建構式生成而非暴力枚舉**（D12）：先構造一條保證存在的多圖解，再沿路徑長特徵 → 可解性由建構保證；seed + 完整 GenOptions 即關卡身分，堵死抄藍圖。
- **退路**（D7）：若 Phase 1 玩測發現 novel 移動模型不好玩/太難，退回「單機序列決定路徑、物理只管吞吐」的傳統 BP 模型——這是資料/設計層調整，不動三層架構。
