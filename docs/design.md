# Project HexaPharma — 專案計劃書（活文件版）

> 本檔是專案計劃書 v1.0 的活文件版本；隨設計演進更新。codename「HexaPharma」為暫定，最終命名待議。

## 摘要

一款融合兩種玩法的 2D 遊戲：在**程序化隨機生成、迷霧覆蓋的多張效果地圖**上摸黑探索、解出藥方（Potion Craft 的鍊金地圖），再到工廠把藥方鋪成**確定性自動化產線、配平機器吞吐**量產（Big Pharma 的工廠）。美術走**平面、極簡、俯視正交**（Shapez 風）。

- **核心模型一句話**：Big Pharma 的工廠 + Potion Craft 的地圖。把 BP 每種有效成分的 1D 濃度，換成「一張 2D 地圖上的位置」；多張地圖並存、一台機器同時移動所有圖；地圖隨機生成、seed + 生成設定即關卡身分。
- **雙重目標**：(1) 把這款遊戲**真正做出來、出貨**；(2) 用它當 **AI 多 agent 編排**的實驗場。兩者同向——出貨一款確定性、可 headless 驗證的遊戲所需的工程紀律，恰好就是讓多 agent 平行、低人工介入協作的前提。
- **規模錨點**：Potion Craft 級。中小型、機制驅動、單人本地。同屏移動物件數百～低千，**非** Factorio 百萬級。效能不是瓶頸，故全程採 code-as-truth（純程式碼、無隱藏編輯器狀態）。

---

# 1. 遊戲設計

## 1.1 核心循環

```
（當前數張地圖）研究室實驗 → 揭開迷霧、發現療效／副作用／危險／牆壁區域
   → 在 Pilot Bench 實際擺出可運作的 source→machines→sink 原型產線
   → 系統由唯一 source→sink 拓撲推導藥方步驟，驗證各圖落點、危險與副作用
   → Factory 原位接收完全相同的 ProductionBlueprint，再做並聯、配平與空間最佳化
   → 賣藥：利潤 = 基礎藥價（由難度分決定）− 實際生產成本 − 副作用扣分
   → 投入專利樹（解新機器 / 擴廠 / 揭霧 / 解鎖新成分=新地圖）
   → 循環變深
```

兩個玩法透過同一份 **ProductionBlueprint** 銜接：研究室同時是**人類發揮創意找效果路徑**的 Effect Atlas 與**親手搭出實體原型**的 Pilot Bench；工廠從原型原位開始，把已驗證的藥方工業化，而不是收到自動重排的另一條產線。

## 1.2 核心系統：多張效果地圖 + 機器變換（遊戲心臟）

這是最有辨識度、最 novel、也最該先做穩的系統。

### 1.2.1 效果地圖（= 一種成分 / 基底）

對應 Potion Craft 的「基底」（水/油/酒各一張地圖）與 Big Pharma 的「有效成分」。把 BP 每種成分的 1D 濃度值，升級成一張 **2D 地圖上的位置**。

- 地圖數 **N 參數化，目標 4**（照 Big Pharma）。型別與生成支援 1–4；新局先以單一 Layer A 教玩家探索與移動，再由專利逐步解鎖 B、C、D。
- 藥物在**每張圖各有一個位置**；**一台機器同時移動所有圖**（每圖各自施加變換）。

### 1.2.2 地圖四特徵

每張地圖的格子有四種特徵；生成與視覺都以**連通區域／地標**呈現，不再把關鍵內容散成難以辨識的孤立單格：

- **療效區**：疾病目標，基本連通面積 5–9 格。藥物在該圖的**最終位置**落入才算治到該病；現行所有區內格等價，沒有 potency authority，renderer 不得自行猜核心。
- **副作用區**：依全圖 5% 整數密度生長成連通 biome；藥物該圖**最終位置**落入則帶該格的副作用——**降級但仍可賣**（非致命）。
- **牆壁區**：依全圖 4% 整數密度生長成連通鏈、弧或狹口地標；擋住移動，掃動到牆前一格停下（不可穿），也可當**精準停點**使用。
- **危險區**：依全圖 3% 整數密度生長成連通團塊或走廊；掃動**路徑經過**任一格即**變質失敗**（成廢料）。

地圖初始迷霧覆蓋，靠研究室實驗把藥物開進未知區揭露（專利可提供揭霧輔助）。格線可穿過迷霧顯示座標結構，但未知區的區域輪廓、類型、核心與強度都不得洩漏。

### 1.2.3 機器 = 對藥物多圖狀態的確定性變換

機器不是「加減向量」，而是一組**變換（transform）**。起步先放幾種，資料驅動可擴充：

- **平移 translate**：帶朝向的位移向量；逐格掃動（牆停、危險即死）。朝向與 flip 對它有意義。其「物理朝向 → 效果方向」關係分為**順向 / 逆向 / 垂直 / 偏移**——順向沿機器朝向推、逆向反朝向推（即「反過來的機器」）。
- **稀釋 scale-to-origin**：每張圖把位置以固定比例往該圖原點拉（= 降濃度、回退），適合 overshoot 後的救援 / 重置。比例用**有理數**（分子/分母）保證跨機確定、零浮點飄移。與朝向無關。
- **Phase Exchange / 換圖 swap-maps**：交換 A、B 兩張圖的座標（A 收到 B 原座標、B 收到 A 原座標）。與朝向無關，需 ≥2 圖；單層新局明確鎖定。Layer B 從靠近中心、但不同於 A 的 deterministic phase offset 起步，因此解鎖後的第一次交換也有實際位置效果，不是交換兩個相同座標。

現行 catalog 以效果距離與實體尺度形成可讀層級：translate 位移為 **3／4／7 格**，實體 footprint 為 **3–8 個地板格**；footprint 不等於效果距離。搭配逆向、垂直、偏移、scale、swap 與牆停保留精準定位，不保留大量只差數字的 `+1`／`+2` 同質機器。後續新增 5／9 格或更大 footprint 屬內容與平衡工作，不能在實作前寫成現行能力。

