# Roadmap

> 原則：**先做 sim 模組（headless、過閘），再加薄薄一層 render/UI**；不讓 agent 一次做整款。

## Backlog

### Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解（無畫面）
- `drug-graph`（正方格四特徵、機器=transform union、逐格掃動、2 圖且介面支援 N、最終位置判定、迷霧）
- `solver`（多圖搜尋）、`mapgen`（建構式 + 難度評分 + 基礎藥價）
- 完整 property test + 不變式 + CLI harness + replay；同時驗證方法論（worktree、契約、`npm run check`、replay）
- **完成定義**：CLI 給種子 → 2 圖可解、難度達標、附藥價；給機器+朝向 → 印各圖結果；求解器任意種子找得到解；property 全綠；replay 可重現

### Phase 1 — 最小可見（看得到謎題）
- PixiJS 平面並列畫 2 張正方格地圖（四特徵 + 迷霧）+ 機器擺放（旋轉/flip）+ 藥物雙圖同步掃動；React 研究室 UI；接 Playwright 截圖快照
- **驗證重點**：跨圖拉扯 + translate/scale/swap 三變換 + 牆當停點/危險即死的手感（全案最不確定，最該早點玩到）
- **完成定義**：能在瀏覽器手動揭霧、解一條需平衡兩圖的最簡藥方

### Phase 2 — 工廠吞吐配平
- `factory-sim`（tick 推進、processing cost/速度、belt 吞吐、瓶頸偵測）+ 質量守恆/無死鎖/吞吐一致不變式 + 渲染層；`recipe` 模板→產線 + 重排驗證
- **完成定義**：Phase 1 藥方鋪成產線 headless 穩定產出；放慢機器可見瓶頸；並聯/重排提升吞吐且效果不變；守恆恆成立

### Phase 3 — 經濟 / 存讀檔 / 專利 / 解鎖新地圖
- `economy`（訂單/庫存/難度分→藥價/結算 + 反退化）、`save`（多存檔 + 回溯）、`patent`（解機器/變換/擴廠/揭霧/解鎖新成分地圖）
- **完成定義**：可循環 vertical slice（探索→研發→量產配平→賣→投專利/解新地圖→更深）；多存檔回溯正常；驗證「狂產單一藥物 ≠ 簡單最佳解」

### Phase 3 之後
內容量產（更多疾病/原料/機器變換 = 純資料工作）、平衡（求解器掃配方/吞吐空間）、擴到 3–4 圖、美術打磨、上架。

## Recently Done

- **Phase 3 — 經濟/存讀檔/專利 + 完整循環** ✅：economy（遞減定價+反退化+帳務守恆）、save（round-trip+多存檔/回溯）、patent（天賦樹+解鎖新地圖）、循環 UI（Lab→Factory→Shop→Patents）。headless 整合測試跑通整條循環。
- **Phase 2 — 工廠吞吐配平** ✅：factory-sim（tick/throughput/bottleneck/deadlock）、state.ts（replay INV-15）、recipe（模板→產線+重排不變 INV-7）、Factory 視覺。
- **核心修正** ✅：補回 offset（第四種關係）+ supercover 對角掃動；求解器複合難度；**mapgen 跨圖張力**（最佳解須解耦）；Lab 玩生成關卡。
- **Phase 1 — 最小可見（:53346）** ✅：PixiJS v8 並列畫 2 圖（四特徵 + 迷霧 + 藥物 token）、React 研究室 UI（機器 palette + 旋轉/flip + template 編輯 + Run 動畫 + 結果橫幅）、雙圖同步掃動、Playwright headless smoke + 截圖。手動可解一條雙圖藥方達 WIN。
- **Phase 0 — 多圖效果引擎 + 機器變換 + 生成/求解** ✅：drug-graph / solver / mapgen / rng / hash + 凍結契約 + CLI；INV-1..14 全綠（76 sim tests）；CLI gen/run 驗證可解+難度+定價+逐位元確定性。
- 工具鏈：TS6 / Vite8 / React19 / PixiJS8 / vitest4(+fast-check) / Playwright；`npm run check` = tsc + lint(+sim 確定性 guard) + vitest + e2e。
- Repo 初始化：agents_rule base block + CLAUDE.md symlink + docs/ 活文件 + 推上公開 GitHub repo。
