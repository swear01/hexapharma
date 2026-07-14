# Plan

## Current milestone — Single-Atlas Research / contract-free factory flow

狀態：**implemented and verified**。這是breaking TDD migration；Route Floor、contract chain、multi-layer UI、Blueprint v1 research layout與Save v5都沒有作為fallback保留。

### TDD implementation order

1. **Freeze target interfaces and red tests** ✅
   - 定義`PathStamp`、ordered `ResearchProgram`、prefix calibration、single-layer terrain/portal與target Game intents。
   - 先寫 pure/property tests：fixed geometry、prefix determinism、invalid calibration rejection、portal discontinuity、fog-safe preview。
   - 刪除或改寫仍要求 Route Floor、linear Research layout、Research contract、swap/layers 的 tests。

2. **Research path + terrain core** ✅
   - fixed irregular PathStamp traversal；core actual preview/execution共用terrain-aware authority，idle ghost將hidden cells中性化，讓known terrain可規劃且unknown terrain不洩漏。
   - wall／abyss／swamp 各自 deterministic semantics；同層 paired directed A→B portal。
   - Active content/palette 禁 swap、Phase Exchange 與 cross-layer state。

3. **Seeded radial + motif constructive mapgen** ✅
   - 由 seed 建 radial progression、motif placement、terrain/portal pairing 與 reference ResearchProgram。
   - property tests 守 same-seed equality、different-seed variety、constructive validity、prefix execution、portal pairing、bounds。
   - solver 保持 tests/tools-only，只量 quality，不成為 production rejection loop。

4. **Single Research Atlas UI** ✅
   - F1 移除 Route Floor/modebar與常駐教學文；保留一張 world-first Atlas。
   - PathStamp palette、held ghost、prefix calibration feedback、commit/undo/erase、program execution/progress/fog。
   - 無 A–D tabs、swap tool、跨層文案；portal jump trail 斷線且 preview 不洩霧。
   - 更新 responsive layout；舊 screenshot 不是 acceptance，最終證據在Step 8重建。

5. **Pilot sandbox / Production consequences** ✅
   - Pilot state 不含 Research contract；從空地建立任意合法 FactoryLayout，zero clock/cost。
   - diagnostics 是資訊，不是 commission gate。no-cure/failure/deadlock 可 commission。
   - Production 未 commission 前 offline；commission exact own/copy Pilot layout。Production inventory/waste/market 只看 actual outputs，不看 contract。
   - integration/property tests 守 Research intent 不改 Pilot、exact copy、no-contract commission 與 live consequences。

6. **Kind-specific Blueprint redesign** ✅
   - ✅ core wire/ruleset v2：`research-program` encode/decode ordered `{typeId,stroke}`；`pilot-plant` encode/decode routing + `{id,typeId,stroke,anchor,footRot}`。
   - ✅ strict version/content/checksum/bounds/kind/calibration/geometry validators；舊 v1 `research-route` 顯式拒絕；Library v2 quota/dedupe/import/export/delete focused tests通過。
   - ✅ UI capture/apply、paste/upload/download已接kind-specific API；cross-save lifecycle由Library tests與browser acceptance覆蓋。

7. **Breaking Save v6** ✅
   - ✅ core full/compact/slots/rewind wire固定v6；保存ResearchProgram/shot、contract-free Pilot/Production、path/stroke layout與cold runtime。
   - ✅ strict field/bounds/raw-work/replay/hash validators；v5顯式拒絕；focused save tests涵蓋forgery、active shot、slots、rewind與runtime。
   - ✅ `checkpointStorage` lineage/recovery與UI tests已接v6；v5錯誤不覆寫raw blob，recovery保持atomic。

8. **Integration and final verification** ✅
   - ✅ Market/Technology reset/解鎖語意已移除layer/swap progress；擴廠有destructive confirmation且不打斷Research。
   - ✅ active-doc residue/link scan、typecheck/lint/unit/property/integration/Playwright完成。
   - ✅ `0.0.0.0:53346 --strictPort` browser smoke覆蓋single Research→independent Pilot→Production consequences。
   - ✅ 多輪UX修正、desktop/mobile visual audit與本build screenshots完成。

### Final verification evidence（2026-07-14）

- 舊Route Floor/contract/multi-layer active authority已從production Game/UI/Blueprint/Save移除；低階`MultiMap`只保留給mapgen/tooling未來研究，production Game強制`nMaps=1`。
- `npm run check`通過：TypeScript、ESLint、37個Vitest files／468 tests、33個Playwright tests。
- `npm run sim -- gen 14`、`npm run balance -- 2`與`npm run build`通過。
- desktop 1440×900、desktop 1280×720、compact 390×844與Pilot/Production screenshots已重建；真人server持續綁`0.0.0.0:53346 --strictPort`。

## Deliberately deferred

- radial bands、motif weights、terrain density、Research cost/reveal radius、machine speed/cost、difficulty/price、unlock pacing 的主觀平衡。
- 帳戶、雲端 Blueprint repository、正式跨版本 migration matrix、正式內容量與 final art/audio polish。

上述平衡項可以後續調；fixed PathStamp、prefix authority、single-layer boundary、Research/Pilot decoupling、no-contract commission、exact copy、kind-specific Blueprint、Save v6 correctness 與 gate 不能後置。