每台機器必須同時有三種辨識度：**效果角色**（如何移動藥物）、**空間角色**（footprint、ports、旋轉後如何打包）與**生產角色**（processing cost、速度／吞吐）。大型機器可以用較少步驟跨越地圖，但昂貴、慢且難並聯；小型機器便宜快速、較容易塞入空間，代價是步驟與連線較多。玩家不能任意改 speed，而要在 Factory 用並聯與 routing 配平瓶頸。

### 1.2.4 移動解析（掃動）

一顆藥通過機器時，在每張圖上依該機器的變換移動：

- **translate / scale**：從現位置沿目標向量**逐格掃動**。遇牆 → 停在牆前一格；路徑任一格踏入危險區 → 整顆**失敗變質**；否則前進到向量用盡。
- **swap**：交換兩圖位置（純 relabel，不掃動、不會失敗）。

**關鍵性質：輸送帶怎麼繞線不貢獻任何移動，只有機器作用藥物。** 因此一份藥方的最終效果，**只取決於「機器序列 + 各機器朝向」**，與 belt 佈局無關。

### 1.2.5 跨圖拉扯（核心深度）

副作用的深度來自**跨圖的拉扯**：解鎖 Layer B 後，一台機器同時移動所有圖；你要在 A 圖命中療效區，但同一組機器在 B 圖上也把藥物推到某處——可能正好踩進 B 圖的副作用區或危險區。「在這張圖達標、同時讓另一張圖保持乾淨」是進程展開後的核心受限最佳化。單層開場先讓玩家學會局部探索、迷霧與變換，不把跨圖認知負擔一次塞入教學。

### 1.2.6 療效與失敗判定

- 治到疾病 X ⟺ 藥物在 X 所屬圖的**最終位置**落入 X 的療效區，且全程未失敗；現行療效區沒有 potency 分層。**一顆藥可同時治多病**（不同圖各落入一個療效區）。
- 各圖最終位置若落在副作用區 → 帶該副作用（降級可賣）。
- **任一張圖**的掃動路徑踏入危險區 → 整顆失敗。

### 1.2.7 一個關鍵的設計自洽

「位移由機器自身朝向決定、繞線不貢獻」這一條，讓三件事同時成立：

1. **防抄 / 防無腦旋轉**：把整張藥方藍圖一起旋轉 → 每台平移機器的朝向都轉 → 路徑繞起點旋轉、落到別處 → 失敗。加上機器種類異質（順/逆/垂直/偏移），更不存在單一剛性變換能把現成藍圖搬到新目標。
2. **工廠可自由重排**：只要保持**每台機器的朝向 + 單顆處理順序**不變，輸送帶任意改道、慢機並聯都不改變效果結果 → 純粹做吞吐與空間最佳化。
3. **研究室=人類創意，求解器=僅 tests/tools**：人在 Pilot Bench 擺出拓撲，系統只由連線確定性推導序列；自動求解器只作 soundness、解耦與平衡稽核，**不進 production dependency graph，更絕不**做成遊戲內的一鍵自動解。

## 1.3 研究室（人類創意核心）

Lab 由兩個同步、同等真實的空間構成：

- **Effect Atlas**：當前一至四張 `63×63` 效果地圖。固定 `704×512` viewport 在 100% 使用約 `40px` cell，平常只見約 `17×13` 格；每格有低對比 minor grid，每 5 格有較強 major grid，origin 軸／座標刻度另有清楚層級。minor grid 在遠縮放可淡出、major grid 必須保留；格線在 substrate／fog 上方、route／feature／token 下方，迷霧中仍可見但不得洩漏 feature。拖曳平移、wheel 游標錨定縮放，`F`／Focus 回到藥物並跟隨。多圖只渲染 active layer，以 A–D tabs／hotkeys 切換，各 layer 保存 camera 並 cull viewport 外格子。
- **Pilot Bench**：使用與 Factory 共用的約 `40px` 地板格、機器 footprint、ports、belt、碰撞、旋轉與 ghost/buildability 規則。玩家直接擺出一條 source→machines→analyzer/sink 的實驗原型；初期配方 authority 限定為**唯一、無循環、無 split/merge 的 source→sink 路徑**，避免拓撲歧義。hover／選取 Bench 上的機器時，Atlas 同步高亮該機器造成的 route segment；反向 scrub 也要定位實體機器。

桌面預設讓 Atlas 佔主要面積、Bench 佔次要面積，兩者可交換焦點；compact viewport 可切換主焦點但必須保留另一空間的 live overview。這是兩個連動遊戲世界，不是左右兩個 HTML 表單。

Lab 的 authority 是可驗證的 **ProductionBlueprint**（精確 layout + source/sink 拓撲）；`Template.steps` 由唯一 source→sink connectivity 確定性推導，不可由另一份手動 Recipe 列表獨立修改。底部 Recipe timeline 只作唯讀 breadcrumb／scrubber／Run playhead，顯示每一步效果、錯誤、成本與速度；即時實驗可無限嘗試、回退與重排實體原型。

## 1.4 工廠（自動化、吞吐配平）

接收 Lab 已驗證的實體原型並工業化。儲存配方時保存完整 `ProductionBlueprint`，包括 layout 尺寸、tile、machine anchor、footprint rotation、effect orientation／flip、ports、source、sink 與連線；切換 Factory 時逐欄位保留，**不得呼叫 template compiler 自動打包、不得重新排列、不得偷偷改旋轉或接線**。內容全是資料、在 runtime 生成並以程式碼畫出，沒有任何需要在編輯器擺的場景檔。

