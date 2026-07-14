# Roadmap

> 原則：先完成可 headless 驗證的 authority，再接薄 render/UI；每階段以 `npm run check` 為唯一自動驗收。舊階段記錄是 implementation history，不凌駕目前 breaking target。

## Historical baseline

### Phase 0 — Drug graph / early mapgen / solver

曾完成 deterministic transform/sweep/evaluate、constructive generation、RNG/hash 與 dev/test solver。其multi-layer/swap與舊terrain API已由single-layer PathStamp core取代。

### Phase 1 — Early Effect Atlas

曾完成 Pixi/React Atlas、opaque fog、camera 與原創資產。Atlas renderer/camera 可重用，但 A–D tabs、route token 與舊 map assumptions 不是新 milestone truth。

### Phase 2 — Factory sim

fixed-capacity SoA runtime、multi-cell machines、belts、splitter/merger、throughput/deadlock、cold snapshot/hash 是保留基礎；contract-dependent product acceptance後由Phase 6改成actual outcome。

### Phase 3 — Economy / Technology / Save v5

Market、Knowledge、patents、intent replay/checkpoint提供遷移基礎；Save v5、layer unlock/reset與contract fields後由v6/single-Atlas authority取代。

### Phase 4 — Direct-operation shell

F1–F3 world shell、drawers、Factory direct manipulation與responsive patterns已重用；Research Route Floor/modebar與舊onboarding已移除，screenshot evidence由Phase 6重建。

### Phase 5 — Old three-facility contract chain（superseded）

曾實作 Research linear FactoryLayout → contract → Pilot validation → Production。這條 authority 已被新設計推翻，不再是完成標準，也不能以舊 gate/audit 證據宣稱新 milestone 完成。

## Phase 6 — Single-Atlas PathStamp redesign ✅

- fixed irregular Machine PathStamp + prefix calibration + ResearchProgram。
- wall／abyss／swamp／same-layer A→B portal；暫停 cross-layer/swap。
- seeded radial + motif constructive mapgen。
- Research 只探索；Pilot 是 independent zero-time/cost FactoryLayout sandbox。
- no-contract/no-cure commission；Production exact copy Pilot並承擔 actual outcomes。
- Blueprint wire/ruleset v2已完成：`research-program`/`pilot-plant` strict codec、Library UI與cross-save lifecycle。
- Save v6 full/compact/slots/rewind、new intents/hash/replay與checkpoint UI/lineage已完成；E2E隨gate驗證。
- single Atlas UI、new screenshots、updated playtest、full gate + remote browser smoke已完成。

狀態與TDD證據見[plan.md](plan.md)。2026-07-14 `npm run check`通過：37個Vitest files／468 tests、33個Playwright tests。

## Later

- 依真人資料調 radial/motif density、terrain rules、Research cost、machine throughput、difficulty/price 與 unlock pacing。
- 增加 motifs、PathStamps、factory machines、疾病、市場與正式美術/聲音。
- Blueprint v2與Save v6 core wire都已先breaking freeze；之後若改wire必須升版而非reinterpret。Release candidate再建立正式migration/deprecation matrix。
- 雲端 Blueprint 分享、帳戶與社群 repository 屬 post-MVP。
