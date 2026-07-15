# HexaPharma

> codename，正式名稱待議。

一款把 **Big Pharma 式實體工廠**與 **Potion Craft 式地圖探索**結合的確定性 2D 單人遊戲。操作借鏡 shapez／Factorio 的直接建造語言；UI、素材與美術皆為原創。

## 現行玩法

```text
Research：在大型單層 Atlas 上串接固定、完整、奇形的機器路徑；出藥後才揭露發現
Pilot Plant：免費、無時間的工廠配置沙盒
Production：新局即可直接建造；每次變更付費並承擔持續生產的結果
Market / Technology / Blueprints
```

- F1／F2／F3 分別開啟 Research、Pilot Plant、Production；M／T／B 開啟抽屜。
- Atlas 的牆、深淵、沼澤與成對傳送門即使尚未探索也可見，且會影響路徑預覽；治療區與副作用區仍藏在霧下。
- Research 機器只使用 catalog 定義的完整路徑；不能截短。不同怪異形狀的組合就是探索謎題。
- Production 新局即有空白 24×12 場地，不要求先使用 Pilot。傳送帶 $2、分流／合流 $8、來源 $12、出口 $6、機器是每單位處理成本的 10 倍；拆除不退款。
- Pilot Plant 免費且沒有時間，只是可選的設計空間。完成後可按標示價格建到 Production。
- 傳送帶依真實連線顯示端點、直線、轉角、T 字與十字，拖曳轉彎會逐格設定正確方向。
- Blueprint v3 有 `research-program` 與通用 `factory-layout`；工廠藍圖可免費開到 Pilot，或付費建到 Production，Library 跨存檔保存。
- Save v7 僅保證同 content build 內正確；舊開發版存檔直接拒絕，不做 migration。

詳細操作見 [玩家指南](docs/player-guide.md)，設計與正確性規格見 [docs/design.md](docs/design.md) 與 [docs/invariants.md](docs/invariants.md)。

## Architecture

TypeScript 6｜React 19｜PixiJS 8｜Vite 8｜Vitest／fast-check｜Playwright。

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only drawing
Pure TS sim core  → deterministic path/mapgen/tick/economy/save/replay
```

`src/sim/**` 禁止 Pixi／React／DOM。mapgen 與 sim 不用 `Math.random()` 或 wall-clock；Production 熱迴圈使用固定容量資料結構。solver 只供 tests/tools，絕不進遊戲內自動解。

## 啟動

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 同機器：<http://127.0.0.1:53346/>
- 遠端：`http://<Oracle 公網 IP>:53346/`
- Oracle Cloud 只開放 53346；`--strictPort` 禁止靜默換 port。

真人驗證清單見 [docs/playtest.md](docs/playtest.md)。

## Gate

```bash
npm run check
```

唯一自動驗收閘：`tsc --noEmit && eslint . && vitest run && playwright test`。自動 E2E 使用 throwaway port，不碰真人測試用的 53346。

## 文件

| 文件 | 用途 |
|---|---|
| [docs/design.md](docs/design.md) | canonical 遊戲與技術設計 |
| [docs/player-guide.md](docs/player-guide.md) | 啟動、操作與遊玩流程 |
| [docs/ui-interaction.md](docs/ui-interaction.md) | world-first 互動與視覺契約 |
| [docs/invariants.md](docs/invariants.md) | 正確性不變式 |
| [docs/overview.md](docs/overview.md) | 短版 domain overview |
| [docs/structure.md](docs/structure.md) | 模組與邊界 |
| [docs/plan.md](docs/plan.md), [docs/roadmap.md](docs/roadmap.md) | 現行工作與後續階段 |
| [docs/playtest.md](docs/playtest.md) | 遠端啟動與手動驗收 |
| [docs/development-policy.md](docs/development-policy.md) | 早期存檔政策 |
| [docs/decisions.md](docs/decisions.md) | 關鍵決策 |
| [docs/module-ownership.md](docs/module-ownership.md) | 協作 ownership |

## License

[The Unlicense](LICENSE) — public domain.
