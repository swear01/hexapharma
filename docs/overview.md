# Overview

HexaPharma 是「程序化多層藥效地圖 + 實體工廠」的確定性單人遊戲。玩家不是在網頁式 Recipe 列表排步驟，而是在三個獨立建築使用同一套空間語言完成探索、打樣與量產。

## 三個建築

1. **Research**
   - Route Floor 擺唯一 source→machines→sink 實體路線。
   - Effect Atlas 顯示大地圖局部、origin-aligned 5×5 major grid 與 opaque fog。
   - 規劃不揭霧；Dispense 一次付 `max(1, Σ機器成本)`，藥逐步前進，只有完成步驟才沿真實 trail 揭 radius 1。
   - Abort／失敗不退款；完成非 failed cure 才能送 Pilot。
2. **Pilot Plant**
   - 沒有時間、耗材、庫存或 waste；免費立即測試實體排布。
   - 收到 Research 的 exact layout + derived effect contract。
   - 驗 layout 真正實現 contract 後，exact transfer 到 Production。
3. **Production**
   - 唯一有連續 tick、在途藥、吞吐、庫存與 waste 的建築。
   - 玩家以 routing、並聯和空間打包量產，不可任意改機器 speed。

## 世界與效果

- 一張 map 是一種成分；一顆藥在 1–4 層各有一個整數座標。
- 機器是 translate／scale／Phase Exchange 等確定性變換。
- 新局在 `63×63` A 層中心 `(31,31)`，UI 顯示相對 `(0,0)`；平時只看到約 `17×13` 格。
- 每格 minor grid、每 5 格 major grid；沒有跟玩家重疊的 X/Y 十字軸，也沒有自動跟鏡。
- 同 content build 的 seed + 完整生成設定決定逐欄位相同地圖、難度與價格。

## 管理系統

- **Market** 與 **Technology** 是 drawers；銷售實體成品取得 cash + Knowledge。
- **Blueprint Library v1** 獨立於 save slots，可 capture Research/Pilot、嚴格 JSON 匯入匯出、跨存檔保留。
- **Save v5** 保存三場域與 canonical intent trace；早期開發不維護跨 build 相容。

## 技術界線

- 純 TypeScript sim core，React UI，PixiJS render，Vite build。
- sim/mapgen 確定性；Production 成功熱 tick 使用固定容量 SoA、零配置。
- production 不 import solver；solver 只供 tests/tools。
- UI/renderer 只讀 sim 並送 intent，不能直接改 authority。

Canonical 規格見 [design.md](design.md)，操作契約見 [ui-interaction.md](ui-interaction.md)，啟動與手測見 [playtest.md](playtest.md)。
