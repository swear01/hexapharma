# Decisions（技術決策紀錄）

> 記錄關鍵決策、理由、以及「什麼情況會推翻」。
> **可逆性備註**：D5 的 sim core 與 D2/D3/D4/D9 解耦、是純邏輯；換語言/換渲染只需重寫薄層，core 不動。

| # | 決策 | 主要理由 | 什麼情況會推翻 |
|---|---|---|---|
| D1 | 純 code-as-truth（不靠引擎視覺編輯器/scene 檔） | 工廠內容是資料非場景；無 scene = 無「編譯/測試守不住的盲改面」；AI 編輯效率最高。 | 改做大量手工關卡/手感美術重的非工廠類遊戲。 |
| D2 | TypeScript（而非 C#/Raylib、Godot、Unity） | Potion Craft 級效能出局；TS 對 AI 熟悉、純 CLI/headless 工具強，有 hook 的環境可使用 worktree 隔離。 | 規模升到百萬實體沙盒；或邏輯 bug 率高到需更硬編譯閘（→ 轉 C#，core 可移植）。 |
| D3 | PixiJS v8 渲染（非 Phaser） | 純 renderer、顯式 loop、無框架隱藏狀態、附 agent skills。 | 需大量開箱即用 scene/physics/input、願換掌控度 → Phaser。 |
| D4 | React/DOM 做 UI（疊 canvas） | 本作 UI/互動重；React 生態與 AI 熟練度最佳。 | UI 極簡到不值得引入 React（本作不太可能）。 |
| D5 | 確定性 tick-based sim + 不變式 | replay 除錯、存讀檔正確、跨 agent 可重現 bug、隨機地圖可重現；把形式驗證優勢變自動閘。 | 無（地基）。 |
| D6 | 模組邊界即編排單位；可用時以 worktree 隔離，不可用時只平行不相交檔案並由 integrator 序列化共享面；MCP 不上主路徑 | 衝突來自共享可變面；純 CLI 閘最穩，隔離能力不應被文件假設為永遠存在。 | 無，除非未來 MCP/編輯器整合成熟到不犧牲平行性。 |
| D7 | 效果地圖=成分（PC 基底）、多圖並存（N 目標 4，驗證先 2）；機器=變換（translate/scale/swap）、位移由機器自身朝向決定、繞線不貢獻；四特徵；療效只看各圖最終位置；逐格掃動 | 跨圖拉扯才是 BP 核心（副作用深度來源）；同時自洽防抄旋轉、工廠可重排配平、研究室人類解謎。 | Phase 1 玩測發現不好玩/太難 → 退回「單機序列決定路徑、物理只管吞吐」的傳統 BP 模型（資料/設計層調整，不動架構）。 |
| D8 | 格子=正方形（工廠與效果圖統一） | 兩格子方向需對齊→同格子；工廠主導→正方形；旋轉/flip 最簡、AI 最不易錯；Shapez 即正方形。 | 無強誘因。 |
| D9 | 美術=平面俯視正交（Shapez 極簡風） | 偏好；無等軸深度排序、渲染更簡；與正方格契合。 | 無。 |
| D10 | 固定 catalog cost/speed；吞吐配平；基礎價 = BigInt exact `roundHalfUp(10×(17/10)^difficulty)+3×refCost`，solver離線稽核 | 指數進程定價且跨平台整數確定；d0–58 保持舊輸出。本次由float改rational是正確性修正，不冒充人工平衡。 | 玩測後可調曲線參數；公式仍須 exact rational + explicit rounding。 |
| D11 | 機器「物理→效果方向」異質分類（順/逆/垂直/偏移，含逆向機器）；一開始只放幾種 | 讓藍圖無法無腦旋轉/復用（異質混合下無單一剛性變換可搬目標）。 | 玩測太雜難推理 → 縮小分類（甚至只留順/逆）。 |
| D12 | 程序化隨機地圖：建構式生成為主 + 難度評分；seed + 完整 GenOptions = 關卡身分；存檔保存目前生成設定 | 堵死抄藍圖/跨關卡復用；可解由建構保證；難度由評分保證合理且驅動定價；強化反退化。 | 無強誘因；可調「保存單一目前關卡」vs「每局重生」。 |
| D13 | 無世界地圖：成分=基底=原料=地圖（PC 模型）；探索=揭當前地圖迷霧；解鎖=拿新地圖 | 忠於 Potion Craft；少一套系統；探索與核心循環綁定。 | 無。 |
| D14 | 求解器僅供 tests/tools 的 soundness、解耦與平衡稽核；production mapgen 以建構保證可解且不 import solver；不做遊戲內自動解 | runtime 搜尋既不必要；自動解更會殺樂趣、違反反退化精神。 | 無。 |
| D15 | Full Save v3僅在wire ≤5,000,000 chars時round-trip；checkpoint用compact authority。所有單一Game authority/head都受 ≤4,096 entries/≤100,000 ticks/≤100,000,000 weighted work；rewind aggregate共用phase常數 ≤12,000 ticks/≤8,192 entries/≤100,000,000 work，compact另受≤20/≤1,250,000 chars。compact inspector與full `deserializeGame`都從raw origin+intentTrace算work後才semantic replay；`deserializeSlots`在任何`parseGameState`前驗整段aggregate，`serializeSlots`也同界。legacy read先preflight history，必要時才head-alone。timeline同origin且允許ticks/sale/`setFactory` normalization；跨run Save明示replace。 | 同時封住compact與5,000,000-character legacy full wire的replay-work繞路，不讓materialized大小誤判合法authority，也不因entry/tick少而低估大map/layout。正常100,000-tick reference約31,000,000、24,500-inventory流程更低，100,000,000仍容納正常進程。head不因history pruning移除；stateHash不是外部trust。 | 若導入簽章/帳戶trust或正式migration framework再設計；仍保留declared-origin reachability、raw preflight與timeline lineage。 |
| D16 | `unlockMap` 是進入下一個 deeper level：nMaps +1、uint32 seed +1（wrap）、依 N 重設尺寸並重生整組地圖；清 recipe/factory/runtime/waste/inventory/fog 與 `economy.sold`，保留扣款後 cash/R&D、patents 與全域 inventory ID | 現行存檔只保存一份目前 level；明確 reset 比把不同 seed/dimension 的 maps 拼在同一 identity 更可重現，舊疾病銷量也不能污染新 level。UI 在解鎖前完整列出破壞範圍並要求二次確認。 | 若未來加入世界/關卡選擇與多 level inventory，再改成保存多份 level state；須連同 save schema/經濟一起設計。 |
| D17 | Factory 用 mutable fixed-capacity SoA `FactoryRuntime` + 固定 product-event/scratch buffers；runtime 綁定建立它的 immutable layout 與 `MultiMap` identity，禁止拿同 shape/count 的另一份 map authority 混跑。splitter 持有 per-tile round-robin cursor、只收 `inDir`，merger 只收 `inDirs` 並依陳列順序仲裁；`stepFactory` 成功熱 tick 原地零配置；`FactoryState` 是 save/replay/debug **以及 whole-game `factoryTicks` ownership clone** 的 cold snapshot。diagnostics 同時受 ≤100,000 ticks 與 ≤100,000,000 layout-weighted work限制；在任何 init/tick 前以 `(area + machines + sources)² × observationTicks` deterministic fail-fast。`factoryOutcome`遇deadlock/首產品 exhaustion顯式throw；`analyzeThroughput`對真deadlock回`0/1`且bottleneck欄位皆null，只有observation window或work超budget才throw，UI顯示alert。 | 同時滿足熱迴圈禁`new`、確定性replay/save、正確routing與舊`GameState`/history不alias；map identity堵住authority混用，work preflight避免合法大layout在同步UI diagnostic鎖住主執行緒。cursor必須進runtime/snapshot/hash/save；永久inventory只在Game邊界物化。 | 物件量升到需通用ECS，或profiling證明固定容量策略不合適時；仍須保留zero-allocation successful tick、authority identity、deterministic analysis fail-fast與cold serialization boundary。 |
