# Plan

## Current milestone — readable Research + direct paid Production

這是 breaking TDD redesign。舊 build 的測試數量、截圖與 smoke 不作本次完成證據；每個最終 commit 都必須重新跑 gate。

### TDD implementation order

1. **Freeze target interfaces and RED tests**
   - `Machine` 無可變路徑長度；Research step 一律完整 fixed `PathStamp`。
   - Production layout/runtime non-null；唯一 layout edit intent 是 `buildProductionLayout`。
   - Blueprint v3 `research-program {typeId}` + generic `factory-layout`；Save v7 拒絕舊 schema。
   - 先寫 fixed-path、terrain visibility、paid build atomicity、transport topology 與 codec tests。

2. **Research visibility and path rules**
   - 只有 Wall 不受探索遮罩隱藏；Abyss／Swamp／Portal A+B／Cure／SideEffect 未揭露時中性化。
   - planning map、renderer、region edges 與 preview 共用同一 visibility rule。
   - 移除所有只走部分 machine path 的 UI、state、trace、Blueprint 與 Save 欄位。
   - 驗證規劃不改 fog，只有 Research shot 的 actual segments 揭露。

3. **Production construction authority**
   - 新局建立空 24×12 Production editor，不需要 Pilot。
   - `quoteProductionBuild`：belt 2、split／merge 8、source 12、sink 6、machine `10 × cost`；拆除不退款。
   - layout edit 現金不足時原子拒絕；成功時扣費、own layout、reset runtime、preserve waste。
   - paid build trace 不合併；replay/hash/save 重現每次 cash 變化。

4. **Pilot and Blueprint flow**
   - Pilot 維持 free/no-clock optional sandbox。
   - Pilot 可用 `Build $N` 走同一 paid Production intent；Production 也可直接編輯。
   - Factory Blueprint 可由 Pilot 或 Production capture，免費開 Pilot 或付費建 Production。
   - Library v3 quota、dedupe、upload/download 與 cross-save lifecycle 全部 strict。

5. **Connected factory rendering**
   - topology 以 tile accept／emit sides 與 rotated machine ports 建 edge。
   - renderer 覆蓋 isolated／endpoint／straight／corner／tee／cross、split／merge、source／sink 與 port connectivity。
   - transport 在 grid 上方連到格邊；動畫只依 runtime tick。
   - Belt drag 產生四向連續路線並逐格朝下一格，支援單手勢轉角。

6. **Simple UI and documentation**
   - 刪除常駐設計註解、形容詞副標、重複教學與流程式文案。
   - 保留短 labels、icons、hotkeys、必要 metrics、error 與 destructive confirmation。
   - 詳細玩法集中在 [player-guide.md](player-guide.md)；更新 design、invariants、playtest、structure 與 README。

7. **Integration and repeated audit**
   - focused unit/property tests → typecheck/lint → relevant E2E → full `npm run check`。
   - residue scan：不得留有截短 Research path、terrain 被 fog 完全遮住、Production 需 Pilot、舊 Blueprint／Save schema的 active truth。
   - 重建 Research、Pilot、Production、connected belts 與 compact screenshot baselines。
   - 用 `0.0.0.0:53346 --strictPort` 真人走 Research、直接 Production、Pilot→Build、Blueprint、Save/Load/Rewind。
   - 再做至少一輪邏輯、視覺與文件 audit，修完才 commit + push。

## Completion rule

- 唯一自動標準：當前 commit 的 `npm run check` 全通過。
- 唯一真人標準：依 [playtest.md](playtest.md) 在 53346 完整 smoke，沒有 blocker 或未記錄的 fallback。
- 文件不記錄會迅速過期的 test count；提交訊息與執行回報保存該次實際數字。

## Deliberately deferred

- radial bands、motif weights、terrain density、Research cost/reveal radius、machine speed/cost、difficulty/price、unlock pacing 等主觀平衡。
- 正式內容量、final art/audio polish、帳戶、雲端 Blueprint repository。
- release candidate 前的跨 build save migration。

平衡可以逐步調整；完整 fixed paths、Wall 骨架可讀與其他互動物受霧保護、direct paid Production、optional Pilot、connected topology、Blueprint v3、Save v7 與 strict gate 不能後置。
