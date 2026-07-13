# HexaPharma

> codename，正式名稱待議。

一款把 **Big Pharma 的實體工廠**與 **Potion Craft 式大地圖探索**結合的確定性 2D 單人遊戲，使用 shapez/Factorio 類的直接操作語言，但採原創 UI 與美術。

## Current game loop

```text
Research（付費出藥、逐步揭霧）
  → Pilot Plant（無時間、零成本排布驗證）
  → Production（連續 ticks、吞吐、inventory/waste）
  → Market（出售實體藥）
  → Technology（機器／建地／地圖進程）
```

- F1/F2/F3 是三個獨立建築；Market/Technology/Blueprints 是 M/T/B drawers。
- Research Effect Atlas 是 `63×63` 大圖局部視野，A 層從 `(0,0)` 中心開始；每格 minor／每 5 格 major grid，無玩家 XY 十字軸或 auto-follow。
- Research planning 不揭霧；Dispense 一次付 route cost，藥逐 machine 前進，只有完成 step 才沿真實 trail 揭 radius 1。Abort/fail 不退款。
- Research→Pilot→Production 都 transfer exact physical layout + contract，不 auto-pack 或 silent repair。
- Blueprint Library v1 使用 strict JSON、SHA-256 checksum 與 machine-content fingerprint，獨立於 Save，可跨存檔匯入匯出。
- Save v5 保存巢狀三場域；目前是早期開發，不維護跨 build migration。

## Stack / architecture

TypeScript 6｜React 19｜PixiJS 8｜Vite 8｜Vitest/fast-check｜Playwright。

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only drawing
Pure TS sim core  → deterministic tick/mapgen/economy/save/replay
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

完整的 seed-14 fixture、手動三場域循環、Blueprint/Save 驗證見 [docs/playtest.md](docs/playtest.md)。

## Gate

```bash
npm run check
```

唯一驗收閘：`tsc --noEmit && eslint . && vitest run && playwright test`。自動測試使用 throwaway 53347/53348；不碰真人 53346 server。

## Documentation

| File | Purpose |
|---|---|
| [docs/design.md](docs/design.md) | canonical game/technical design |
| [docs/overview.md](docs/overview.md) | short domain overview |
| [docs/ui-interaction.md](docs/ui-interaction.md) | direct-operation and visual contract |
| [docs/invariants.md](docs/invariants.md) | correctness invariants |
| [docs/decisions.md](docs/decisions.md) | D1–D21 decisions |
| [docs/structure.md](docs/structure.md) | modules and boundaries |
| [docs/playtest.md](docs/playtest.md) | remote startup and manual validation |
| [docs/plan.md](docs/plan.md), [docs/roadmap.md](docs/roadmap.md) | current work / future phases |
| [docs/development-policy.md](docs/development-policy.md) | early save compatibility policy |
| [docs/module-ownership.md](docs/module-ownership.md) | collaboration ownership |

## License

[The Unlicense](LICENSE) — public domain.
