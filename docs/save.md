# Save v15 — open alpha snapshots

存檔是可攜、可編輯的 plain JSON。玩家可以直接修改合法的 Cash、sold 或 fog；沒有加密、簽章、browser key、資源收入 trace 或狀態 checksum。嚴格驗證只保護結構、記憶體／計算資源與可執行狀態。

## 格式與 APIs

- `serializeGame` / `deserializeGame`：`{version:15, contentBuild, game}`，inventory 逐件保存，便於檢查／編輯。
- `serializeSnapshot` / `deserializeSnapshot`：`{version:15, contentBuild, snapshot}`。snapshot 除 inventory 外與 game 相同；連續相同產品的 base／drug／productionCost／outcome 只存一次，以 `ids: [[factoryId, inventoryId], ...]` 保存每件身分。產品順序不改變，解碼先驗展開總數，再配置產品。
- `prepareSnapshot`：驗證並冷複製目前 state，回傳 `{game, serialized}` 給 storage 使用。
- `serializeSlots` / `deserializeSlots`：`{version:15, contentBuild, slots:[game,...]}`，最多 20 個 full states。
- `pushSnapshot` / `rewind`：冷複製且隔離 runtime；push 保留最新 20 項，rewind 回到指定快照並截斷後續 history。

full 與 compact 的差異只為實際容量需要：24,500 件相同產品若逐件重複完整資料會超過 browser slot 的原有上限，分組後仍可保存。兩者都直接還原 state，不執行 replay，也不持有 checkpoint chain。

例如修改 full save 的 `game.economy.cash` 後直接載入；compact save 對應 `snapshot.economy`。Cash 可為任意 safe integer（含負值）。不需修改 `contentBuild` 或提供原始收入記錄。

## 完整狀態與驗證

保存 generation options／seed、economy／sold、patents、Research `lastTrial`（`{base, program, cost, outcome}` 或 null）、Plan layout、Production layout／cold runtime／waste、inventory／nextInventoryId、每 base 一層 fog、rng。Source tile、在途 unit、產品都帶 `base`（0..nMaps−1）。每個 drug 是 `{pos, offset, heading, failed}`：只有所在 base 的一格與一個兩倍單位 Swamp offset（`pos`／`offset` 長度恰為 1），heading 0–5；outcome 的 `final` 也只有一格。machine（catalog、layout、program step）都帶 `turn`。規劃中的 Research 路線是 UI 本地狀態，不存檔。runtime 包含 tick、在途 unit 與位置／drug／加工進度／成本、nextUnitId、producedTotal、splitter cursors、deadlocked；product events 必須已由 game 層排空。

`deadlocked` 是最近一次 tick 的停滯診斷，不是停止執行的開關；每個真實 tick 都照常執行並重算。修改此旗標不會凍結可運作的工廠，週期性來源可以在稍後排定的 tick 恢復產出。讀檔保留旗標，不嘗試重播歷史來證明它。此語意修正將 content-build rules revision 升至 2；v2 的 heading／Swamp 半格／Run-based Research 再升至 3；v2 Atlas（新 mapgen、★ tier、`Outcome.premium`）升至 4，Save 版本同時升為 13；v2 Step 4（8 台機器、分區定價、`Outcome.regions`）升至 5，Save 升為 14；D43 基礎藥（三張同地形 base 圖、一劑一 base）升至 6，Save 升為 15。

解碼拒絕 unknown／missing fields、非法數值／array sizes、非本 build 的機器定義、未解鎖／超出廠區／碰撞的 layout、不守恆或占位不合法的 runtime，heading 不在 0–5、offset 不在 Swamp 內卻非零或超過一個單位方向的 drug，以及與實際 program／drug 不一致的 Research trial、inventory outcome：`lastTrial` 必須有 1..256 台屬於本 build catalog 且 path／turn 一致的 machines、cost 等於 catalog 總價，且在其 base 上從起點重播後 outcome 完全相同（其 machines 或 base 之後被 Technology 關閉仍可讀）；不要求過去收入或資源來源的 trace。v12 移除了 shot、program、lastOutcome 與 discoveredFormulas 欄位，出現即視為 unknown field。v14 的每個 outcome（`lastTrial`、inventory）恰為 `{failed, final, cured, premium, regions, sideEffects}`；`regions` 與 `cured` 等長、每項是 1..65535 的 region id，`premium`／`regions` 都必須與重播／地圖結果一致。區價本身不存檔，由同 content build 的 GenOptions 重新生成。in-flight progress／cost 在轉入 Int32Array 前必須可表示，不能截斷後冒充合法值。