- **空間打包**：機器有不同形狀與輸入/輸出口，用輸送帶串接 → Tetris 式擺放謎題。
- **吞吐配平（核心機制）**：每台機器處理速度不同，慢機器造成瓶頸，輸送帶有吞吐上限 → 達最高效率必須**配平**（並聯慢機、調佈局匹配上下游速率）。
- **原型後的工業化**：Factory 以 Lab exact layout 為起點；之後可在保持藥方 effect order contract 的前提下改 belt、搬移 footprint、複製慢機、加入 splitter/merger 與並聯，以優化吞吐與空間（效果結果不變，見 1.2.7）。Lab 初期的單路徑限制不限制 Factory 的量產拓撲。
- **Routing 契約**：splitter 只接受從 `inDir` 進入的單位，並以每個 splitter 自己的 round-robin cursor 選 `outDirs`；merger 只接受 `inDirs`，同 tick 競爭依 `inDirs` 陳列順序固定仲裁。cursor 會影響未來行為，必須跟著 runtime、cold snapshot、hash 與 save。
- 產線即時運轉（可暫停擺放），每單位逐 tick 追蹤，抵達輸出口才算一個 sink outcome；是否成為可售成品仍由 Game 逐顆驗實際 `Outcome`，失敗、無療效或不符已存 recipe 的結果計 waste。
- **Game 建地 authority**：未保存 recipe、也沒有既存 layout 時，手建工廠只能使用 base entitlement `24×12`，已解鎖的 expand patent 才能增加該 entitlement；一旦已有 layout，玩家編輯只能保持既存尺寸，尺寸改變只能由 patent reducer 進行。public `factory-sim` 可驗證至 65,536 格，但 Game/UI layout 另限每邊 256、總計 4,096 格。
- **bounded diagnostics**：最多模擬100,000 ticks，且 layout-weighted work ≤100,000,000。`factoryOutcome`/`analyzeThroughput`會在任何runtime init/tick前，以`(area + machines + sources)² × observationTicks`作deterministic preflight；合法layout仍可因diagnostic成本過高而拒絕，避免同步`useMemo`鎖UI。`factoryOutcome`遇deadlock或首件產品exhaustion顯式throw，不能偽裝成藥物`failed`；`analyzeThroughput`對真正deadlock回確定`0/1`且不回報假機器瓶頸（兩個 bottleneck 欄位皆`null`），只有observation window/replay/work budget不足才throw。Factory UI以analysis alert顯示。serpentine regressions精確區分：throughput 20×20成功、21×21拒絕；first-product outcome 20×20成功、21×21仍低於work cap，22×22才拒絕。

## 1.5 經濟（極簡 + 反退化 + 難度驅動定價）

目標不是經濟深度，而是**防止退化**——不要讓「狂產單一藥物」變成簡單最佳解。

- **難度驅動定價**：每個疾病/藥方的基礎藥價 = `roundHalfUp(10 × (17/10)^difficulty) + 3 × referenceCost`。difficulty 的指數項用 BigInt 分子/分母精確計算，最後作正數 half-up rounding，不走 `Math.pow`/浮點；d=0..58 與既有曲線輸出相同，這次轉換是確定性/overflow authority 修正，**不是人工調平衡**。複合難度仍來自建構 reference 的步數 + 多樣性 + 解耦，tests/tools solver 另作最短解與平衡稽核，不參與 runtime 生成。
- **淨利 = 當前單品售價 − 實際生產成本 − 副作用扣分**。當前單品售價從基礎藥價開始，依該疾病累計銷量逐件遞減；實際生產成本由這顆藥真正通過的機器累加，副作用扣分由 sink 成品的實際 `Outcome` 計算。
- **物理庫存**：sink 交付的是帶實際 `DrugState`、`Outcome` 與生產成本的單顆成品，不是只記配方名稱或數量。失敗品/無療效品成廢料、不進可售庫存；一顆多療效藥可選一個疾病市場出售，但賣出後整顆移除，不能重複變現。單售與 bulk sale 的未知疾病、不存在／已售／重複產品或錯誤療效都在 reducer 原子地顯式拒絕，不會靜默視為 no-op。Game 最多保留 24,500 顆實體庫存；單一 bulk sale intent 最多 100,000 IDs（目前 inventory cap 更小，但 public intent boundary 仍獨立驗證）。
- **反退化機制**：多個疾病市場 + 各疾病獨立累積的單品飽和遞減 + 隨機地圖（無全域最佳解可抄）。現行 vertical slice **沒有訂單系統或動態需求排程**；每次合法銷售另取得 1 R&D，供專利消耗，也不做動態競爭對手。
- **避開 Big Pharma 的失衡反例**：不加入「一鍵指定位置/跳過導航」之類過便宜、會把地圖謎題玩穿的機器（BP 的 Sequencer 教訓）。

## 1.6 專利樹（= 天賦樹）

投入現金 + R&D 解鎖：新機器/變換、擴廠面積、揭霧輔助、**解鎖新成分（= 新地圖）**。未解鎖機器不出現在可用palette/catalog；擴廠專利直接擴張layout，也決定無recipe手建工廠的`24×12 + patent delta`尺寸。public `canUnlock`/`unlockPatent`/`activeEffects`會驗tree、unlock order、unknown/duplicate state與cash/research boundary；`activeEffects`對factory width/height delta與reveal amount用checked safe-integer add，aggregate overflow顯式reject。三段地圖專利 `new-map`／`new-map-4`／`deep-map-4` 推進1→2→3→4圖；每次視為下一個deeper level：seed +1、維持 `63×63` 並重生目前關卡，清recipe/factory/runtime/waste/inventory/fog與`economy.sold`，保留扣款後cash/R&D、patents與global inventory ID；UI先完整警告並再次確認。

## 1.7 成分地圖、探索與解鎖

**沒有獨立的「世界地圖」。** 採 Potion Craft 模型：玩家在「當前的數張成分地圖」上工作（成分 = 基底 = 原料 = 一張效果地圖）。兩條解鎖軸：

- **探索 / 揭霧**：新局的 Layer A 從 `63×63` 正中央 `(31,31)` 開始，初始 visibility radius 3，亦即只揭露 `7×7 = 49/3969` 格；研究室實驗與揭霧專利再持久擴張。未知區以不洩漏特徵的原創 defocused microscope fog 完全遮住，不用「?」debug 字元。
- **解鎖新成分**：透過專利進入含更多基底的下一個 seed-pure deeper level（1→2→3→4）；各圖皆維持 `63×63`，整組重生。A 起點／origin 是中心；B、C、D 的 start 使用靠近同一中心的 deterministic phase offsets，而 origin 仍在中心，語意見 1.6 與 D16。

多張地圖解鎖後靠「一機同時影響多圖」耦合；A↔B Phase Exchange 只有 B 存在時才可用。

## 1.8 程序化生成

