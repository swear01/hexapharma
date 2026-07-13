# Roadmap

> 原則：先完成可 headless 驗證的 sim authority，再接薄 render/UI；每階段以 `npm run check` 為唯一自動驗收。

## Phase 0 — Drug graph / mapgen / solver ✅

- 確定性多圖 transform、sweep、evaluate、fog。
- Constructive mapgen、difficulty/price、dev/test-only solver、RNG/hash/replay。

## Phase 1 — Effect Atlas ✅

- Pixi/React 可見研究地圖、opaque fog、active layers、局部 camera、原創 atlas assets。
- `63×63` 中心開局、1→2→3→4 layer progression。

## Phase 2 — Factory sim ✅

- Multi-cell machines、belts、splitter/merger、processing、throughput/deadlock。
- fixed SoA zero-allocation hot tick、cold snapshot/hash/replay、geometry identity。

## Phase 3 — Economy / Technology / Save ✅

- 實體產品、Market、Knowledge、patent tree/deeper reset。
- GameState intent replay、Save/Checkpoint budgets、multi-slot rewind/recovery。

## Phase 4 — Direct-operation game shell ✅

- viewport shell、HUD、hotbar/inspector、Factory direct manipulation、responsive/playwright coverage。
- world-first 原創視覺，管理功能使用 cards/drawers 而非把世界做成 web form。

## Phase 5 — Three facilities / Blueprint v1 ✅

- Research：實體 route、付費 progressive shot、完成步驟才揭霧。
- Pilot Plant：零時間/零成本的 layout prototype。
- Production：唯一 continuous tick authority。
- exact Research→Pilot→Production transfer；移除舊 Pilot Bench/Recipe-list authority。
- F1–F3 三頁、M/T/B drawers；origin-centered 5×5 grid、無 XY 軸/auto-follow。
- cross-save strict Blueprint Library v1；Save v5。
- 驗收證據：active docs 已同步、完整 gate 通過、六輪 audit 無 blocker/major、`:53346` 真人 smoke 通過。

## Next — Playtesting and balance

- 以真人資料調 machine distance/shape/speed/cost、最短解、吞吐、difficulty→price 與 unlock pacing。
- 補 onboarding、更多疾病/transform/美術與聲音、可觀測性與正式內容。
- 正式 release candidate 才 freeze save format 並設計 migration policy。
- 雲端 Blueprint 分享、帳戶與社群 repository 屬 post-MVP；本地標準化匯入匯出已先成立。
