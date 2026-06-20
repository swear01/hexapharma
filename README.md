# HexaPharma

> codename「HexaPharma」為暫定，最終命名待議。

一款融合兩種玩法的 2D 單人本地遊戲：**Big Pharma 的工廠 + Potion Craft 的地圖**。

在程序化隨機生成、迷霧覆蓋的**多張效果地圖**上摸黑探索、用人類創意解出藥方（Potion Craft 的鍊金地圖），再到工廠把藥方鋪成**確定性自動化產線、配平機器吞吐**量產（Big Pharma 的工廠）。美術走平面、極簡、俯視正交（Shapez 風）。

**核心模型**：把 Big Pharma 每種有效成分的 1D 濃度，換成「一張 2D 地圖上的位置」；多張地圖並存、一台機器同時移動所有圖；地圖隨機生成、**種子即身分**。

## 雙重目標

1. 把這款遊戲**真正做出來、出貨**。
2. 用它當 **AI 多 agent 編排**的實驗場——確定性、可 headless 驗證的工程紀律，正好是讓多 agent 平行、低人工介入協作的前提。

## 技術棧

TypeScript（code-as-truth）｜確定性 sim core 與渲染徹底分離｜渲染 PixiJS v8｜UI React｜建置 Vite｜Node LTS 20+。

三層架構，單向資料流：

```
UI（React/DOM）   →  只讀 sim + 發 intent
渲染（PixiJS v8） →  只讀 sim、顯式 loop
Sim Core（純 TS） →  ★ tick-based、固定 seed、完全可 headless 測 ★
```

## 開發狀態

**Phase 0 開工前**——目前 repo 含設計文件與 AI agent 規則，程式碼尚未 scaffold。

路線圖：Phase 0（多圖效果引擎 + 機器變換 + 生成/求解，無畫面）→ Phase 1（最小可見）→ Phase 2（工廠吞吐配平）→ Phase 3（經濟/存讀檔/專利/解鎖新地圖）。

## 文件

| 檔案 | 內容 |
|------|------|
| [docs/design.md](docs/design.md) | 完整設計（canonical 活文件） |
| [docs/overview.md](docs/overview.md) | 摘要與領域詞彙 |
| [docs/structure.md](docs/structure.md) | 目錄結構與模組邊界 |
| [docs/invariants.md](docs/invariants.md) | 不變式總表（自動閘脊椎） |
| [docs/decisions.md](docs/decisions.md) | 技術決策紀錄（D1–D15） |
| [docs/module-ownership.md](docs/module-ownership.md) | 模組擁有權地圖 |
| [docs/notes.md](docs/notes.md) | gotchas 與決策理由 |
| [docs/plan.md](docs/plan.md) ／ [docs/roadmap.md](docs/roadmap.md) | 當前計劃／路線圖 |
| [AGENTS.md](AGENTS.md) | AI agent 硬規則 |

## Gate

宣告完成前的唯一驗收標準（工具鏈於 Phase 0 scaffold）：

```
npm run check   # tsc --noEmit && lint && vitest run && playwright test --headless
```