- **種子決定隨機抽樣**：地圖由 seeded PRNG 生成；seed 的 canonical domain 是 uint32 `0..0xffffffff`（拒絕負數/超界 alias；deeper-level `+1` 以 uint32 wrap）。在同 build 與同一份完整 `GenOptions`（圖數/尺寸/catalog/疾病數/難度帶）下，**同種子可重現、不同 canonical seed 不可因 RNG 截斷而別名**。種子連同生成設定構成地圖身分，堵死「上網抄藍圖」與「跨關卡復用舊解」。**一個存檔保存一份目前的 seed + 生成設定。**
- **建構式生成為主**：先構造一條保證存在的多圖合法解（用可用機器的變換），再以該終點長出 5–9 格連通療效區，並在不破壞 reference 的前提下生成連通副作用區、危險走廊與牆鏈 → **可解性由建構保證**。所有 flood/growth 的起點、鄰序與面積都走 seeded integer authority；同 seed + options 必須逐欄位相等。
- **逐位置難度評分**：對每個疾病算 reference 的複合難度 + 生產花費，**同時**用來 (1) 把建構結果限制在難度區間、(2) 設定該藥的基礎藥價；tests/tools 再用 solver 稽核最短解是否暴露離群。
- **求解器的角色**：只在 tests/tools 作 soundness、解耦與平衡 oracle。production `mapgen` 先選 reference 機器序列、重播並保護逐圖路徑，再放 cure 與散佈特徵；可解性由建構本身保證，runtime 不 import solver、也不做 reject-until-valid。求解器更**不是遊戲內自動解**——人類解謎是樂趣核心。
- **public 與 Game 上限分層**：public headless mapgen 仍接受單圖 area ≤65,536；進入 `GameState`/UI 的 map authority 另限每邊 ≤64、每圖 ≤4,096 格。Lab 的 viewport 固定 `704×512`，camera 決定可見 cell 範圍並 cull 其餘格；production preview 直接覆蓋最大 `64×64` authority，而不是把大圖縮到全景。副作用格的ID以`Int32Array`保存，不再受`Int16`正值上限截斷。

## 1.9 存檔

Save v4 有兩個刻意分開的 wire 用途。完整 `serializeGame`/`deserializeGame` API 在 materialized wire ≤5,000,000 characters 時 round-trip 全 `GameState`（live runtime 轉 cold snapshot）；超限顯式拒絕，即使該 state 在 Game authority 下合法。24,500-item inventory 可讓 full wire 超過5,000,000 characters，所以**localStorage checkpoint v2 不為每個 retained entry 重複 materialized state fields**。checkpoint 的每個 head/history entry 都是 compact replay authority，只含 self-declared `origin`（初始 `GenOptions`/cash/research）、canonical normalized `intentTrace`、其 `replayTicks`，以及由完整 canonical state 算出的 non-cryptographic `stateHash`。decode 由 origin 重播 trace、驗 canonical tick total與 hash後才重建完整狀態；地圖仍由 seed-pure mapgen 重建。

目前是 pre-release 早期開發：以上正確性只保證同一 content build，不承諾跨 build 存檔相容。地圖、schema、經濟或 sim 語意調整時可直接使舊 checkpoint 失效或要求清除站點資料；不為開發中版本維護 legacy generator／migration chain。完整政策見 [development-policy.md](development-policy.md)。

這個`stateHash`是一致性checksum，不是簽章。單一authority/head最多4,096 entries、100,000 ticks、100,000,000 weighted work；正常`24×12` Pilot reference的100,000-tick trace約85,313,612、緊密佈局的24,500-inventory流程更低。work估算含map traversal、factory cold/layout/ticks、sale與patent reset。compact與materialized full readers都解析raw origin+intentTrace、重算tick/work後才semantic replay，不能信自報metadata。語意no-op不記錄，連續ticks/layout/same-disease sales正規化；full/compact wire另有5,000,000-character cap。

UI 提供三個彼此隔離的 localStorage 槽位，每槽只寫一個 checkpoint envelope v2 key。write 先對**每個實際 retained state**做完整 semantic/replay 驗證並產生 cold-owned canonical clone，之後才單次 `setItem`；invalid state/save 顯示錯誤且不寫。每條 rewind timeline 必須使用完全相同的 origin 並形成 trace-prefix lineage；因 canonical normalization，最後一筆允許 `factoryTicks` 增量、同疾病 sale ID 前綴增長或 `setFactory` 被新版 layout 取代。把另一個 run/branch 存入已佔用 slot 時，UI 明示 replace 舊 timeline，絕不把兩個 origin 混進 rewind。

head單獨存放且pruning不移除；older history受≤20、≤1,250,000 chars與共用rewind aggregate ≤12,000 ticks/≤8,192 entries/≤100,000,000 work。`deserializeSlots`先inspect整個materialized raw list，再做任何`parseGameState`→replay；`serializeSlots`也先驗同一aggregate。legacy storage先preflight history，必要時才head-alone，封住5,000,000-character legacy繞過compact budget。compact salvage同樣先驗候選集合，超限可只replay通過的head。

舊版 `slot` + `history` 雙 key 只在各自通過 Save v4 驗證，且 history 也滿足同 origin、normalization-aware trace lineage 後才走明示 migration；legacy keys 不刪。mixed legacy timeline、malformed、部分有效或 interrupted-write 都回傳可見 invalid result，不從 migration path throw；若 head 有效，recovery 清成 head-only timeline，避免把跨 run history 帶入。玩家按 Recover 前不刪不覆寫；Load遇invalid/partial/disagreeing timeline不改目前遊戲或壞checkpoint，Save/Rewind也不踩掉。只有完整驗證成功的legacy migration或玩家明按Recover才寫canonical checkpoint。所有reducer intent rejection與save/load/storage failure都在UI顯式呈現。

## 1.10 詞彙約定

- **成分 / 基底 / 原料**：三者同義 = 一張效果地圖（+ 起始位置）。對應 Potion Craft 的「基底」。
- **機器**：對藥物多圖狀態的變換（translate / scale-to-origin / swap-maps…），同時有實體 footprint／ports、（平移類）effect orientation／flip、processing cost 與速度。效果距離依 small 3、medium 4–5、large 6–9+ 分級，由專利樹解鎖。
- **ProductionBlueprint / 生產藍圖**：Lab 與 Factory 共用的權威實體 layout；包含精確 tiles、machine anchors、footRot、effect orientation／flip、ports、source、sink 與 routing。Lab 儲存後 Factory 必須原位接收，不做 auto-pack。
- **模板 / 藥方**：由 ProductionBlueprint 中唯一 source→sink 路徑**推導**出的機器序列 + 各機器效果朝向，是模擬與成品驗證 contract，不是另一份可獨立編輯的 authority。疾病目標不重複存進模板；療效由模板在目前 level 的實際 `Outcome` 推導。

