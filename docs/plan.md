# Plan

## Current milestone — v2 rules, map and interface (decided 2026-10-21)

使用者已逐項確認；每一步一個 PR，各自跑完整 gate。sim 權威規則改動依早期存檔政策直接換 Save 版本，不做 migration。示範地圖與窄段驗證在 `tools/map-prototype/`。

### 1. sim 規則
- **Research＝開圖**：玩家先規劃整條路線，預估只用已知地圖，霧當平地。按 `Run · $N` 才付一次費，從起點跑完整試驗，實際結果可能因霧下牆、沼澤、黑格而偏離；只揭露實際走過的路徑。Research 不產生配方，取代舊的「每步立即付費 reveal–decide」與 Research 產生 `DiscoveredFormula`。
- **朝向**：藥帶朝向（六方向之一）。每台機器的路徑相對目前朝向旋轉，執行後依該機器固定轉向角改變朝向。不提供便宜的純轉向機器；Production 產品同樣隨機器順序改變朝向。
- **沼澤半格**：沼澤內每步走半格，sim 以兩倍整數座標表示；離開沼澤的那一步，往移動方向對齊到最近的完整格。停在沼澤半格時，算作最後進入的那一格。
- **黑格**：合成失敗。Production 中該單位成為廢品，Research 試跑失敗。
- **二級療效格（★）**：命中的產品售價較高；後期合約可指定 ★。
- Save 版本跳號；Blueprint 的 `research-program` 視需要調整或移除。

### 2. 地圖生成器重寫
- 六角形地圖，邊界一圈薄山。依 seed 決定骨架：內區平地、厚 2–3 格的環形山（只留彎曲隘口）、外區湖泊與深淵、環形山盆地（各一條 S 形入口）。
- **隘口**：以帶雜訊成本的最短路徑，經過一個側向轉折點挖出；兩端 2–3 格寬，中段為長的 1 格窄道。
- **細節**：用梯度雜訊（fBm／ridged／domain warp）做起伏，只用整數雜湊加多項式，保證確定性。
- **清理**：封閉口袋填成山；全圖連通。
- **藥效**：好到的區 3–5 格，全一級；難到的盆地 9–12 格，含 2–3 格 ★。離所有特徵都太遠的空白區要補 3–5 格藥效。
- **黑格**：放在 ★ 周圍、窄段出口側面，加上平地上的偷坑單格與約 5 格長的黑帶。放置時必須保持連通。
- **驗證**：每條窄段用 BFS 機器序列確認可通過；保留確定性、seed 多樣性與 balance 測試。

### 3. 等高線
- 霧中可見，是刻意提供的提示：畫「離平地高差的壓縮絕對值」加上低幅誘餌起伏，單一墨色。
- 山與水都只是一圈線，玩家只知道那裡有東西，不知道是什麼。
- 壓縮強度與誘餌強度為生成參數。
- 更新 invariants：霧下可見的資訊只有這組等高線（Wall 也不填色；Wall 規則仍留在 planning map），不是地表內容。

§2–§3 與 ★／黑格已在 Step 2（`feat/v2-mapgen`）實作；規格未明處的選擇見 [decisions.md](decisions.md) D33–D34。

### 4. 平衡
- 機器路徑形狀先維持 demo；轉向角由 dev-only 平衡掃描決定。示範暫定：Hook pump +60°、Wave reactor 0、Return coil 180°、Elbow press −60°。
- 驗收：每台機器都要在一定比例的最佳解中出現，沒有固定的最佳組合。
- solver 照舊不進遊戲。

### 5. Research UI
- 路線規劃：點機器接到末端；點最後一個控制點，或 Backspace／Ctrl+Z 回退；可清除路線。
- `Run · $N`：預估總價與現金並排顯示。
- 結果：實際路線為實線，預估留淡虛線，偏離原因標在地圖上。
- 控制只有 Center、清除、Undo、Run；拿掉 revealed 計數與 Cure sites。
- hotbar 圖示依目前朝向旋轉；羅盤顯示朝向與目標方位。

### 6. Plan／Production
- Plan 維持免費工廠草稿，產線的藥效路徑疊在同一張已知地圖上預估。
- 起步工具只有 Source、Belt、Sink 與機器；Split／Merge 由科技樹解鎖。

### 7. 解鎖與科技樹
- 科技樹做成真正的樹狀圖：依階層排列、連線表示前置條件、三種狀態，並標出缺什麼。
- 機器與基底藥物都要解鎖（參考 Big Pharma）。**每種基底是一張地圖**（類似 Potion Craft 的水／油／酒），也是之後多圖疊加的入口。
- 解鎖條件為現金＋Knowledge，部分節點另需里程碑，例如合約完成或發現某個盆地。

### 8. 介面清理
- 拿掉重複標記（`PLAN · FREE`／`PRODUCTION`），只在 Play 旁留一個小的狀態圖示。
- Guide 收進 Menu。
- Blueprints 面板改用遊戲的字型系統。
- Objective 依新循環改寫。
- 每項資訊都要能影響決策，否則移除。最後用 impeccable 重新審一輪。

### 9. 收尾
- 更新 design、overview、invariants、decisions、player-guide、ui-interaction、roadmap。
- 跑完整 gate，部署到 `https://hexapharma.5334601.xyz/`，進行真人 fresh-loop 試玩並記錄。

## Completion rule

- 自動 correctness：當前 commit 的`npm run check`全通過，balance/fresh-start checks沒有universal solution、region-minima或affordability退化。
- 真人玩法：依[playtest.md](playtest.md)在`0.0.0.0:53346 --strictPort`完成無fixture fresh loop，沒有blocker或未記錄fallback。
- 文件不記錄會迅速過期的test count；提交訊息與執行回報保存該次實際數字。

## Deliberately deferred

- 在上述structural contracts成立後，依真人資料調motif密度、terrain比例、cost/speed、linear price係數、unlock pacing與正式內容量。
- final art/audio polish、帳戶、雲端Blueprint repository。
- release candidate前的跨build save migration。

平衡可逐步調整；fresh-loop可達性、規劃後一次試驗的Research、朝向與轉向角、窄段可通過驗證、全圖連通、quota-3 contracts／tech gates、seed／disease解法差異、finite demand、overlap effects、完整PathStamp、霧下只露Wall與等高線、direct paid Production、optional Production Plan、true-hex geometry與strict gate不能後置。
