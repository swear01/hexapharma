# 真人試玩與手動驗證

這份清單用來啟動 HexaPharma，並人工走完 Lab → Factory → Shop → Patents → Save/Load/Rewind 的 vertical slice。

## 1. 環境

- Node.js 20 以上。
- 第一次執行或 `package-lock.json` 改變後，在專案根目錄安裝依賴：

```bash
cd /home/ubuntu/hexapharma
npm ci
```

## 2. 啟動真人試玩伺服器

開發模式：

```bash
cd /home/ubuntu/hexapharma
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

看到 `Local`／`Network` URL 後保持該 terminal 開著。`--strictPort` 是必要條件：若 53346 已被使用，必須直接處理衝突，不能讓 Vite 靜默換 port。

開啟方式：

- 同一台機器：<http://127.0.0.1:53346/>
- Oracle Cloud 外部連線：`http://<Oracle 公網 IP>:53346/`

若要驗 production build，先停止 dev server，再執行：

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 53346 --strictPort
```

停止伺服器：回到啟動它的 terminal 按 `Ctrl+C`。

## 3. 五分鐘完整循環

使用預設網址 <http://127.0.0.1:53346/?seed=14>。預期初始狀態是 Cash 200、R&D 0、2 maps、地圖有迷霧。

### Lab

1. 可先勾選 `Reveal all (debug)`，方便確認地圖；它不會修改權威探索狀態。
2. 依序加入 `push` 五次，再加入 `swap01` 一次。
3. 按 `Run`。
4. 預期結果至少治療 disease 0，且出現 `Save recipe → Factory`。
5. 按 `Save recipe → Factory`，畫面應切到 Factory，並顯示 saved recipe。

### Factory

1. 按 `Step` 六次，確認 tick 從 0 增加。
2. 按 `Play`，等 `total sink outcomes`／produced 不再是 0，再按 `Pause`。
3. 確認 inventory 產生、waste 沒有被誤算成可售藥。
4. 可比較 `Preset: single` 與 `Preset: parallel`；parallel 的顯示吞吐應較高。

### Shop

1. 切到 `Shop`。
2. disease 0 的 Inventory 應大於 0。
3. 按 `Sell 1`：inventory 減少，Cash 增加，R&D 增加 1。
4. 多生產幾顆後可驗 `Sell all`；它應一次完成，且不能重複出售同一顆實體藥。

### Patents

1. 切到 `Patents`，確認 available／locked／unlocked 狀態合理。
2. 有至少 80 Cash + 1 R&D 時解鎖 `reveal-aid`。
3. 回 Lab，起點附近的 revealed 格數應增加。

## 4. 驗 2 → 3 → 4 maps

用試玩起始值開新頁：

<http://127.0.0.1:53346/?seed=14&cash=9999&research=9999>

1. 在 Patents 解鎖 `bench-2`。
2. 解鎖 `new-map`；先取消一次，確認狀態與資源沒有被誤改。
3. 再解鎖並確認警告；警告必須列出 recipe、factory layout/runtime、waste、inventory、fog、sales history 會被清除。
4. 回 Lab，預期顯示 3 maps、seed 15。
5. 解鎖並確認 `new-map-4`，預期顯示 4 maps、seed 16。

## 5. Save / Load / Rewind

1. 選擇一個 slot，按 `Save`，確認出現成功訊息。
2. 再做一個有效動作後再次 `Save`，建立同一 run 的 history。
3. 按 `Load`，確認 cash、recipe、factory、inventory、fog、patents 都回到該 slot head。
4. 按 `Rewind`，確認回到上一個 snapshot，重新整理頁面後 history 仍存在。
5. 若畫面報 corrupt/partial checkpoint，不要期待它被靜默清除；必須看到錯誤與明確 `Recover` 流程。

## 6. 自動閘

手動試玩前後都可以跑唯一自動驗收閘：

```bash
npm run check
```

它會執行 TypeScript、ESLint、Vitest、Chromium e2e，以及 production build/preview smoke。自動測試使用 53347／53348；真人試玩固定使用 53346。

## 7. 回報問題

每個 sim／關卡問題請附：

- seed 與生成設定／網址 query
- tick 區間
- 完整操作順序（input trace）
- 預期結果與實際結果
- 違反的不變式或第一個壞掉的 tick（若已知）
- 畫面截圖與瀏覽器 console error（若是 UI 問題）