---

# 2. 技術架構

## 2.1 技術棧

**TypeScript（code-as-truth）；確定性 sim core 與渲染徹底分離；渲染用 PixiJS v8；UI 用 React；建置用 Vite；Node LTS（20+）。美術平面俯視正交。**

選 TypeScript 而非 C#/Raylib、Godot、Unity 的理由：

1. **效能不是瓶頸**：Potion Craft 級的物件量，任何現代棧跑 60fps 都輕鬆，故 native 效能、更硬編譯閘這類 C# 優勢在此量級幾乎無關。
2. **AI 編輯效率最高**：TS 是 AI 最熟悉的語言之一，首輪正確率高 → 直接壓低人工介入次數。靜態型別能在編譯期攔下大量錯誤（agent 拿到型別錯立刻自修）。
3. **CLI 協作面單純**：純 TS 專案沒有編輯器/import-cache 隱藏狀態；環境有 worktree hook 時可一任務一 worktree，像目前這類共用主工作樹環境則只平行不相交檔案，公共介面與重疊檔案由 integrator 序列化。
4. **headless 測試工具最強**：sim core 純 TS 用 vitest/node 測；視覺面用 Playwright headless 截圖 + pixel diff。
5. **UI 已解**：本作 UI/互動偏重，React/DOM 疊在 canvas 上最順手。
6. **PixiJS v8 對 agent 友善**：純 renderer、顯式 game loop、無框架隱藏狀態，且隨 npm 套件附帶 AI agent skills。不選 Phaser，因它會帶進自己的 scene/physics/input 觀點，把隱藏狀態請回來。

**可逆性保險**：最值錢的資產是「與渲染無關的確定性 sim core」，它是可移植的純邏輯。日後若受不了 TS 型別鬆散，可換成 C# + Raylib-cs / MonoGame，core 幾乎原封搬移、只重寫薄薄的渲染層。故先用 TS 沒有沉沒成本風險。

## 2.2 三層架構

```
┌────────────────────────────────────────────────────────────┐
│ UI 層（React / DOM）      研究室、工廠、商店、選單              │
│   只讀 sim 狀態 + 發 intent                                   │
├────────────────────────────────────────────────────────────┤
│ 渲染層（PixiJS v8，平面俯視）  多張正方格地圖/工廠/機器/物品     │
│   只讀 sim 狀態、顯式 game loop、嚴禁修改任何 sim 數值          │
├────────────────────────────────────────────────────────────┤
│ Sim Core（純 TS，零渲染依賴）   ★ 心臟與唯一可驗證單元 ★        │
│   tick-based、固定 seed、完全可 headless 測                    │
└────────────────────────────────────────────────────────────┘
```

- **單向資料流**：UI/渲染只「讀狀態、送 intent」；只有 sim core 在 tick 裡改狀態。
- **sim core 不 import 任何 Pixi/React/DOM**——這條鐵律讓 core 能在 node 裡 headless 跑，是平行測試與可逆性的根本。
- **renderer code split / 可見錯誤**：Lab/Factory只type-import renderer，mount時才`await import()` Pixi實作；載入或初始化失敗會顯示error，不以空canvas冒充成功。不使用會破壞Pixi初始化順序的手動vendor groups，也不靠提高warning threshold。Lab 固定 `704×512` viewport，只畫 active layer 與 camera 可見 cells；production-preview 直接載入最大 `64×64` Game authority 驗 culling、鏡頭與零 runtime error。一般Chromium e2e用dev`:53347`，production preview用`:53348`；真人playtest仍只用`0.0.0.0:53346`。
- **UI 派生狀態不冒充 authority**：Lab 在 Bench blueprint 編輯、Run 開始、Clear 與換 level 時清掉舊 outcome，不能拿 stale 結果保存新 blueprint／derived template；timeline、hover segment與playhead都只是派生UI。Factory 的 `producedTotal` 文案是「total sink outcomes（includes waste）」並另列 Game 權威 waste；bounded sample/throughput analysis 只作提示，thrown outcome/observation-budget diagnostic 顯示 `factory-analysis-error` alert（真正 throughput deadlock 是有效 `0/1`且無假瓶頸），live product validation 才決定入庫。
- **直接操作 UI 契約**：遊戲使用 viewport-filling shell、固定 HUD／F1–F4 nav rail、世界優先的 Lab／Factory、底部 hotbar 與 persistent inspector。Lab hotbar 把 machine 拿到 Pilot Bench cursor，使用和 Factory 相同的 footprint ghost、buildability、rotate、erase、belt 與 history 語言；Atlas 同步畫 fog-safe route preview。水平 Recipe timeline 由 Bench topology 派生，卡片只能 scrub／定位、不能 insert／reorder 成另一份 authority；Run playhead 顯示當前步。Factory 的 layout edit 只透過 `setFactory` intent。一個 pointer gesture 是一筆 history。已造訪 view 保持 mounted 以保留 camera/tool state，但只有 active view 接 gameplay keys。詳細契約見 [ui-interaction.md](ui-interaction.md)。
- **Recipe preview authority**：`drug-graph.previewStep` 回傳與 `applyStep`/`revealAlong` 同源的 next state + per-layer entered cells；UI 的 `buildRecipePreview` 只對 Bench 拓撲推導出的步驟做確定性 fold、failure index、swap break 與 immutable trail，不能複製 transform/sweep 邏輯。fog-safe public preview 把 unknown features 正規化成同一不可判定內容；任一步首次進入 unknown 就在已知 prefix 停止並回 `uncertainStep`，不公開 failure、endpoint 或 downstream。hidden empty/wall/hazard 必須 indistinguishable。held／moved machine 的候選預覽必須重新推導完整 downstream path，只有全程已知時才畫精確 ghost。
- **Lab 原創 atlas 美術**：runtime 資產位於 `public/assets/lab/`，由 `manifest.json` 定義 substrate、fog、wall、hazard、side-effect、cure、drug 與 token halo；`README.md` 記錄生成來源、權利與「未使用競品素材」邊界。未知地形必須由 opaque fog 完全遮住，feature sprites 只在 revealed cells 出現；資產載入失敗走可見的 Lab renderer error，不得改回 debug 色塊或「?」靜默 fallback。

