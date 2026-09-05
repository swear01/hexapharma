# HexaPharma

> codename，正式名稱待議。

一款把 **Big Pharma 式實體工廠**與 **Potion Craft 式地圖探索**結合的確定性 2D 單人遊戲。操作借鏡 shapez／Factorio 的直接建造語言；UI、素材與美術皆為原創。

## 現行玩法

```text
Research：開始 assay，逐次選擇完整奇形機器；每步立即付費、執行、揭露，再決定下一步
Production Plan：免費、無時間的工廠配置沙盒；確認後 Commission 到正式產線
Production：新局即可直接建造；每次變更付費並承擔持續生產的結果
Market / Technology / Blueprints
```

- F1／F2／F3 分別開啟 Research、Production Plan、Production；M／T／B 開啟抽屜。
- 新局在 Atlas 中心揭露 hex distance radius 2 的 19-cell disk；只有牆可穿霧看見。深淵、沼澤、成對傳送門、治療區與副作用區都要實際出藥揭露。
- 預設同一張 Atlas 有 4 種獨立疾病。assay 只透露目標的寬廣方位區段，不公開座標或距離。
- Research 機器只使用 catalog 定義的完整路徑，不能截短。每次選定一台機器，就原子扣除該 stamp 費用、依權威地圖走完整路徑、揭露實際 trail 並立即顯示 outcome；玩家再根據新資訊決定下一台。沒有預先提交整批 route。
- Failure 或 Cure 結束本次 session；Abort 不退款且不回滾先前揭霧。成功 Cure 會自動保存該疾病最新的 `DiscoveredFormula`，並在畫面顯示已執行步驟、累積 assay 成本與副作用。
- Production 新局即有空白 24×12 場地，不要求先使用 Production Plan。傳送帶 $2、分流／合流 $8、來源 $12、出口 $6、機器是每單位處理成本的 10 倍；拆除不退款。
- Production Plan 免費且沒有時間，只是可選的設計空間。完成後可按 `Commission $N` 建到 Production；內部 state／intent 名稱暫仍使用 `pilot`。
- 傳送帶依六邊的真實連線顯示端點、對向直線、60°／120°轉折與多向 junction，拖曳轉彎會逐格設定正確方向。
- Blueprint v4 codec 能驗證、匯入、下載或刪除 `research-program` 文件，但目前 UI 不建立或套用 Research Blueprint，避免繞過逐步付費、揭霧與 outcome。可建立／套用的通用 `factory-layout` 能免費開到 Production Plan，或付費 Commission 到 Production；Library 使用 `hexapharma.blueprint-library.v4` 跨存檔保存。
- 每種疾病都有出貨合約，quota 固定為 3；依序完成 Disease 1／2／3 的合約，才可分別取得 Skew／Dilute／Settle 的 machine patent。
- Save v10 僅保證同 content build 內正確；舊開發版存檔直接拒絕，不做 migration。
- 正常新局有 $1000，必須能從人工 Research 經付費建廠走到第一次出售。每種疾病的需求獨立並逐次按 `floor(19/20)` 衰減至 0；Market 優先出售乾淨、低成本且仍有利潤的實體產品。
- Atlas 與 Factory 都是 pointy-top axial true hex：離散 cell 使用 `{q,r}`，六方向依序為 E／SE／SW／W／NW／NE，Factory footprint／ports 有六個 60° rotations。兩個場域仍保有獨立 payload 與 validator；dense arrays 一律以 `r * width + q` 索引。本版視覺為極簡、偏 pixel 的俯視 2D：中性炭灰／冷灰底、近白文字與機身；青藍僅標流動、白／淡藍標選取與 candidate、綠標 cure、紫紅標副作用、紅標失敗。平塗硬邊，無黃光、青色 halo、裝飾圈環或全表面亮邊。世界由 Pixi vector runtime 繪製，無 bitmap／manifest contract。

詳細操作見 [玩家指南](docs/player-guide.md)，設計與正確性規格見 [docs/design.md](docs/design.md) 與 [docs/invariants.md](docs/invariants.md)。

## Architecture

TypeScript 6｜React 19｜PixiJS 8｜Vite 8｜Vitest／fast-check｜Playwright。

```text
React UI          → read GameState + dispatch GameIntent
Pixi renderer     → read-only drawing
Pure TS sim core  → deterministic path/mapgen/tick/economy/save/replay
```

`src/sim/**` 禁止 Pixi／React／DOM。mapgen 先由 seed 建地形，再在地形上 constructive 地建立彼此不同的疾病與解；不保留跨 seed 通用的安全走廊。mapgen 與 sim 不用 `Math.random()` 或 wall-clock；Production 熱迴圈使用固定容量資料結構。solver 只供 tests/tools 的 minimum-solution／平衡檢查，絕不進遊戲內自動解。

## 啟動

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 53346 --strictPort
```

- 同機器：<http://127.0.0.1:53346/>
- 遠端：<http://138.2.52.9:53346/>
- Oracle Cloud 只開放 53346；`--strictPort` 禁止靜默換 port。

真人驗證清單見 [docs/playtest.md](docs/playtest.md)。

## Gate

```bash
npm run check
```

唯一自動驗收閘：`tsc --noEmit && eslint . && vitest run && playwright test`。自動 E2E 使用 throwaway port，不碰真人測試用的 53346。`main` 的 push/PR 由 GitHub Actions（`.github/workflows/check.yml`）執行同一 gate。

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
