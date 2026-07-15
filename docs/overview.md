# Overview

HexaPharma 是「程序化藥效 Atlas + 實體工廠」的確定性單人遊戲。三個 world page 使用一致的直接操作語言，但擁有彼此獨立的 authority。

## 三個場域

1. **Research**
   - 單一大型 Atlas；玩家依序放入 catalog 定義的完整奇形 `PathStamp`。
   - 只有牆始終可讀；深淵、沼澤、成對傳送門、治療區與副作用區都藏在霧下。
   - 未揭露互動物不改變規劃預覽；只有出藥後的實際路徑會揭露內容。
   - Research 不產生工廠 layout，也不是 Pilot 或 Production 的前置條件。
2. **Pilot Plant**
   - 無時間、無建造費、無 inventory／waste 的 `FactoryLayout` 沙盒。
   - 可立即觀察 outcome、throughput、bottleneck 與 deadlock；診斷只提供資訊。
   - 可保存 Factory Blueprint，或依 Production 差異報價付費建造。
3. **Production**
   - 新局即有空白 24×12 editor；玩家可直接建廠，不需先開 Pilot。
   - 每次 layout edit 付建造費。接受變更後重建 runtime，但保留累積 waste。
   - 唯一具有連續 tick、在途產品、inventory、waste 與經濟後果的場域。

## Atlas 與地圖生成

- 現行 Research 是單層 Atlas；跨層互動與交換層工具暫不提供。
- Atlas vocabulary 是 wall、abyss、swamp、同層 A→B portal、治療區與副作用區；除 wall 外都受探索遮罩保護。
- mapgen 使用 seeded radial structure + motifs，constructive 地產生可探索路線；同 seed + 完整設定重現相同 Atlas 與 reference program。
- solver 只供 tests/tools 驗證與分析，不進遊戲內自動解。

## Factory

- Pilot 與 Production 共用 footprint、ports、routing 與 direct-manipulation editor。
- transport renderer 依實際 accept／emit connection 畫 endpoint、straight、corner、tee、cross 與 machine ports。
- Belt 拖曳使用四向連續的單一正交轉角，逐格設定方向，不產生對角階梯。
- Production 價格：belt 2、splitter／merger 8、source 12、sink 6、machine `10 × processing cost`；拆除不退款。

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