## 2.3 Sim Core 模組（各有 typed interface + 各自測試）

- `drug-graph`：多圖效果引擎——正方格、四特徵、機器=transform（discriminated union：translate/scale/swap）、逐格掃動（牆停/危險失敗）、逐圖最終位置判定、迷霧揭露。
- `mapgen`：建構式多圖生成（構造/重播 reference → 保護路徑 → 生長連通 cure／side-effect／hazard／wall regions）+ 逐位置難度評分（種子決定）；production dependency graph 不含 solver。
- `solver`：在多圖空間搜尋合法藥方（**僅供 tests/tools 的驗證與稽核**，不接 production mapgen 或遊戲內自動解）。
- `factory-sim`：輸送帶/機器 tick 模擬——含processing cost /速度/吞吐/瓶頸；runtime綁layout + `MultiMap` identity；bounded diagnostics在init/tick前做100,000,000-unit layout-work preflight，throughput對真deadlock回`0/1`與null bottleneck、window/work exhaustion顯式throw。
- `recipe`：驗證 ProductionBlueprint 的唯一 source→sink 拓撲並推導 Template；Factory 重排驗證保持 effect order contract → 效果不變。舊 template→auto-pack compiler 不再是 Lab→Factory production path。
- `economy`：物理庫存單顆結算 + 難度分→基礎藥價 + 各疾病 sold counter 遞減（目前沒有訂單系統）。
- `patent`：天賦樹（含解鎖新地圖）。
- `save`：materialized wire ≤5,000,000 chars時的完整 Save v4 round-trip API，以及不重複full state的compact replay authority（origin/normalized trace/replayTicks/non-crypto stateHash）prepare/inspect/replay；UI checkpoint storage負責三槽preflight、cold-owned write與多重budget rewind timeline。
- `rng`：自有 seeded PRNG（唯一隨機來源，mapgen 也走它）。
- `state`：工廠層 `hashFactory` / `replayFactory`。
- `game`：完整 `GameState`、`GameIntent`、`applyGameIntent`、`hashGame`、`replayGame`；UI 只讀狀態並發 intent。

## 2.4 確定性需求

- **同 build + 同完整 `GenOptions` + 同 seed + 同 input trace → 必然得到同一結果**（不追求跨平台 bit-level，單人本地不需要）。
- **sim core 內嚴禁**：`Math.random()`（一律走 seeded PRNG）、`Date.now()`/`performance.now()`（時間只能來自 tick 計數）、依賴 `Set`/`Map` 迭代順序做有副作用的邏輯、async/微任務排序影響結果、浮點累積誤差影響離散決策（格子座標/物品數/tick 用整數；scale 比例等用有理數）。
- **mapgen 必須純由完整 `GenOptions`（其中包含 seed）決定；牆/危險/副作用 scatter比例以整數 rational `4/100`、`3/100`、`5/100` 計數，輸出不變但不讓 float 參與離散決策。**
- CLI 工具也不繞過 boundary：`headless-sim` 的完整 seed argument 只接受 uint32 safe integer（拒絕 `14junk`、fractional、空值、負數/超界；`-0` canonicalize 為 `0`）；balance count 只接受 `1..100,000` safe integers，超限在 seed loop 前 fail-fast。
- `GenOptions`/catalog 是不可信 boundary：seed 接受 uint32 `0..0xffffffff` 且把 `-0` canonicalize 為 `0`；public mapgen 單圖 area ≤65,536、difficulty max ≤64、catalog ≤256 entries，Game map 另限每邊 ≤64/每圖 ≤4,096 格。template ≤256 steps；public factory area ≤65,536，Game factory 另限每邊 ≤256/總計 ≤4,096 格；machines ≤area、每 shape cells/inPorts/outPorts 各 ≤256、aggregate shape cells ≤area、aggregate input/output ports 各 ≤262,144。Game inventory ≤24,500，bulk sale ≤100,000 physical product IDs，factory replay/whole-game cumulative factory ticks ≤100,000，Game weighted replay ≤100,000,000；零 ticks 是 no-op，正數 `factoryTicks` 沒有 authoritative layout 時必須拒絕。所有離散欄位須為範圍合法的 safe integer，catalog ID/transform/cost/speed/方向/geometry 必須 upfront 驗證；production source 的 static/dynamic solver import 由 ESLint 全域阻擋。
- 進入 `GameState`/trace 的 `GenOptions`、catalog、Template、FactoryLayout 與 nested transform/shape/ports 會 canonical clone 並 deep-freeze，切斷 caller mutation 與 identity-cache 污染；共享 `DEFAULT_CATALOG`、`DEFAULT_SHAPES`、`DEFAULT_PATENTS` 也凍結。

## 2.5 資料導向（務實版）

- 現階段（Potion Craft 級）不引入 ECS；工廠採專用固定容量 SoA `FactoryRuntime`，比通用 ECS 更容易驗證且足夠清楚。
- 防 GC stutter：每 tick 跑的**熱迴圈**使用預配置 TypedArray；**嚴禁成功 tick 內 `new` 物件或 `Array.map` 產生新陣列**。冷路徑（研究室/UI、init、snapshot/restore、錯誤 throw）照常寫。
- **目前實作狀態**：immutable layout geometry/index 依 identity 冷編譯並快取；active unit 的 id/grid/proc/machine/cost/failed/各 map 位置、occupancy/target scratch、splitter cursors 與當 tick product-event queue 全部固定容量重用。runtime 同時綁定建立它的 `MultiMap` object identity；即使另一份 map 的欄位/count 相同，也不能交給既存 runtime 混跑。`stepFactory(layout, mm, runtime): void` 的成功熱 tick 原地更新；測試以熱 call graph source/static guard 禁 allocating syntax/collection builders，並以長跑 buffer identity、mass/routing/replay 驗證守住。`FactoryState` 是 cold snapshot，供 save/replay/debug，且 whole-game reducer 的每個有效 `factoryTicks` intent 也必須 snapshot→restore 做 runtime ownership clone，維持舊 `GameState`/history 不被 alias；再逐 tick drain/clear event。sink 產品物化為永久 inventory object 是 Game 領域輸出邊界，不冒充 factory sim 的 temporary hot allocation。

