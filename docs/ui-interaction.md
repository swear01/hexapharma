# HexaPharma UI 與直接操作契約

> 狀態：現行 single-Atlas interaction contract。舊 Research Route Floor、Atlas/Route modebar、A–D tabs、contract match workflow 與舊 screenshots 都不是 acceptance truth。

## 1. 方向

介面必須像工廠／空間解謎遊戲，不是以表單、Recipe cards、常駐說明文與 submit buttons 串成網站。中央 world 負責連續空間操作；DOM chrome 只處理工具、短狀態、離散管理與危險確認。

借鏡而不複製：

- **Big Pharma**：產線、機器 footprint、輸入輸出與瓶頸同屏可讀。[官方 Steam 頁](https://store.steampowered.com/app/344850/Big_Pharma/)
- **shapez 1**：world-first、低摩擦 pick/place/erase、方向 glyph、camera/toolbar。[官方 Steam 頁](https://store.steampowered.com/app/1318690/shapez/)
- **Factorio**：一致 hotkeys、cursor tool、pipette、rotate、copy/paste、undo。[官方網站](https://www.factorio.com/)
- **Potion Craft**：大探索圖遠大於 viewport、中心起步、fog限制資訊。[官方 Steam 頁](https://store.steampowered.com/app/1210320/Potion_Craft_Alchemist_Simulator/)

競品只用於互動原則研究；assets、icons、colors、layout與screenshots必須原創。`docs/assets/ui-study/before-*`只作舊版歷史比較；`current-*`由本build的Playwright真人尺寸流程重建。

目前視覺證據：

- [Desktop Research Atlas](assets/ui-study/current-research-atlas.png)｜[Compact Research](assets/ui-study/current-research-mobile.png)
- [Machine families / Pilot](assets/ui-study/current-machine-families.png)｜[Live Production](assets/ui-study/current-production.png)
- 歷史比較：[old Lab](assets/ui-study/before-lab.png)｜[old Factory](assets/ui-study/before-factory.png)

## 2. Shell / navigation

- HUD 只放跨建築資源與 Save controls；不放長篇玩法教學。
- 左 rail：F1 Research、F2 Pilot Plant、F3 Production。
- Market/Technology/Blueprints 是 M/T/B drawers；X/Escape 關閉，不是第四個建築 tab。
- 已造訪建築可 mounted 保存 camera/tool/history；hidden page 不接 gameplay keys/pointers。
- message layer 不攔 pointer；error 有 `role=alert`，status 進 live region。

## 3. Shared interaction language, separate authority

Research PathStamp 與 Factory editor共用肌肉記憶，但不是同一資料模型：

- LMB click/drag place；RMB erase；一個 gesture 一筆 history。
- Shift+LMB 或 MMB pan；wheel cursor-anchor zoom；camera 不改 authority。
- `R` 只在該 tool 明示支援時 rotate。fixed Research PathStamp 不因通用 Factory rotate hotkey改幾何。
- `Q` pipette、`Ctrl+C/X/V`、`Ctrl+Z/Y` 只能處理同 domain payload；不能把 Factory machine clipboard 貼成 PathStamp，反之亦然。
- Factory placement顯示authority valid/invalid ghost；Research idle ghost對revealed terrain使用pure path規則，hidden cells中性化，不依未知terrain／未揭露portal B改形，也不顯outcome。
- bottom hotbar 是持續 cursor tool belt，不是 submit form。tooltips/hotkey hints 可以出現；常駐 tutorial prose 不得佔 world 空間。

## 4. Research — one Atlas only

F1 只有單一 Research Atlas：

- 沒有 Effect Atlas／Route Floor modebar、Factory canvas、source/belt/sink palette、split/merge 或 linear-route inspector。
- 沒有 A–D layer tabs、swap／Phase Exchange tool、跨層 endpoint/camera state。
- Atlas 大於 viewport，開局 camera 對準 generator start；drag/wheel pan/zoom，Focus/F只做一次置中，不因 execution auto-follow。
- unknown terrain 由 opaque fog 遮蔽；grid/scale cues 可見但不能洩漏 wall/abyss/swamp/portal/motif。
- 不顯示常駐「教學卡／大段說明」。首次提示必須短、可消失，且不遮 path placement。

### PathStamp placement

- palette 每個 machine 顯示固定奇形 `PathStamp` silhouette、entry/exit 與 semantic glyph；不能用 generic rectangle/Factory footprint冒充。
- held stamp在Atlas顯示fog-sanitized preview：known terrain使用terrain-aware authority，unknown部分維持nominal path。固定geometry不隨Factory `footRot`、effect rotate/flip或camera transform改寫。
- program prefix、current endpoint與candidate calibration同屏可讀；UI只允許`1..path.length`，越界控制clamp／disable且不寫authority。
- calibration commit 後成為 `ResearchProgram` authority；前綴變更會重新驗證後綴，不能 silent shift/repair。
- ordered program 的編輯以直接選取/erase/undo為主，不回復 Recipe cards或拖曳 DOM timeline。
- Atlas LMB commit目前held stamp；RMB或Backspace移除最後一個ordered stamp，保持prefix authority可讀。
- committed prefix使用solid trail；held candidate使用不同的dashed trail與preview token。Enter執行Dispense，不重複commit held stamp。

### Execution and terrain feedback

- planning/hover/calibration 不改 fog，不顯示真實 outcome。
- 執行只畫已完成 program segment；future suffix 不能提前 reveal。
- wall、abyss、swamp 使用不同 world silhouette/feedback，確切 interaction 由 pure sim 決定。
- 同層 portal A→B 以明確成對 glyph辨識；trail 在 jump 處斷線，不能畫穿未知中間區。
- progress、stop/failure與探索結果使用短 HUD/status feedback；不產生「Send to Pilot」或 contract UI。

## 5. Pilot Plant

- 獨立 F2 page；完整 FactoryLayout editor，從空地開始也合法。
- No clock、no build cost；沒有 Production Play/Pause/Step、inventory 或 waste authority。
- source/belt/machine/splitter/merger/sink、footprint/ports/collision/routing、pipette/copy/undo全部直接操作。
- inspector 即時顯示 actual outcome（cures、side effects、final endpoints）、throughput、bottleneck、deadlock/analysis error；沒有 Research contract/matches-differs。
- diagnostics 是資訊，不是 commission gate。`Commission` 對 no-cure、side-effect、failure、deadlock/0 throughput仍可用，只在 layout 不符合 entitlement/catalog/geometry或無法建立 Production authority時拒絕。
- commission 成功不進行 auto-pack、repair、rotate或重接 routing。

## 6. Production

- 未 commission 顯示 offline world state + Go to Pilot；不提供空白 editor繞過流程。
- commission 後顯示 Pilot layout exact copy；初次 camera 將外部 layout bounds 放進 hotbar以上可見區。
- 只有 Production 顯示 Play/Pause/Step/Reset、tick、sink outcomes、inventory/waste、throughput、bottleneck。
- world可繼續直接編輯，但每次 edit 都由 live runtime承擔產品結果；沒有 contract match badge。
- failed/no-cure產品顯示為 waste，side effects跟實體產品進市場計價；不能在 UI 先過濾成「合法配方」才允許生產。

## 7. Blueprint drawer

- Library lifecycle 與 save slots分離。
- capture Research 產生v2 `research-program` payload（ordered `{typeId,stroke}`）；capture Pilot 產生v2 `pilot-plant` payload（routing + `{id,typeId,stroke,anchor,footRot}`）。按鈕、card與apply target需清楚標 kind。
- paste/upload/download/delete使用 strict version/checksum/content/bounds validator；錯誤可見且 import atomic。
- 舊 layout-based `research-route` v1 文件不得顯示為可載入的新 ResearchProgram；明示unsupported legacy version。
- Blueprint 不保存 fog/seed/terrain discoveries/economy/runtime/results。

## 8. Other drawers / destructive actions

- Market/Technology cards可用按鈕，因它們是離散管理決策。
- Technology不顯示 layer/swap progression。PathStamp、motif、factory machine、land或探索輔助 unlock 必須區分 Research/Factory domain。
- 探索輔助只能放大實際dispense segment的trail scan；按下Unlock不能直接揭霧。
- 擴廠若會重建commissioned Production runtime／waste，Unlock前必須有可取消的destructive confirmation；擴廠不能中止active Research shot。
- 會重生 Atlas或清場域的 action 使用 modal，完整列出 affected authority並二次確認；一般操作不用 modal。

## 9. Responsive and visual acceptance

- desktop world/canvas是 stage主要寬度；inspector不覆蓋 world。窄屏改上下配置，但 Atlas/Factory canvas、hotbar與command都可達。
- Research stamp以不規則 silhouette/entry/exit/prefix connection辨識；terrain/portal不能使用 raw debug text冒充美術。
- Factory machine以 silhouette、footprint、semantic glyph、ports與 bottleneck highlight辨識；belt是連續 transport，不是滿格按鈕。
- chrome低裝飾、短動畫、清楚邊界；禁止 giant blur/pill與常駐 tutorial遮 world。
- Playwright需重建 single Research Atlas、PathStamp families/portal、Pilot sandbox、commissioned Production與 compact baselines。舊 Route Floor/contract screenshots不得沿用。

## 10. Copyright boundary

- 不抓取或打包競品 screenshots、sprites、icons、fonts、sounds、CSS或UI layouts。
- `public/assets/lab/README.md` 記錄原創生成/處理與 runtime manifest。
- 文件只使用本專案 own screenshots；外部研究只連官方頁面。
