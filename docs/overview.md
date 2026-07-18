# Overview

HexaPharma 是「程序化藥效 Atlas + 實體工廠」的確定性單人遊戲。三個 world page 使用一致的直接操作語言，但擁有彼此獨立的 authority。

## 三個場域

1. **Research**
   - 單一大型 Atlas；正常新局同圖有 4 種獨立疾病，generator 最多支援 8 種。
   - 玩家依序使用 catalog 定義的完整奇形 `PathStamp`；選擇只產生 candidate，點中 candidate endpoint 才加入，空白地圖點擊不會 append。
   - ordered route strip 顯示每步與總費用並可逐步移除；出藥 camera 跟隨藥物，結果同時回報已知 cure／side effects。
   - 只有牆始終可讀；深淵、沼澤、成對傳送門、治療區與副作用區都藏在霧下。
   - 新局只揭露以 Atlas 中心起點為中心的 5×5。
   - 未揭露互動物不改變規劃預覽；只有出藥後的實際路徑會揭露內容。
   - Research 不產生工廠 layout，也不是 Pilot 或 Production 的前置條件。
2. **Pilot Plant**
   - 無時間、無建造費、無 inventory／waste 的 `FactoryLayout` 沙盒。
   - 可立即觀察 throughput、bottleneck、deadlock 與已知地圖上的 sample outcome；Pilot 只讀 fog-masked planning map，不能免費查詢隱藏 Atlas authority。
   - 可保存 Factory Blueprint，或依 Production 差異報價付費建造。
3. **Production**
   - 新局即有空白 24×12 editor；玩家可直接建廠，不需先開 Pilot。
   - 每次 layout edit付建造費。只有接受的變更停止播放並重建runtime；no-op／invalid／現金不足不動world，累積waste保留。
   - 唯一具有連續 tick、在途產品、inventory、waste 與經濟後果的場域。

## Atlas 與地圖生成

- 現行 Research 是單層 Atlas；跨層互動與交換層工具暫不提供。
- Atlas vocabulary 是 wall、abyss、swamp、同層 A→B portal、治療區與副作用區；除 wall 外都受探索遮罩保護。
- mapgen 先以 seed 建完 radial/motif terrain，再在真實 terrain traversal 上 constructive 地建立不同疾病與 reference；不保護跨 seed 通用的安全走廊。
- constructed endpoint 是乾淨 cure；同一 cure region 的部分其他格可同時有 SideEffect overlay。Cure 與 SideEffect 可在同一 final cell 同時成立。
- 預設四個 reference 依 initial catalog、`skew`、`dilute`、`settle` 分 tier，第一個目標不用尚未解鎖的機器。疾病的 reference、endpoint、region、difficulty 與 price 必須有 seed／疾病差異。
- 同 seed + 完整設定仍逐欄位重現相同 terrain、疾病、effects 與 references。solver 只供 tests/tools 驗證整個 cure region 的 minimum steps／cost、seed diversity 與品質，不進遊戲內自動解。

## Factory

- Pilot 與 Production共用footprint、ports、routing與direct-manipulation editor；非Erase transport不覆蓋machine，clipboard保存完整tile payload。
- transport renderer 依實際 accept／emit connection 畫 endpoint、straight、corner、tee、cross 與 machine ports。
- Belt 拖曳使用四向連續的單一正交轉角，逐格設定方向，不產生對角階梯。
- Production 價格：belt 2、splitter／merger 8、source 12、sink 6、machine `10 × processing cost`；拆除不退款。

## Bootstrap 與 Market

- 正常新局 cash 是 $1000；fresh player 不靠注入資源、hidden reference 或 compiler，必須能完成 Research → 建廠 → first sale。
- 疾病 base price 是 `12 + 4 × difficulty + 2 × referenceCost`。各疾病 demand 獨立；每次出售後 next gross 變成 `floor(previous × 9 / 10)`，直到 0。
- Cure 與 SideEffect 可重疊；Market 先選 side effects 較少、再選 production cost 較低的庫存，只單賣或批量出售仍有正 net 的產品。

## Blueprint 與 Save

- Blueprint v3：`research-program` 只存 ordered `{typeId}`；`factory-layout` 存 routing 與 `{id,typeId,anchor,footRot}`。
- Factory Blueprint 不綁來源場域，可免費開到 Pilot，或付費建到 Production。Library 與 save slots 分離並跨存檔。
- Save v7 保存 non-null Production layout/runtime、paid build intents、Research、Pilot、economy 與 fog；舊開發版顯式拒絕。
- 正式 release candidate 前不維護跨 build 相容。

## 技術界線

- 純 TypeScript sim core，React UI，PixiJS renderer，Vite build。
- Research path／mapgen 與 Production sim 都確定性；Production 熱 tick 使用固定容量資料結構。
- UI／renderer 只讀 sim 並送 intent，不能持有第二份 terrain、path、layout 或 transport authority。

Canonical 規格見 [design.md](design.md)，詳細操作見 [player-guide.md](player-guide.md)，互動契約見 [ui-interaction.md](ui-interaction.md)。