## 2.6 格子形狀：正方形

因「效果圖位移方向 ≈ 工廠物理方向」需要兩個格子的方向系統對齊，故採同一種格子；而工廠建設需求主導 → **正方形**。理由：工廠佈局/輸送帶/打包最直覺；機器旋轉 90°（四態）+ flip 鏡像最好預測、AI 實作正確率最高；效果↔實體方向 4 對 4 完全乾淨；Shapez 風本身就是正方形；表現力不損（機器可為任意整數向量 × 8 朝向 × 順/逆/垂直/偏移）。世界探索無獨立地圖，故無此問題。

---

# 3. 正確性與驗證

工廠核心本質是確定性狀態轉移系統，加上「多圖隨機地圖的可解性/難度」這個天生的搜尋/驗證問題——把 AI 的產出 gate 在不變式後面，是壓低人工介入次數最有效的一招。這也是把形式驗證思維變成自動關卡的地方。

完整不變式總表見 [invariants.md](invariants.md)。摘要：

- **drug-graph**：各變換正確；旋轉/flip 正確（旋轉×4=原、flip×2=原）；逐圖療效=最終位置可重現；重排不變；防抄性質。
- **mapgen + solver**：建構即可解；生成確定性（同 seed → 逐欄位相等）；難度界限；定價一致；求解器健全。
- **factory-sim**：質量守恆；無物品憑空生成/消失；固定 SoA/event/scratch buffers；成功熱 tick 零配置；layout/map identity authority；per-splitter cursor round-robin、input-side/merger priority 契約；cursor 進 snapshot/hash/save；outcome deadlock/budget exception與throughput deadlock `0/1`/window exception語意分明；吞吐一致；確定性。
- **game/economy**：sink 實際成品才可入庫；一顆藥只賣一次；帳務採實際成本與副作用；庫存非負；反退化遞減；全局 intent replay hash 一致。
- **save**：materialized full wire ≤5,000,000 chars時，完整Save v4 API round-trip深等於原狀態；合法state超full-wire cap顯式拒絕，checkpoint retained entries則走compact replay authority。prepare/write先驗證與cold-own，decode/salvage先preflight累計work再重播。declared-origin trace + non-crypto stateHash只證明core-reachability/一致性，不把本地JSON宣稱為可信簽章。

## 3.2 測試與除錯骨幹

- **property test**（fast-check 之類）：對各變換/掃動、多圖生成、物流推進、重排、定價、存讀檔，下隨機輸入驗證不變式恆成立。
- **replay harness**：每個 bug = `seed + tick 區間 + input trace`，任何 agent 都能 headless 重現。
- **debug build 每 tick assert 不變式**：違反就 pin 出壞掉的精確 tick；高頻 assert 在 release 關閉，但 init/restore/save 等不可信冷邊界在 production 仍強制驗證。

---

# 4. AI 多 agent 編排

方法論主軸：用一款確定性遊戲，當多 agent 平行協作的實驗場。核心觀念——**讓多 agent 能跑的關鍵不是某個編排框架，而是模組邊界本身**；模組邊界就是編排基質。

- **原則**：所有衝突都來自共享可變面。sim 子系統純、介面隔離 → 天生低衝突；渲染層最高衝突面 → 碰它的工作要序列化。「做完」= **過閘**，不是「人看起來 OK」。
- **隔離 + 模組擁有權**：有 worktree 能力時一任務一 worktree；目前 shared-tree runner 沒有 WorktreeCreate hook，故只平行 disjoint files，重疊檔案/公共介面由 integrator 序列化。鐵律不變：同一時間只有一個 agent 改某模組 public interface。見 [module-ownership.md](module-ownership.md)。
- **契約即 spec**：每個模組先定好 typed interface + 不變式；agent 的「規格」= 介面 + 不變式 + 測試指令。
- **唯一閘 `npm run check`**：`tsc --noEmit && lint && vitest run && playwright test`。Playwright 預設即 headless；不要傳不存在的 headless CLI flag。其 Chromium project 在 `:53347` 跑完整 e2e，production-preview project 會先 build 並在 `:53348` 驗四 tab lazy load/零 runtime errors。宣告完成前唯一驗收標準是這條跑綠。
- **Integrator pass**：一個 session（或本人）當 integrator，整合隔離交付（或 shared tree 的 disjoint edits）、跑完整閘、解跨模組衝突。
- **AGENTS.md（精簡、手寫）**：只放 AI 推不出來的硬規則。切勿用 LLM 自動生成肥檔。
- **bug 協定**：回報任何 bug 一律附 `seed + tick 區間 + input trace`（+ 違反的不變式/壞掉的 tick）。
- **MCP 不上關鍵路徑**：平行主路徑 = 可用時 worktree、shared tree 時 disjoint files + check script + integrator session，純檔案 + CLI。

**一條保命紀律**：別讓編排鷹架變成研究專案。編排設施極簡、純粹服務出貨。遊戲是交付物，編排是方法，不要倒過來。

---

# 5. 測試策略

四層閘，由便宜到貴：

1. **typecheck（tsc）**：型別/簽名/null 類錯誤，編譯期攔掉。
2. **單元 + property（vitest, fast-check）**：sim 子系統邏輯 + 不變式。headless、最快。
3. **整合測試**：跨模組（ProductionBlueprint → 拓撲推導 Template → 原位 Factory 產線 → 結算）端到端在 sim 層跑通，無畫面。
4. **Playwright smoke + 固定截圖 baseline**：Chromium對throwaway dev server啟動、跑數tick、開關UI、切場景；Atlas+Bench fogged、revealed regions與Factory exact-transfer prototype以`toHaveScreenshot`做pixel-diff，另驗Bench invalid topology與Factory bounded-analysis alert。production-preview先build再於`:53348`切四tab驗dynamic chunks/零pageerror，並載入最大 `64×64` Game authority，驗 Atlas 固定 `704×512` viewport、active-layer culling、adaptive grid與鏡頭操作。checkpoint tests另驗normalized lineage、不同run存進同slot會replace而非mixed timeline。兩個Playwright projects預設headless。

