# Notes

## Current gotchas

- **三場域不是 tabs over one object**：Research/Pilot/Production 各持有 owned layout；transfer 明示複製，不能 alias 或 auto-pack。
- **Research 規劃不是探索**：只有 `beginResearchShot` 後完成的 machine steps 能揭霧；hover、ghost、layout validation、Pilot 測試都不能改 fog。
- **收費只在 shot 開始一次**：費用為 `max(1, Σ catalog cost)`；advance 不重複收，abort/fail 不退。
- **route descriptor 不猜**：只有唯一 source→machines→sink 線性 connectivity 能產生 Template。split/merge/cycle/disconnected 都拒絕。
- **Pilot 完全無時間**：不要為 Pilot 重用 Production transport/timer，也不要產生 inventory/waste/cash cost。
- **sink 交付物理藥**：Production inventory 必須保存實際 DrugState/Outcome/cost；不能由 contract 或 count 憑空鑄造。
- **effect orientation ≠ footRot**：前者改藥效，後者只旋 footprint/ports。
- **runtime ownership**：Production tick 前 snapshot→restore；runtime 綁 layout + map identity。成功 hot tick 零配置。
- **Atlas grid ≠ coordinate axes**：minor/5×5 major grid 保留；跟玩家位置相同的 X/Y 十字線移除。Focus 是一次動作，不是 follow mode。
- **Blueprint ≠ save**：Library key/limits/lifecycle 獨立；不含 seed/fog/economy/contract/runtime。Load/Rewind 不能改它。
- **strict import means no fallback**：未知欄位、checksum/version/ruleset/geometry 錯誤都要可見拒絕，不能「盡量讀」。
- **hidden mounted ≠ active**：已造訪建築可 mounted 保存 camera/tool，但 hidden page 不接 keyboard/pointer gameplay inputs。
- **renderer failure must be visible**：Pixi dynamic import/asset/init 失敗不能用空 canvas 或 debug tiles 冒充成功。
- **deeper reset**：清 Research/Pilot/Production、inventory/fog/sales，保留扣款後資源/patents/global inventory ID；UI 二次確認。
- **早期 save policy**：只保證同 content build；v4 不 migration，Save v5 顯式拒絕。

## Why these decisions

- Research 的付費 shot 讓探索有試錯成本；Pilot 的免費即時試作避免玩家為純排布浪費時間；Production 的 clock 才能承載吞吐樂趣。
- exact transfer 讓玩家在前一建築的空間思考延續到下一建築；若 compiler 偷偷重排，三場域會再次變成互不相干的 web workflow。
- Blueprint Library 保存的是玩家可攜知識，而 save 保存的是一局的 authority；分離才能跨存檔分享且不洩漏關卡資訊。
