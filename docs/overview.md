# Overview

HexaPharma 是「程序化藥效 Atlas + 實體工廠」的確定性單人遊戲。三個 world page 使用一致的直接操作語言，但擁有彼此獨立的 authority。

## 三個場域

1. **Research**
   - 三種基礎藥（Saline／Oil／Ethanol）各一張大型 Atlas，地形相同、藥效分布不同；正常新局共 6 種獨立疾病（每 base 兩種），generator 最多支援 8 種。Saline 開局可用，Oil／Ethanol 在 Technology 打開。
   - Atlas 一次顯示一個 base；一劑藥只在一個 base 上試驗。
   - assay 只顯示目標的local，或east／south-east／south-west／west／north-west／north-east六個寬廣sector之一；不公開座標、距離或reference。
   - 玩家在本地以 catalog 定義的完整奇形 `PathStamp` 規劃整條路線（相對藥的朝向；每台機器有固定轉向；沼澤內走半格），預估只用已知地圖；`Run · $N` 一次付總價，從起點在權威地圖試驗並只揭露實際路徑。
   - Research 只開圖，不產生配方；最近一次試驗保存為 `lastTrial`（含 base）。
   - 霧下只看得到由地勢畫出的等高線（山與水畫法相同）；山、水、黑格、治療區與副作用區都要揭露後才印出。
   - 新局只揭露以 Atlas 中心起點為中心、hex distance radius 2 的 19-cell disk。
   - 未揭露互動物不改變規劃預覽；只有出藥後的實際路徑會揭露內容。
   - Research 不產生工廠 layout，也不是 Production Plan 或 Production 的前置條件。
2. **Production Plan**
   - 無時間、無建造費、無 inventory／waste 的 `FactoryLayout` 沙盒。
   - 可立即觀察 throughput、bottleneck、deadlock 與已知地圖上的 sample outcome；Plan 只讀 fog-masked planning map，不能免費查詢隱藏 Atlas authority。
   - 可保存 Factory Blueprint，或依 Production 差異報價 `Commission $N`。內部 field／intent 可仍名為 `pilot`。
3. **Production**
   - 新局即有空白 24×12 editor；玩家可直接建廠，不需先開 Production Plan。
   - 每次 layout edit付建造費。只有接受的變更停止播放並重建runtime；no-op／invalid／現金不足不動world，累積waste保留。
   - 唯一具有連續 tick、在途產品、inventory、waste 與經濟後果的場域。

## Atlas 與地圖生成

- 每個 base 一張 Atlas（同一骨架複製，各自的效果區與黑格、各自的 fog）；藥不會在 base 之間移動，跨圖互動不提供。
- Atlas 是 pointy-top axial true hex：cell 使用整數 `{q,r}`，六方向依序為 E／SE／SW／W／NW／NE，dense fields 以 `r * width + q` 索引。
- Atlas 是 49×49 dense arrays 上半徑 24 的六角形，外緣一圈薄山。vocabulary：山（wall）、水（swamp）、黑格（abyss，失敗）、治療區（tier 1 或 ★ tier 2）與副作用區；sim 仍支援同層 A→B portal，但 generator 不生成。全部受探索遮罩保護，霧下只畫等高線。
- mapgen 先以 seed 建出整數 elevation 骨架（厚內環＋彎曲隘口、外弧、單入口盆地、湖），每條隘口以生成期 bounded BFS 驗證可通過；再在真實 terrain traversal 上 constructive 地建立不同疾病與 reference；不保護跨 seed 通用的安全走廊。每疾病有 easy 區與含 ★ 的 hard 區，空白處補小區，★ 周圍、窄道出口與平地散布黑格，全圖保持連通。
- constructed endpoint 是乾淨 cure；同一 cure region 的部分其他格可同時有 SideEffect overlay。Cure 與 SideEffect 可在同一 final cell 同時成立。
- 預設六個 reference（疾病 d 在 base `d mod 3`）依 initial catalog、`zigzag`、`loop`、`straight`＋`crane` 分 tier，第一個目標不用尚未解鎖的機器。疾病的 reference、endpoint、region、difficulty 與 price 必須有 seed／疾病差異。
- 同 seed + 完整設定仍逐欄位重現相同 terrain、疾病、effects 與 references。solver 只供 tests/tools 驗證整個 cure region 的 minimum steps／cost、seed diversity 與品質，不進遊戲內自動解。