**自動可守**：邏輯正確、結構完整、確定性、多圖可解+難度達標+定價一致、質量/帳務守恆、吞吐一致、固定場景視覺回歸。
**不可約的人工**：好不好玩、謎題/平衡有沒有意思、版面順不順、配平節奏。截圖 diff 抓得到「變了」，抓不到「變好沒」。

策略：能進自動層的全部塞進去，讓人只審本質主觀/視覺的差異——**最小化**人工，而非歸零。

---

# 6. 儲存庫結構

詳見 [structure.md](structure.md)。目前實作骨架：

```
hexapharma/
  AGENTS.md  package.json  vite.config.ts  vitest.config.ts  playwright.config.ts
  src/
    main.tsx             # React 進入點
    sim/                 # ★ 純 TS、零渲染依賴、可 headless ★
      phase0_interfaces.ts  factory-geom.ts  hash.ts  state.ts  game.ts
      drug-graph/ rng/ mapgen/ solver/ factory-sim/ recipe/ economy/ patent/ save/
    render/              # PixiJS Lab/Factory renderer；只讀 sim
    ui/                  # React App/Factory/Shop/Patents/Game + checkpointStorage
  test/
    integration/  tools/  e2e/（含 *.spec.ts-snapshots/ expected images）
  tools/
    headless-sim.ts  balance.ts
  docs/
    design.md invariants.md module-ownership.md decisions.md overview.md
    structure.md notes.md plan.md roadmap.md
```

---

# 7. 開發路線圖

詳見 [roadmap.md](roadmap.md)。原則：**先做 sim 模組（headless、過閘），再加薄薄一層 render/UI**；不讓 agent 一次做整款。

- **Phase 0** — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）。
- **Phase 1** — 最小可見（看得到謎題；驗證跨圖拉扯手感）。
- **Phase 2** — 工廠吞吐配平。
- **Phase 3** — 經濟 / 存讀檔 / 專利 / 解鎖新地圖（vertical slice）。

---

# 8. 風險與緩解

| 風險 | 說明 | 緩解 |
|---|---|---|
| 對「全自動」期待過高 | GameCraft-Bench：最強 agent 端到端做可玩 Godot 遊戲僅 ~41%。 | 人負責架構、拆解、難設計決策；agent 負責 well-scoped 純模組+測試；integrator 吸收摩擦。 |
| 編排鷹架兔子洞 | 把時間全花在 agent infra，遊戲出不了貨。 | 編排設施極簡、純服務出貨；只用已驗證原語。沒在降低本遊戲 cycle 的工具就砍。 |
| 多圖 + 一般變換使求解/生成變難 | 在 N 維圖空間用 translate/scale/swap 構造保證可解、又算難度分。 | 限小 N（先 2）、小地圖、有界搜尋深度；transform 用 discriminated union；建構式生成；求解器只 dev/test 跑。 |
| novel 移動模型手感未知 | 「跨圖拉扯 + 三種變換 + 牆停 + 危險即死」沒人這樣組過。 | Phase 1 就做出來實際玩；不行則退回傳統 BP 模型（D7 留了退路）。 |
| Atlas + Pilot Bench 雙空間認知負擔 | 同時理解效果座標與實體工廠座標，可能造成視線來回或誤把兩套格線當同一座標。 | 同機器雙向高亮、同一 playhead、Atlas 主／Bench 次焦點可交換；先做單路徑 vertical slice，compact 以主焦點切換 + live overview 驗證，不把兩者硬疊成一張圖。 |
| exact blueprint 轉移限制工廠空間 | Lab 原型若與 Factory entitlement／邊界不一致，會出現「已驗證卻放不下」的斷裂。 | Pilot Bench 從一開始使用 Factory 共用 layout authority、尺寸與 buildability validator；Save 前原子驗證，任何不一致顯式拒絕，不得 auto-repack。 |
| 隨機地圖難度/定價失衡 | 可能太簡單/太難，或難度分→藥價不合理。 | 難度分 gate + 可人工調整曲線參數；目前 17/10 曲線以 BigInt 精確 half-up 實作，該機械修正不冒充平衡完成。 |
| GC stutter | 熱迴圈頻繁 `new` → 週期性卡頓。 | FactoryRuntime 固定容量 SoA TypedArray + 固定 event/scratch buffers；熱 call graph source/static guard 禁 allocating syntax，長跑驗 buffer identity/mass；AGENTS.md 硬性規定熱迴圈禁 `new`。 |
| 確定性飄移 | `Math.random`/`Date.now`/浮點/迭代順序滲進 sim 或 mapgen。 | seeded PRNG 唯一來源；禁時間/隨機 API；離散量整數、scale 有理數；CI 跑 replay-hash / mapgen-hash 比對。 |
| 經濟退化 | 「狂產單一藥物」變簡單最佳解。 | 反退化（多疾病並行 + 單品遞減）+ 隨機地圖；禁加過便宜機器；求解器不接進遊戲內自動解。 |
| 範圍蔓延 | 往 Factorio 規模/經營深坑長。 | 規模硬約束；超出 Potion Craft 級的提案先回到摘要。 |

---

# 9. 技術決策紀錄

詳見 [decisions.md](decisions.md)（D1–D19，含理由與推翻條件）。**可逆性備註**：D5 的 sim core 與 D2/D3/D4/D9 解耦、是純邏輯；換語言/換渲染只需重寫薄層，core 不動。

---

# 10. 附錄：Phase 0 契約

Phase 0 的具體 TypeScript 介面契約已在 **`src/sim/phase0_interfaces.ts`**。它仍是跨模組型別與核心資料契約；實作分布於 `src/sim/` 各模組，後續整局狀態與實體產物欄位也已在同一契約中演進，並由 unit/property/integration/e2e 測試守住。

---

*活文件 — Phase 3 vertical slice 已實作；Phase 4 Spatial Lab／exact prototype transfer 進行中，之後再做人工玩測、平衡與出貨打磨。*
