# Early Development Policy

HexaPharma 目前是 alpha。存檔採**完全開放、plain JSON、可攜且可由玩家編輯**的政策；不需要加密、browser key、簽章、防作弊或資源來源證明。合法修改 Cash／Knowledge 不要求修改任何 checksum 或收入 trace。

## 存檔相容性

- 當前 Save v11 直接保存冷狀態；full／compact／slots／Rewind 的 correctness 只保證同一個 content build。
- alpha 可以直接破壞舊存檔相容性。舊格式明確拒絕，不維護 migration chain、legacy reader 或舊 generator，也不自動刪除／覆寫舊 namespace。
- `contentBuild` 是 catalog／shapes／patents 加手動 `rules` revision 的確定性識別，**不是驗真或防改**。變動這些資料會改識別；sim／mapgen／economy 程式語意改動則必須在 `src/sim/save/index.ts` 明確提升 `rules`。目前沒有自動 whole-source fingerprint。
- 修改存檔本身的合法資源不改 `contentBuild`。它描述相容的遊戲內容，不描述該玩家狀態。
- Blueprint 與 save 是獨立格式／namespace；Save／Load／Rewind／New Game 不改 Blueprint Library。

## 必須守住

- 同 build、同 initial state 與明確提供的 input sequence 必須逐欄位及 hash 重現；這是 sim debugging 契約，存檔不需保存或執行整局歷史。
- 在途生產、Research／formulas、fog、economy、patents、inventory 與 counters 完整 round-trip，不共享可變 runtime buffers。
- 僅保留結構／資源安全與可執行狀態不變式。unknown／missing fields、unsafe integers、無效 layout／runtime／outcome、oversize 等顯式拒絕；不將「可合法編輯但沒有賺取證明」視為損壞。
- 無效操作與失敗寫入保持原子性。文件與測試和 behavior／schema 的變更一同更新。

詳細格式、容量及數值上限見 [save.md](save.md)。正式 release candidate 才另行決定格式凍結與相容政策；目前不建立跨 build migration 承諾。
