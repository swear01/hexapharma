# Save v11 — open alpha snapshots

存檔是可攜、可編輯的 plain JSON。玩家可以直接修改合法的 Cash、Knowledge、sold 或 fog；沒有加密、簽章、browser key、資源收入 trace 或狀態 checksum。嚴格驗證只保護結構、記憶體／計算資源與可執行狀態。

## 格式與 APIs

- `serializeGame` / `deserializeGame`：`{version:11, contentBuild, game}`，inventory 逐件保存，便於檢查／編輯。
- `serializeSnapshot` / `deserializeSnapshot`：`{version:11, contentBuild, snapshot}`。snapshot 除 inventory 外與 game 相同；連續相同產品的 drug／productionCost／outcome 只存一次，以 `ids: [[factoryId, inventoryId], ...]` 保存每件身分。產品順序不改變，解碼先驗展開總數，再配置產品。
- `prepareSnapshot`：驗證並冷複製目前 state，回傳 `{game, serialized}` 給 storage 使用。
- `serializeSlots` / `deserializeSlots`：`{version:11, contentBuild, slots:[game,...]}`，最多 20 個 full states。
- `pushSnapshot` / `rewind`：冷複製且隔離 runtime；push 保留最新 20 項，rewind 回到指定快照並截斷後續 history。

full 與 compact 的差異只為實際容量需要：24,500 件相同產品若逐件重複完整資料會超過 browser slot 的原有上限，分組後仍可保存。兩者都直接還原 state，不執行 replay，也不持有 checkpoint chain。

例如修改 full save 的 `game.economy.cash` 或 `game.economy.research` 後直接載入；compact save 對應 `snapshot.economy`。Cash 可為任意 safe integer（含負值），Knowledge 須為 non-negative safe integer。不需修改 `contentBuild` 或提供原始收入記錄。

## 完整狀態與驗證

保存 generation options／seed、economy／sold、patents、Research program／shot／lastOutcome／formulas、Plan layout、Production layout／cold runtime／waste、inventory／nextInventoryId、fog、rng。runtime 包含 tick、在途 unit 與位置／drug／加工進度／成本、nextUnitId、producedTotal、splitter cursors、deadlocked；product events 必須已由 game 層排空。

解碼拒絕 unknown／missing fields、非法數值／array sizes、非本 build 的機器定義、未解鎖／超出廠區／碰撞的 layout、不守恆或占位不合法的 runtime，以及與實際 program／drug 不一致的 Research、formula、inventory outcome。in-flight progress／cost 在轉入 Int32Array 前必須可表示，不能截斷後冒充合法值。

`origin`、`intentTrace`、`replayTicks` 和 `stateHash` 不屬於 state 或存檔 schema。`replayGame(initial, intents)` 仍可用來重現 bug，同 initial state + inputs 仍逐欄位／hash 相同；存檔不用證明 checkpoint 之前做過哪些事。

## 相容性

`contentBuild` 是 catalog、shapes、patents 加手動 `rules` revision 的 FNV 識別，只用來判定 build 相容性，不是驗真。資料改動會改識別；**sim／mapgen／economy 程式語意改動必須在 save/index.ts 提升 rules revision**，目前沒有自動掃描全原始碼。識別或 version 不合，在解讀 state 前明確拒絕。

舊 alpha 存檔可直接失效；沒有 migration／legacy reader。修改資源值不需重算任何識別。詳見 [development-policy.md](development-policy.md)。

## Browser checkpoint 與 Rewind

key 為 `hexapharma.save.v11.checkpoint.${slot}`。外層 `{version:2, head, history}` 保存 compact JSON 字串，history 不重複 head。最多 20 個快照，按 characters（`string.length` 的 UTF-16 code units）／數量裁掉最舊項並回報；它們是獨立狀態，不驗 trace-prefix 或收入來源。同 generation options 的玩家編輯可保留在一份 history；不同地圖保存時替換 history。

讀取不寫 storage；損壞時只提出可驗證的最新有效 suffix 供 Recover。成功 Rewind／Recover 才原子寫入新 blob；寫入失敗保留原 blob。舊 namespace 不讀取、不 migration、不自動刪除。Load／Rewind 的覆蓋確認及 Blueprint Library 獨立性不變。

## 有限資源，不是 replay 壽命

| 邊界 | 規則 |
|---|---|
| 單次 Production API batch | 最多 100,000 ticks、100,000,000 estimated work；超量 batch 可拆小，不累積到下次 |
| Full / compact / slots JSON | 最多 5,000,000 characters |
| Browser slot blob | 最多 1,250,000 characters，最多 20 snapshots；無法容納 head 或 storage quota 不足時明確失敗 |
| Inventory | 最多 24,500 physical products；滿倉的生產操作原子拒絕，出售騰出空間後可繼續 |
| 其他 collections | fog 受地圖大小限制，formulas 受疾病數限制，patents 受固定樹限制，in-flight units 受工廠容量限制；不保留終生操作 list |
| 數值 counters | tick、waste、save-global inventory ID、Cash／Knowledge／sold 受 safe-integer 表示範圍限制；溢位操作明確拒絕，不 wrap |
| Factory IDs／加工 buffers | 保留既有 Int32 表示範圍；factory unit IDs 為 0..2,147,483,647，每個 runtime 最多配置 2,147,483,648 IDs。Reset／重建會重設 runtime-local IDs／counters，不清 inventory 或其全局 IDs；沒有宣稱數學上的無限運行 |

這些是現有空間與數字表示的限制。曾經歷多少合法操作、tick 或 replay work，不再讓整局永久失去操作能力。
