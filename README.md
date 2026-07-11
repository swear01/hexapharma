# HexaPharma

> codename「HexaPharma」為暫定，最終命名待議。

一款融合兩種玩法的 2D 單人本地遊戲：**Big Pharma 的工廠 + Potion Craft 的地圖**。

在程序化隨機生成、迷霧覆蓋的**多張效果地圖**上摸黑探索、用人類創意解出藥方（Potion Craft 的鍊金地圖），再到工廠把藥方鋪成**確定性自動化產線、配平機器吞吐**量產（Big Pharma 的工廠）。美術走平面、極簡、俯視正交（Shapez 風）。

**核心模型**：把 Big Pharma 每種有效成分的 1D 濃度，換成「一張 2D 地圖上的位置」；多張地圖並存、一台機器同時移動所有圖；地圖隨機生成、**seed + 生成設定即關卡身分**。

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

**Phase 3 vertical slice 已接通，目前仍是早期 pre-release 開發，正在做真人試玩、平衡與出貨品質補強。** 現有程式包含純 TS sim、Pixi/React UI、Lab→Factory→Shop→Patents 完整循環、1→2→3→4 張圖進程，以及 Save v3 多槽存檔/回溯。新局先在單一 `63×63` 的 Layer A 正中央開始；後續 layer 仍維持 `63×63`，但使用靠近中心、由圖層決定的 phase offset。存讀檔只要求目前 build 內正確，**不承諾跨 build 延續**；更新後可直接清除舊開發存檔。

2026-07 的互動重做已把原本的網站式頁籤／表格／按鈕流程換成全螢幕工廠遊戲 shell：固定資源 HUD、F1–F4 模式 rail、世界畫布、底部 hotbar 與右側 inspector。Factory 支援 LMB 拖建、RMB 拖拆、觸控點放／拖移鏡頭、Shift／MMB 平移、wheel 游標錨定縮放、`R/H/V/Q`、`Ctrl+C/X/V`、50 步 undo/redo；Lab 使用固定 `704×512` 的局部 atlas viewport（100% 約看 `11×8` 格），支援拖曳平移、wheel 游標錨定縮放、`F`／Focus 跟隨藥物，以及 A–D active-layer tabs，不再把全圖或多圖縮小並排。Market／Patents 改為卡片與研究 lattice，不再以 HTML data table 當主要介面。完整契約與 Before／After 視覺比較見 [docs/ui-interaction.md](docs/ui-interaction.md)。

2026-07 的 TDD 對齊修正已把整局狀態收進 `GameState` + canonical intent trace/replay、讓 sink 交付實際物理藥品與成本、接通副作用扣分/R&D/專利、把 mapgen 改為 production 不依賴 solver 的建構式生成，並將固定 Playwright 視覺 baseline 納入本輪工作成果與 e2e 閘。工廠使用固定容量 SoA `FactoryRuntime`：成功熱 tick 原地更新預配置 TypedArray/product-event buffer，splitter 的 per-tile round-robin cursor 也是 runtime 與 cold snapshot 的權威狀態；runtime 另綁定建立它的 `MultiMap` identity，whole-game reducer 每個 `factoryTicks` intent 則以 snapshot→restore 做冷的 ownership clone。遊戲內地圖限制為每邊 64、每圖 4,096 格，工廠限制為每邊 256、總計 4,096 格；這是 Game/UI 的 renderer-safe authority，並未縮小 public mapgen/factory-sim 各 65,536 格的 headless API 上限。同步 Factory diagnostics 另有 100,000,000 analysis-work cap：在 init/tick 前用 `(area + machines + sources)² × observationTicks` fail-fast，避免合法大 layout 在 React `useMemo` 鎖住 UI；拒絕會沿既有 analysis alert 顯示。

Save v3 的完整 serializer 會在 materialized wire ≤5,000,000 characters 時 round-trip `GameState`，超限則顯式拒絕；合法的 24,500-item authority state 仍可能讓 full wire 超限，localStorage 因此使用 compact authority。完整/compact reader 都從 materialized raw 的 origin + intents 重算 work，再做任何 state replay；Game authority 與 single head 都限100,000 ticks、4,096 entries、100,000,000 work。共用 rewind aggregate常數為12,000 ticks、8,192 entries、100,000,000 work；compact另限20 snapshots/1,250,000 chars。`deserializeSlots`在任何`parseGameState`前驗整段aggregate，`serializeSlots`也套同界；legacy storage先驗history，必要時才head-alone，不能再用5,000,000-character full wire繞過compact budget。timeline必須同origin並允許ticks/sale/`setFactory` normalization；跨run Save明示取代舊timeline。正常100,000-tick reference約31,000,000 work，24,500-inventory流程更低，故100,000,000 cap保留正常進程。Lab 使用固定 viewport 與可見範圍 culling，production preview 直接覆蓋最大 `64×64` authority；目前尚未宣告人工平衡完成。

## 文件

| 檔案 | 內容 |
|------|------|
| [docs/design.md](docs/design.md) | 完整設計（canonical 活文件） |
| [docs/overview.md](docs/overview.md) | 摘要與領域詞彙 |
| [docs/structure.md](docs/structure.md) | 目錄結構與模組邊界 |
| [docs/invariants.md](docs/invariants.md) | 不變式總表（自動閘脊椎） |
| [docs/decisions.md](docs/decisions.md) | 技術決策紀錄（D1–D18） |
| [docs/development-policy.md](docs/development-policy.md) | 早期開發、跨 build 存檔與相容性政策 |
| [docs/module-ownership.md](docs/module-ownership.md) | 模組擁有權地圖 |
| [docs/notes.md](docs/notes.md) | gotchas 與決策理由 |
| [docs/playtest.md](docs/playtest.md) | 啟動方式與真人完整循環驗證清單 |
| [docs/plan.md](docs/plan.md) ／ [docs/roadmap.md](docs/roadmap.md) | 當前計劃／路線圖 |
| [AGENTS.md](AGENTS.md) | AI agent 硬規則 |

## Gate

宣告完成前的唯一驗收標準：

```
npm run check   # tsc --noEmit && lint && vitest run && playwright test
```

Playwright 預設 headless，不另加 headless CLI flag。一般 Chromium e2e 使用 throwaway dev server `:53347`；同一次 `playwright test` 的 production-preview project 會先 build、在 `127.0.0.1:53348` 啟 preview，切過四個 tab 驗 dynamic chunks 與零 page/runtime error。這兩個自動測試 port 都不是下方真人試玩 port。

## 真人測試

需要真人測試 / demo 時，dev／preview server 一律開在 **`0.0.0.0:53346`**（`--host 0.0.0.0 --port 53346 --strictPort`）。Oracle Cloud 上只對這個 port 開了白名單，換 port 從外部連不上。

```bash
cd /home/ubuntu/hexapharma
npm ci  # 第一次執行或 lockfile 改變時
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

同機器開 <http://127.0.0.1:53346/>；外部則開 `http://<Oracle 公網 IP>:53346/`。完整的 seed 14 五分鐘循環、1→2→3→4 layers、Save/Load/Rewind 與回報格式見 [docs/playtest.md](docs/playtest.md)。

## License

[The Unlicense](LICENSE) — 釋出至公有領域（public domain），最大開放、無任何條件。
