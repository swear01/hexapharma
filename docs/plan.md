# Plan

## Current milestone — 三場域重構

以 TDD 把舊 Lab/Pilot Bench/Factory 與 Recipe-list authority 改為 Research/Pilot Plant/Production 三個獨立建築。

### Implemented

1. **Research authority** ✅
   - `ResearchFacilityState`、`ResearchShot`、strict linear route descriptor。
   - planning 不揭霧；一次付費；逐 machine advance；每步真實 trail radius-1 reveal；abort/fail 不退款。
2. **Pilot/Production separation** ✅
   - Pilot 無 clock/cost/inventory/waste；Production 唯一有 runtime/ticks。
   - Research→Pilot 與 Pilot→Production exact layout transfer；contract mismatch 顯式拒絕。
3. **Save/replay/checkpoint v5** ✅
   - 巢狀三場域 schema/intents/hash/replay-work；舊 v4 顯式拒絕。
4. **三頁 world-first UI** ✅
   - F1 Research、F2 Pilot、F3 Production；共用直接操作 facility editor。
   - Atlas 開局 `(0,0)` 置中、origin-aligned 5×5 major grid、移除玩家 XY 軸與 auto-follow。
   - Market/Technology/Blueprints 改為 M/T/B drawers。
5. **Blueprint Library v1** ✅
   - strict portable format、SHA-256 checksum、獨立 localStorage、跨 save、匯入/匯出/套用/刪除。
6. **舊 authority 移除** ✅
   - 刪除 PilotBench、recipeEditor、recipePreview 與 editable Recipe timeline production path。
7. **自動測試遷移** ✅
   - sim/save/checkpoint/integration/component/Playwright 全部改為三場域語意；新增 progressive Research、Blueprint、compact UI 與 machine-family visual tests。
8. **直接可讀的原創工廠視覺** ✅
   - machine-family palette、連續 footprint chassis、flow spine、semantic faceplate、ports 與連續 belt rails。
   - 390px Research status／Pilot command 不再被 navigation 遮擋或壓成多行。

### Verification completed

- [x] 完成 active docs/README 全樹殘留掃描。
- [x] 完成六輪只讀規格／UI／文件稽核，修正所有發現的非平衡缺漏。
- [x] 通過唯一 gate `npm run check`。
- [x] 檢查並更新 current Production、Research Atlas、machine-family 截圖。
- [x] 以 `0.0.0.0:53346 --strictPort` 啟動真人試玩伺服器，確認 listener、HTML 與三場域 title。
- [x] 完成提交前機械檢查、邏輯 diff review 與文件生命週期檢查。

## Deliberately deferred

- 主觀的 machine cost/speed、difficulty/price、cure region 與進程平衡。
- 跨 build save migration、帳戶、雲端 Blueprint repository。

上述項目可以後續慢慢調；authority、互動可讀性、資料安全與 gate 不是平衡問題，不能後置。
