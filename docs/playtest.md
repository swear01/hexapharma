# 真人試玩與手動驗證

> 這是現行single-Atlas build的真人驗證清單。每個commit仍須實際執行，不能用先前screenshots或focused tests代替；舊seed-14 Research route fixture已刪除且不適用。

## 1. 安裝與啟動

```bash
cd /home/ubuntu/hexapharma
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 同機器：<http://127.0.0.1:53346/>
- 遠端：`http://<Oracle 公網 IP>:53346/`
- `53346` 是 Oracle Cloud 唯一白名單 port；`--strictPort` 必須保留。若被占用先解決衝突，不可讓 Vite換 port。
- production build：先停 dev，再執行 `npm run build && npm run preview -- --host 0.0.0.0 --port 53346 --strictPort`。
- 這是 breaking build；依早期政策可先清除此 origin 的舊 v5 localStorage。不要把舊 save／舊 `research-route` Blueprint讀取失敗回報成 migration bug。

## 2. Single Research Atlas

1. 按 F1。畫面只能有一張 Research Atlas；不得有 Route Floor toggle、Factory canvas、source/belt/sink palette、Recipe timeline或常駐大段教學文。
2. 不得有 A–D layer tabs、swap／Phase Exchange或任何跨層 endpoint。Technology也不能把它們當 active unlock。
3. Atlas 應大於 viewport，start位於generator中心區。drag pan、wheel zoom、Focus/F只在按下時置中；後續 program execution不搶鏡頭。
4. fog 必須遮住 wall、abyss、swamp、portal與motif；grid/scale cue不能洩漏未知內容。

## 3. PathStamp / prefix calibration

1. 從 Research palette 選至少三個 Machine PathStamp。每個都應有固定、不規則 silhouette及清楚entry/exit；切換 Factory rotate/flip心智模型不能改它的authority geometry。
2. 放第一 stamp，確認完整nominal path ghost與program prefix可見。commit後program authority只增加一次，Backspace／RMB移除最後一段。
3. 放第二 stamp，確認prefix calibration只接到目前endpoint；縮短／加長prefix後ghost立即從nominal endpoint重建，不silent shift或repair。
4. 把candidate移入fog：preview不得顯示未知 terrain、portal B或真實 outcome。
5. 用`[`／`]`與兩個calibration按鈕走到1與path.length邊界；控制必須clamp／disable，不能寫入非法stroke，program/fog不變。
6. 揭露Wall／Swamp／Abyss或一對Portal後再次preview；known terrain必須改變ghost，只有單端已知的Portal仍不得洩漏另一端。committed prefix用solid trail，held candidate用不同的dashed trail/token；Enter執行Dispense而不是新增stamp。

## 4. Terrain / portal / execution

1. 使用固定 seed 的新 mapgen fixture，確認 radial progression與motifs可讀且同 seed重開逐欄位相同。
2. 執行 ResearchProgram。只允許已完成segment更新trail/fog；future suffix不先揭露。
3. 分別走到wall、abyss、swamp：Wall/OOB取消該delta並繼續；Abyss sticky fail並停止；Swamp消耗2 energy。renderer不能自行猜另一套結果。
4. 走入同層portal A，確認只到配對B、剩餘path從B繼續，trail在jump斷線且A/B中間未知格不被揭露；B不是反向入口。
5. execution完成或失敗後，不得出現Research contract、Send to Pilot或自動改Pilot layout。Research只保留program/progress/fog/探索結果。

## 5. Pilot Plant sandbox

1. 直接按 F2；不做任何Research也能從空地建立合法FactoryLayout。
2. 顯示No clock/no cost；沒有Production Play/Pause/Step、inventory或waste authority。編輯不得改Cash或Production tick。
3. 使用source/belt/machines/splitter/merger/sink做一條合法layout；驗LMB/RMB、pan/zoom、rotate、pipette、copy/cut/paste、undo/redo。
4. inspector即時顯示actual cures/side effects/final endpoints、throughput、bottleneck與deadlock/analysis error；不得有Research contract或matches/differs。
5. 分別準備no-cure、failure或deadlock但geometry合法的layout。Commission仍應可執行；diagnostic是警告，不是gate。
6. collision、越界、locked content或無法建立Production authority的layout才應原子拒絕，不能silent repair。

## 6. Production consequences

1. 新局未commission前按F3，應看到offline/Go to Pilot，不能從空白Production editor繞過Pilot。
2. 從Pilot commission後，逐欄位比較dimensions、tiles、machine IDs/types、paths/strokes、anchors、footRot、ports/routing；Production必須exact copy。
3. no-cure/failure/deadlock layout不得在copy時被auto-pack、rotate、repair或換成安全preset。
4. 只有Production有Step/Play/Reset與連續tick。有效cure進inventory；failed/no-cure成waste；side effects保留在實體產品與市場計價。
5. 修改Production routing後，結果由live layout承擔；不得出現contract mismatch gate。
6. Market每顆實體產品只能賣一次；Cash/Knowledge與side-effect penalty使用實際product資料。
7. 有commissioned Production時解鎖擴廠專利，必須先確認runtime/waste reset；Cancel保持全部authority，確認後也不得中止active Research shot。

## 7. Blueprint kinds / cross-save

1. 在Research保存Blueprint，下載JSON。root version/ruleset應為v2，kind是`research-program`，payload恰為ordered `{typeId,stroke}` steps；不得含path/placement、Factory tiles/machines、fog、seed、terrain discovery或outcome。
2. 在Pilot保存Blueprint。kind是`pilot-plant`，payload為dimensions、sparse routing與machines `{id,typeId,stroke,anchor,footRot}`；不得含chemical orientation/path、ResearchProgram、diagnostic result、Production runtime或economy。
3. 對兩種kind做download→import→apply；只能套到相同domain。wrong kind、unknown fields、bad version/fingerprint/checksum、invalid calibration/collision/bounds都明示拒絕且Library原子不變。
4. 匯入舊layout-based `research-route` v1，必須顯示unsupported；不能猜成ResearchProgram。
5. Save/Load/Rewind/換slot後Library內容不變；相同canonicalchecksum去重；oversize檔在讀全文前拒絕。

## 8. Save v6 / recovery

v6 checkpoint UI/lineage/recovery已整合；core codec focused tests通過仍不等於這份真人流程已通過：

1. Save後做一個ResearchProgram edit、一個Pilot edit與Production tick，再Save建立同origin history。
2. Load恢復single Atlas/fog/program/progress、Pilot layout、Production layout/runtime/products、economy/Technology；不存在Route Floor或contract欄位。
3. Rewind回前snapshot，reload後history仍在；Blueprint Library不受影響。
4. v5/unknown schema顯式拒絕，不silent migrate或部分載入。
5. corrupt/partial/disagreeing blob顯示錯誤；Recover前不得自動刪除或覆寫。

## 9. Gate、residue與回報

```bash
npm run check
```

每個行為變更仍要重新執行：

- active docs/source/tests residue scan不得把Route Floor、Research contract、multi-layer/swap、Blueprint v1 research layout當active truth；
- 重建single Atlas、PathStamp/terrain/portal、Pilot sandbox、Production與compact screenshot baselines；
- 以`0.0.0.0:53346 --strictPort`真人走完整流程並至少做一輪UX修正。

2026-07-14本milestone證據：`npm run check`通過（37個Vitest files／468 tests、33個Playwright tests），desktop/mobile與Pilot/Production screenshots已重建，53346 browser smoke完成。

Bug回報附：URL/seed/generation options、tick或path segment區間、完整input trace/ResearchProgram、預期/實際、第一個違反的不變式、UI截圖與console error。
