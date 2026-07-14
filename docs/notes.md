# Notes

## Current breaking-design gotchas

- **Research 不是小工廠**：只有 Atlas + ResearchProgram。不要保留 Route Floor toggle、source/belt/sink、linear route descriptor、Factory sample 或常駐 tutorial panel。
- **PathStamp fixed means fixed**：奇形 path cells/entry/exit 屬 catalog content。Factory 的 footRot/effect flip、CSS transform 或 renderer scale 都不能改 Research path authority。
- **prefix calibration 不是 auto-route**：它只把下一 stamp 接到當前 prefix endpoint，必須 canonical/serializable；不能改 stamp、跳過 prefix、偷跑 solver 或 silent repair。
- **Research 只探索**：fog/progress 只由實際 program execution 改變。Research 不鑄造 Pilot contract，不送 layout，也不替 Production 保證 cure。
- **Active Atlas 單層**：暫停 A–D tabs、跨層座標、swap/Phase Exchange 與 deeper-layer progression。舊 engine code存在不代表 UI/content可以繼續曝光。
- **portal 是同層 A→B**：成對、定向、trail 斷段；不能畫穿過中間未知格，也不能把 B 當回程入口。
- **terrain 不是換皮**：wall、abyss、swamp 必須在 pure path core 有不同 deterministic semantics；未定稿前 renderer 不猜。
- **mapgen constructive**：seeded radial bands + motifs 先構造合法 ResearchProgram；solver 只做 tests/tools quality audit，不進 production rejection loop。
- **Pilot 是 sandbox**：無 clock/cost/inventory/waste；可以從空地做任意合法 split/merge/parallel layout，與 Research 狀態解耦。
- **diagnostic 不是 gate**：Pilot 顯示 cure/side effects/final/throughput/deadlock，但 commission 不要求 cure、contract match 或好結果。只擋非法 layout／無法建立 Production 的 authority 錯誤。
- **Production 承擔後果**：initial layout exact copy Pilot；no-cure/failure/deadlock/副作用與低吞吐都不是 copy 時偷修的理由。
- **Blueprint v2 kind 不共用 payload**：`research-program`只存ordered `{typeId,stroke}`；`pilot-plant`存routing與`{id,typeId,stroke,anchor,footRot}`，不存chemical orientation/path。舊v1 `research-route`不可被decoder猜成program。
- **Blueprint ≠ save**：Library namespace/lifecycle 仍獨立；不含 fog/seed/economy/runtime/results。Load/Rewind 不能改 Library。
- **Save v6與checkpoint integration已完成**：full/compact/slots/rewind已用program/path/stroke與no-contract facilities，v5顯式拒絕；checkpointStorage lineage/recovery已完成；UI/E2E與gate須隨改動持續驗證。
- **hidden mounted ≠ active**：已造訪建築可 mounted 保存 camera/tool，但 hidden page 不接 gameplay input。
- **renderer failure must be visible**：Pixi dynamic import/asset/init 失敗不能用空 canvas 或 debug fallback 冒充成功。

## Why this redesign

- 把 FactoryLayout 塞進 Research，會讓探索變成第二個工廠 editor；固定奇形 PathStamp 讓玩家直接在 Atlas 上思考路徑、terrain 與 motif。
- multi-layer/swap 在核心路徑未穩前增加太多不可讀組合；同層 portal 先保留非連續路徑決策，跨層互動暫停而非偷偷半支援。
- Research contract 讓 Pilot/Production 退化成「驗證通過才能按下一步」的 web workflow。Research 只提供玩家知識、Pilot 免費試作、Production承擔實際結果，三頁才各有遊戲性。
- Blueprint 保存玩家可攜知識；因此 ResearchProgram 與 FactoryLayout 必須是兩種明確 payload，而不是用同一 layout schema 假裝。