## Factory

- Production Plan 與 Production共用footprint、ports、routing與direct-manipulation editor；非Erase transport不覆蓋machine，clipboard保存完整tile payload。
- transport renderer 依六邊實際accept／emit connection畫endpoint、對向straight、60°／120°turn、multi-way junction與machine ports。
- Belt 拖曳使用六鄰接連續 route，逐格設定 E／SE／SW／W／NW／NE 方向；machine footprint／ports 支援六個順時針 60° rotations。
- Source 指定 base，產出的 unit 只在該 base 的圖上走；Plan 的 Research 帶狀線只在 Atlas 顯示該 base 時畫。
- Production 價格：belt 2、splitter／merger 8、source 12、sink 6、machine `10 × processing cost`；拆除不退款。

## Bootstrap 與 Market

- 正常新局 cash 是 $1000；fresh player 不靠注入資源、hidden reference 或 compiler，必須能完成 Research → 建廠 → first sale。
- 依到達難度的分區價格：每個 cure region `price = 60 + 2 × difficulty`，`difficulty = min(120, 最便宜路線成本 + 6 × 窄段 + 2 × 路線旁 Abyss)`（D38）；產品依終點所在區計價，`basePrice` 只是最便宜區價。各疾病 demand 獨立；每次出售後 next gross 變成 `floor(previous × 19 / 20)`，直到 0。終點在 ★ 的產品 gross 是 `demand + floor(demand / 2)`。
- Cure 與 SideEffect 可重疊；Market 先選 side effects 較少、再選 production cost 較低的庫存，只單賣或批量出售仍有正 net 的產品。
- 開放世界（D50）：沒有目標卡或合約顯示；新局所有機器與 Split／Merge 已開。Market 卡片標出疾病所在 base。
- Technology 目前是免費開關（測試期，D42）；固定五-seed regression 與較廣代表樣本從 $1000 跑完整合法路線並保留 $100 assay retry／小改建預算。

## Blueprint 與 Save

- Blueprint v4 codec 識別只存 ordered `{typeId}` 的 `research-program`，但 UI 對它只提供import／download／delete，不提供capture／apply；`factory-layout` 存 routing 與 `{id,typeId,anchor,footRot}`，可正常建立與套用。Library envelope／namespace 是 v4／`hexapharma.blueprint-library.v4`。
- Factory Blueprint 不綁來源場域，可免費開到 Production Plan，或付費 Commission 到 Production。Library 與 save slots 分離並跨存檔。
- Save v16 保存 non-null Production layout/runtime（Source、unit 帶 base）、結算後 cash、Research `lastTrial`（含 base）、drug heading／offset、帶 `premium`／`regions` 的 outcome、內部 pilot、economy 與每 base 的 fog；舊開發版（含 v15）啟動時刪除。Blueprint ruleset 6（Source 帶 base）。
- 正式 release candidate 前不維護跨 build 相容。

## 技術界線

- 純 TypeScript sim core，React UI，PixiJS renderer，Vite build。
- Research path／mapgen 與 Production sim 都確定性；Production 熱 tick 使用固定容量資料結構。
- UI／renderer 只讀 sim 並送 intent，不能持有第二份 terrain、path、layout 或 transport authority。
- Atlas 與 Factory 使用同一 pointy-top axial orientation、`{q,r}` direction order與 `r * width + q` dense indexing；Research PathStamp 與 FactoryLayout 的 payload／validator 仍分離。
- 定向越野地圖語言的嚴格俯視 2D：紙底＋近黑墨印；ISOM 色語（山＝淡褐、水＝藍色水平線、黑格＝黑墨、治療＝綠、副作用＝琥珀、失敗＝紅、流動＝藍；霧下只有單一墨色等高線）；路線紫只屬玩家自己的線（研究路線、candidate、選取、Plan overprint）。Production 為黑墨實印、Plan 為紫色 overprint。手繪感只來自確定性墨線抖動，不用於 port、belt 接點、hit-test 幾何或文字；Pixi vector runtime 保留 canonical true hex。完整規格見 [design.md](design.md#visual-language)。

Canonical 規格見 [design.md](design.md)，詳細操作見 [player-guide.md](player-guide.md)，互動契約見 [ui-interaction.md](ui-interaction.md)。
