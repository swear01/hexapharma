# Early Development Policy

HexaPharma 目前是早期開發中的 pre-release 專案。正確性閘、確定性與目前 build 內的存讀檔仍須可靠，但**不承諾任何跨 build 的存檔相容性**。

## 存檔範圍

- Save／Load／Rewind 的 round-trip、corruption handling 與 replay invariants，只保證在產生該存檔的同一個 content build 內成立。
- 地圖生成、資料 schema、專利、經濟或 sim 語意改動時，可以直接讓舊 localStorage checkpoint 失效、變更版本或要求清除站點資料。
- 早期開發不建立 legacy map generator、跨 build migration chain 或永久相容 reader；除非未來進入正式 release 候選階段並另立版本政策。
- 測試中的 `legacy` 是目前 storage layout／wire reader 的完整性測試，不代表承諾支援任意歷史 build。

## 仍然必須守住

- 同 build、同完整 `GenOptions`、同 seed 與同 input trace 必須逐欄位重現。
- 當前 build 的合法 save 必須 round-trip；corrupt／partial／偽造 authority 必須顯式拒絕，不可冒充成功。
- 行為、schema 或操作方式改動時，同一個 change 必須同步更新 active docs、測試與手動 playtest 步驟。

## 進入正式相容期的條件

只有在明確宣告 save format freeze／release candidate 後，才新增跨版本 migration matrix、相容期與 deprecation policy。在那之前，開發速度與現行設計正確性優先於舊開發存檔延續。
