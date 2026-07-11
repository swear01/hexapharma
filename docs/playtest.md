# 真人試玩與手動驗證

這份清單用來啟動 HexaPharma，並人工走完 Lab → Factory → Shop → Patents → Save/Load/Rewind 的 vertical slice。

## 1. 環境

- Node.js 20 以上。
- 目前不保證跨 build 存檔相容；切到新的 breaking build 後，先清除該站點的 localStorage／站點資料再開始本輪驗證。
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

同機器使用 <http://127.0.0.1:53346/?seed=14>；遠端則把 host 換成 Oracle 公網 IP：`http://<Oracle 公網 IP>:53346/?seed=14`。預期初始狀態是 Cash 200、R&D 0、1 map；Layer A 為 `63×63`，藥物在正中央，初始只揭露 radius 3 的 `49/3969` 格。

### Lab

1. 確認畫面只是一張大地圖的局部，不是全 `63×63` 或多圖並排；未知區應是原創 defocused biochemical fog，不應看到「?」debug 格。
2. 在圖上 drag 平移、wheel 以游標錨定縮放；按 `F` 或 `Focus` 回到藥物並進入 follow。100% 約可見 `11×8` 格，canvas intrinsic size 應為 `704×512`。
3. 點 `Long Push` pictogram 或按 `2`；確認它先進入 held 狀態，Recipe step 數仍為 0，尾端插入槽與地圖橙色虛線／capsule 先顯示結果。點插入槽 commit，重複到 `push2 × 4`。預設朝東；held 或選取卡片後以 `R/H` 旋轉／鏡射，Escape 取消 held。
4. 把任一卡拖到另一插入位置，放下前應先看到完整重排 route；放下後用 `Ctrl+Z/Y` 復原／重做。點卡片後 Delete 只刪所選步，`Q` 可 pipette。Phase Exchange A↔B 在目前單層必須顯示 locked／不可選，未知 fog 內不能顯示精確 route 或 endpoint。
5. 按 `Run` 或 Space；指令軌 playhead 應逐步前進，動畫中再次按 Space／`Stop` 應可取消。
6. 預期結果治療 disease 0，且右側 `Run a valid recipe to ship` 變為可按的送廠動作。
7. 送往 Factory 後，F2 Factory rail 應 active，右側顯示 saved recipe。

### Factory

1. 以底部 1–0 hotbar 選工具；LMB drag 連續建造，RMB drag 拆除，`R` 旋轉，hover 後 `Q` pipette。每次 drag 應只新增一筆 undo。
2. Shift+LMB／MMB drag 平移，wheel 以游標下方為錨縮放，`⌖` 重置鏡頭；觸控以 tap 放置、drag 平移。鏡頭操作不得修改權威 layout。
3. hover 物件後驗 `Ctrl+C/X/V` copy／cut／paste，以及 `Ctrl+Z/Y` undo／redo；新 edit 應切斷 redo branch，history 最多 50 筆。
4. 按 `Step` 六次或使用 `.`，確認 tick 從 0 增加；按 `Play`／Space，等 `total sink outcomes` 不再是 0，再 Pause／Space。
5. 確認 inventory 產生、waste 沒有被誤算成可售藥；可比較 inspector 底部 `Single` 與 `Parallel`，後者吞吐應較高。

### Market

1. 按 F3 或 rail 切到 `Market`；確認介面是 disease cards，不是資料表。
2. disease 0 的 Inventory 應大於 0。
3. 按 `Sell 1`：inventory 減少，Cash 增加，R&D 增加 1。
4. 多生產幾顆後可驗 `Sell all`；它應一次完成，且不能重複出售同一顆實體藥。

### Patents

1. 按 F4 或 rail 切到 `R&D`，確認 research lattice 的 available／locked／unlocked 狀態合理。
2. 有至少 80 Cash + 1 R&D 時解鎖 `reveal-aid`。
3. 回 Lab，起點附近的 revealed 格數應增加。

## 4. 驗 1 → 2 → 3 → 4 layers 與 Phase Exchange

用試玩起始值開新頁：

<http://127.0.0.1:53346/?seed=14&cash=9999&research=9999>

1. 在 Patents 解鎖 `bench-2`。
2. 解鎖 `new-map`；先取消一次，確認狀態與資源沒有被誤改。
3. 再解鎖並確認警告；警告必須列出 recipe、factory layout/runtime、waste、inventory、fog、sales history 會被清除。
4. 回 Lab，預期顯示 2 maps、seed 15，尺寸仍為 `63×63`；A/B tabs 可切換且各自保留鏡頭。A 的 start 在 `(31,31)`，B 在近中心的 `(38,31)`。
5. 確認 Phase Exchange A↔B 已可用。其用途是交換兩層的**座標**：before 的 A/B 各保留自己位置，after 為 A 收到 B 原座標、B 收到 A 原座標；因 B 有 phase offset，剛解鎖時也不是 no-op。
6. 解鎖並確認 `new-map-4`，預期顯示 3 maps、seed 16、出現 C tab，尺寸仍為`63×63`。
7. 解鎖並確認 `deep-map-4`，預期顯示 4 maps、seed 17、出現 D tab，尺寸仍為`63×63`。

## 5. Save / Load / Rewind

本節只驗證目前 build 內的存檔，不測任何舊 build migration。

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
