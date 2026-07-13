# 真人試玩與手動驗證

這份清單驗證目前 content build 的 Research → Pilot Plant → Production → Market/Technology，以及 Blueprint/Save。舊 build 存檔不在範圍內。

## 1. 安裝與啟動

```bash
cd /home/ubuntu/hexapharma
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 同機器：<http://127.0.0.1:53346/?seed=14&cash=10000&research=100>
- 遠端：`http://<Oracle 公網 IP>:53346/?seed=14&cash=10000&research=100`
- `53346` 是 Oracle Cloud 唯一白名單 port；`--strictPort` 必須保留。若被占用，先解決衝突，不可讓 Vite 換 port。
- production build：先停 dev，執行 `npm run build && npm run preview -- --host 0.0.0.0 --port 53346 --strictPort`。

第一次進本 breaking build 可清除該 origin 的 localStorage；本階段不維護跨 build save。

## 2. 快速準備 seed 14 Research route

從零建造時，以 Route Floor 的 Source／Belt／Sink／machine hotbar 直接擺唯一線性路線。要快速驗完整循環，可使用目前 build 受測的 fixture：

`docs/examples/seed14-research.hexapharma.json`

1. 按 `B` 開 Blueprint Library。
2. 把上列檔案內容貼入 Portable JSON，按 **Import pasted JSON**；或用 **Upload JSON** 選該檔。
3. 在 `Seed 14 manual smoke route` 按 **Load**。Library 應將它套到 Research；未知欄位、錯誤 checksum/content fingerprint 或非線性 Research topology 必須拒絕。
4. 按 `Escape` 關 drawer，切 Research → Route Floor。應看到 source→8 個 Push→sink 的實體 multi-cell 路線；不是 Recipe 卡片或 auto-packed overlay。

此 fixture 只用於手動 smoke，不是遊戲內自動解。一般玩測應自行探索。

## 3. Atlas / Research

1. 回 **Effect Atlas**。初始 A 層為 `63×63`，藥在 authority `(31,31)`、UI 相對 `(0,0)`，並精確位於一個 origin-aligned 5×5 major block 的中心。
2. 確認只看到大地圖局部（約 `17×13` 格），每格 minor／每 5 格 major grid；不得有穿過玩家的 X/Y 十字軸。
   - desktop/compact 的格子都必須保持正方形；390px status 不得溢出或被底部 navigation 遮住。
3. 未知 terrain 必須完全被原創 fog 遮住。初始 `revealed 49/3969`；不存在 reveal-all。
4. drag pan、wheel cursor-anchor zoom。先把鏡頭拖離藥物，按 **Focus/F** 應只置中一次；之後 shot 移動不得 auto-follow 搶回鏡頭。
5. Route Floor 的規劃與切頁不得改 fog 或 cash。
6. 按 **Dispense**：cash 只在開始扣一次，按鈕執行中 disabled，Atlas 每約 320ms 完成一台機器。只允許已完成 step 的 cyan trail/radius-1 fog reveal；未來 route 不得先揭露。
7. 可在中途按 **Abort · no refund**；shot 停止、cash 不回復、已揭 fog 保留。重新 Dispense 會再付一顆成本。
8. 正常走完 fixture 後顯示 validated cure，命令改成 **Send to Pilot Plant**。

## 4. Pilot Plant

1. 送出後自動進 F2。layout 尺寸、tiles、machine IDs/anchors、effect orientation/flip、footRot 必須和 Research 逐欄位相同，不能重新排列。
2. 上方顯示 **No clock · layout edits are free**；沒有 Play/Pause/Step、inventory、waste 或 cash 扣款。
   - 390px 首次開啟，或先看過空 Pilot 後再收到 same-size Research transfer 時，既有機器必須自動捲入 hotbar 上方可見區，不能只剩被遮住的彩色邊緣。
3. inspector 應即時顯示完整 sample outcome（cures、side effects、final endpoints）、throughput、bottleneck 與 contract match。Research Route Floor 不得提前顯示 sample outcome。
4. 驗證直接操作：LMB drag build、RMB erase、Shift/MMB pan、wheel zoom、`R` rotate、`Q` pipette、`Ctrl+C/X/V`、`Ctrl+Z/Y`。先做一個變更再 undo，確認 contract 回到 matches。
5. 按 **Commission**（accessible label 為 Validate Pilot layout and commission Production）；若 layout 不實現 Research contract，必須可見拒絕，不能 silent repair。
6. Pilot 可另存 `pilot-plant` Blueprint；它允許量產幾何。Research Blueprint 則只允許唯一線性 route。

## 5. Production / Market / Technology

1. 未 commission 前直接開 F3，應看到 Production offline 指引，不能從零繞過 Pilot 編輯。
2. commission 後 F3 顯示 exact Pilot layout。按 Step，tick 恰 +1；Play 後只有 Production 時間流動。
3. 等 `Total sink outcomes` 增加後 Pause；有效 contract products 進 Stock，不符/failed outcome 增加 Waste。
4. 按 `M` 開 Market，對有庫存疾病按 **Ship one**：Stock 減一、Cash 增加、Knowledge 恰 +1。同一實體藥不能賣兩次。
5. 按 `T` 開 Technology。一般節點顯示 prerequisite/cash/Knowledge；deeper-map 節點必須先列出清三場域、inventory、fog、sales 的警告並要求確認。
6. `M/T/B` drawers 都能用 `X` 或 Escape 關閉，且不冒充第四個建築頁。

## 6. Blueprint 跨 save 與嚴格匯入

1. 在 `B` 將目前 Pilot 存為 Blueprint，下載 JSON，並在 textarea 看到 version/checksum/content fingerprint。
2. Save slot 1，切 slot 2 或 Load/Rewind slot 1；Blueprint Library 內容不得改變。
3. 匯入剛下載的 JSON，checksum 相同應去重。
4. 手動修改 name/layout 但不重算 checksum，必須拒絕；檔案 >1 MiB 必須在讀全文前拒絕。
5. Blueprint 內容不得含 seed、fog、cash、Knowledge、patents、contract、outcome、runtime、inventory 或 waste。

## 7. Save / Load / Rewind

1. 選 slot，按 Save；做一個有效動作再 Save，建立同 origin history。
2. Load 應恢復 Research/Pilot/Production、runtime、inventory、fog、economy、patents。
3. Rewind 回上一 snapshot，reload 後 history 仍存在。
4. corrupt/partial blob 必須顯示錯誤；按 Recover 前不得自動刪除或覆寫。
5. v4/舊 intent schema 必須明確拒絕；這是早期 save policy，不是 migration bug。

## 8. 自動閘與回報

```bash
npm run check
```

它依序執行 typecheck、ESLint、完整 Vitest suite、Chromium/production-preview Playwright，以及 Atlas、Production、machine-family gallery、390px Research/Pilot screenshot baselines。自動 server 使用 53347/53348；真人固定 53346。

Bug 回報附：URL/seed/GenOptions、tick 區間、完整操作/input trace、預期/實際、第一個違反的不變式，以及 UI 截圖/console error。
