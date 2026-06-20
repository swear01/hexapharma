# Plan

## In Progress

- **Repo 初始化**（本次）：agents_rule base block + docs/ + 推上公開 GitHub repo。✅

## Next Up

**Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）** — 全案最關鍵、最 novel、工程重量所在。

1. 先補 **`phase0_interfaces.ts`** 契約檔（型別、函式簽名、15 條不變式、測試清單）進 repo。
2. **建議的第一個 agent 任務**：`drug-graph` 的 `orient`（朝向/flip 變換）+ `applyStep` 的掃動解析（牆停、危險即死）。最核心、最適合先用 property test 釘死，是 mapgen/solver 的地基。
3. scaffold 工具鏈：`package.json` + `npm run check`（`tsc --noEmit && lint && vitest run && playwright test --headless`）、vitest、fast-check、tsconfig。
4. 交付 `drug-graph`、`solver`（多圖搜尋）、`mapgen`（建構式 + 難度評分 + 基礎藥價）+ 完整 property test + CLI harness + replay。

**Phase 0 完成定義**：CLI 給種子 → 生出 2 圖、可解、難度達標、附基礎藥價；給「機器+朝向」→ 印各圖最終位置/療效/副作用/是否失敗；求解器對任意種子找得到解；property 全綠；replay 可重現。

完整路線圖見 [roadmap.md](roadmap.md)。
