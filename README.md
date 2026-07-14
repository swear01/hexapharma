# HexaPharma

> codename，正式名稱待議。

一款把 **Big Pharma 的實體工廠**與 **Potion Craft 式大地圖探索**結合的確定性 2D 單人遊戲，使用 shapez/Factorio 類的直接操作語言，但採原創 UI 與美術。

## Single-Atlas redesign

下列 breaking redesign authority 已實作；最終完成宣告仍以本 commit 的完整 gate 與真人 smoke 為準：

```text
Research：在單一 Atlas 以固定奇形 Machine PathStamp 組 ResearchProgram，執行後探索迷霧
  → Pilot Plant：無時間、無成本的任意合法 FactoryLayout sandbox
  → Commission：不要求 Research contract 或 cure，逐欄位複製 Pilot layout
  → Production：連續 ticks，實際承擔 cure／side effect／failure／waste 與經濟結果
  → Market / Technology
```

- F1/F2/F3 仍是 Research、Pilot Plant、Production；Market/Technology/Blueprints 是 M/T/B drawers。
- Research 只有一個大型 Atlas；不再有 Route Floor、source/belt/sink 研究路線或常駐教學文。
- Research 使用 catalog-defined、固定幾何的奇形 `PathStamp`；每段以 prefix calibration 接到既有 program，不用 Factory footprint 或 auto-routing 猜路。
- Active Research 是單層玩法：wall、abyss、swamp 與同層 A→B portal。跨層互動、A–D layer progression 與 swap/Phase Exchange 暫停。
- mapgen 由 seed 決定 radial progression 與 motifs，並以 constructive ResearchProgram 保證目標可走；production 不接 solver。
- Research 只產生探索知識，不產生 Pilot/Production contract。Pilot 可自行建立任意合法 factory layout；Production 初始 layout 必須是 Pilot commission 的 exact copy。
- Blueprint wire/ruleset 已 breaking freeze 為 **v2**：`research-program` 只保存 ordered `{typeId, stroke}` steps，`pilot-plant` 保存 routing 與 `{id,typeId,stroke,anchor,footRot}` machines。Library 使用獨立 v2 namespace；舊 v1 `research-route` 文件顯式拒絕。
- Save core wire 已 breaking freeze 為 **v6**：full、compact replay authority、slots/rewind都保存ResearchProgram與contract-free Pilot/Production，v5顯式拒絕。Checkpoint UI/lineage與完整gate已完成；正式release candidate前不維護跨build migration。

舊三場域 contract/Route Floor active authority已移除。實作證據與驗證狀態見 [docs/plan.md](docs/plan.md)。

## Stack / architecture

TypeScript 6｜React 19｜PixiJS 8｜Vite 8｜Vitest/fast-check｜Playwright。

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only drawing
Pure TS sim core  → deterministic path/mapgen/tick/economy/save/replay
```

`src/sim/**` 禁止 Pixi/React/DOM。mapgen/sim 不用 `Math.random()` 或 wall-clock；Production 成功熱 tick 使用 fixed-capacity SoA TypedArrays 與預配置 buffers。solver 只供 tests/tools，絕不進遊戲內自動解。

## Run

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 同機器：<http://127.0.0.1:53346/>
- 遠端：`http://<Oracle 公網 IP>:53346/`
- Oracle Cloud 只白名單 53346，禁止靜默換 port。

breaking milestone 的手動驗證清單見 [docs/playtest.md](docs/playtest.md)；每個最終 commit 都要重新執行，不能沿用途中證據。

## Gate

```bash
npm run check
```

唯一驗收閘：`tsc --noEmit && eslint . && vitest run && playwright test`。自動測試使用 throwaway 53347/53348；不碰真人 53346 server。2026-07-14 final run通過：37個Vitest files／468 tests、33個Playwright tests。

## Documentation

| File | Purpose |
|---|---|
| [docs/design.md](docs/design.md) | canonical target game/technical design |
| [docs/overview.md](docs/overview.md) | short domain overview |
| [docs/ui-interaction.md](docs/ui-interaction.md) | direct-operation and visual contract |
| [docs/invariants.md](docs/invariants.md) | target correctness invariants |
| [docs/decisions.md](docs/decisions.md) | architecture and superseded decisions |
| [docs/structure.md](docs/structure.md) | modules, boundaries, migration status |
| [docs/playtest.md](docs/playtest.md) | remote startup and milestone manual validation |
| [docs/plan.md](docs/plan.md), [docs/roadmap.md](docs/roadmap.md) | current breaking work / future phases |
| [docs/development-policy.md](docs/development-policy.md) | early save compatibility policy |
| [docs/module-ownership.md](docs/module-ownership.md) | collaboration ownership |

## License

[The Unlicense](LICENSE) — public domain.