`origin`、`intentTrace`、`replayTicks` 和 `stateHash` 不屬於 state 或存檔 schema。`replayGame(initial, intents)` 仍可用來重現 bug，同 initial state + inputs 仍逐欄位／hash 相同；存檔不用證明 checkpoint 之前做過哪些事。

## 相容性

`contentBuild` 是 catalog、shapes、patents 加手動 `rules` revision 的 FNV 識別，只用來判定 build 相容性，不是驗真。資料改動會改識別；**sim／mapgen／economy 程式語意改動必須在 save/index.ts 提升 rules revision**，目前沒有自動掃描全原始碼。識別或 version 不合，在解讀 state 前明確拒絕。

舊 alpha 存檔可直接失效；沒有 migration／legacy reader。修改資源值不需重算任何識別。詳見 [development-policy.md](development-policy.md)。

## Browser checkpoint 與 Rewind

key 為 `hexapharma.save.v15.checkpoint.${slot}`。外層 `{version:2, head, history}` 保存 compact JSON 字串，history 不重複 head。最多 20 個快照，按 characters（`string.length` 的 UTF-16 code units）／數量裁掉最舊項並回報；它們是獨立狀態，不驗 trace-prefix 或收入來源。同 generation options 的玩家編輯可保留在一份 history；不同地圖保存時替換 history。

正常 Load 嚴格拒絕 unknown／missing fields 與非字串 entry。讀取不寫 storage；損壞時可另提出經獨立 snapshot 驗證的最新有效同地圖 suffix 供明確 Recover。即使 envelope 多了欄位、缺少 head 或 head／history entry 不是字串，仍可從已知欄位的字串候選復原；非字串候選視為損壞缺口，不把缺口兩側的歷史接起來。只有可解析的同外層 version、history 為 array 且未超過字元／數量上限的 envelope 才可復原；錯誤版本、無法解析或超量輸入不嘗試 salvage。storage 讀取失敗顯示「cannot read storage」及原始原因、停用 Recovery，但可重試 Load。成功 Rewind／Recover 才原子寫入新 blob；寫入失敗保留原 blob。舊 namespace 不讀取、不 migration、不自動刪除。Load／Rewind 的覆蓋確認及 Blueprint Library 獨立性不變。

## 有限資源，不是 replay 壽命

| 邊界 | 規則 |
|---|---|
| 單次 Production API batch | 最多 100,000 ticks、100,000,000 estimated work；超量 batch 可拆小，不累積到下次 |
| Full / compact / slots JSON | 最多 7,000,000 characters（滿倉 24,500 件的 full save 約 6.03M，因 outcome 帶 cure region） |
| Browser slot blob | 最多 1,250,000 characters，最多 20 snapshots；無法容納 head 或 storage quota 不足時明確失敗 |
| Inventory | 最多 24,500 physical products；滿倉的生產操作原子拒絕，出售騰出空間後可繼續 |
| 其他 collections | fog 受地圖大小限制，Research 只保存最近一次試驗（program ≤ 256 machines），patents 受固定樹限制，in-flight units 受工廠容量限制；不保留終生操作 list |
| 數值 counters | tick、waste、save-global inventory ID、Cash／sold 受 safe-integer 表示範圍限制；溢位操作明確拒絕，不 wrap |
| Factory IDs／加工 buffers | 保留既有 Int32 表示範圍；factory unit IDs 為 0..2,147,483,647，每個 runtime 最多配置 2,147,483,648 IDs。Reset／重建會重設 runtime-local IDs／counters，不清 inventory 或其全局 IDs；沒有宣稱數學上的無限運行 |

這些是現有空間與數字表示的限制。曾經歷多少合法操作、tick 或 replay work，不再讓整局永久失去操作能力。
