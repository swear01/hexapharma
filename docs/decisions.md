# Decisions（技術決策紀錄）

> 記錄不可從程式碼自然推導的關鍵選擇。`歷史／已取代` 只保留決策脈絡，不是 active truth；完成證據仍以當前commit的gate與真人smoke為準。

| # | 決策 | 理由／推翻條件 |
|---|---|---|
| D1 | 純 code-as-truth，不使用 engine scene/視覺 editor。 | 內容是資料、runtime 生成；只有改成大量手工關卡才重議。 |
| D2 | TypeScript sim/core/tooling。 | CLI、headless、AI 協作與 Web 發布成本最低；規模到百萬實體才考慮移植 core。 |
| D3 | PixiJS v8 做 dumb renderer。 | renderer 只畫 authority；需要完整 scene/physics engine 才重議。 |
| D4 | React/DOM 疊 canvas 做 UI。 | 管理 UI 密集，但 world 仍由 Pixi 呈現。 |
| D5 | 確定性 sim + invariant/replay。 | 是除錯、save、程序生成與平行開發的地基，不推翻。 |
| D6 | 模組邊界是 agent ownership 邊界。 | public interface 同時只有一位 owner；integrator 序列化共享面。 |
| D7 | **歷史／已被 D22 取代**：一張效果圖是一種成分；1–4 層，一台機器同時變換各層位置。 | 新 milestone 暫停所有跨層互動，active Research 只有單層 Atlas。 |
| D8 | Atlas 與 Factory floor 都採正方格與相近直接操作肌肉記憶，但不共享資料 authority。 | Research PathStamp 不是 Factory footprint；共用手感不能變成共用 layout。 |
| D9 | 平面俯視正交；Atlas 使用原創 microscopic biochemical art。 | 不使用競品圖像/trade dress；正式美術可替換薄層資產。 |
| D10 | factory catalog 的path/stroke/cost/speed固定；機器以效果、footprint、吞吐形成取捨。 | 不提供任意chemical rotation或speed；數值待玩測。Research與Factory共享固定path，footRot只改實體footprint。 |
| D11 | factory translate 關係可含 forward/reverse/perpendicular/offset。 | 這是 Pilot/Production machine effect vocabulary；不能拿來讓 Research PathStamp 任意 rotate/flip。 |
| D12 | Constructive procedural generation；seed + 完整 options 是關卡身分。 | production 不靠 solver rejection loop；D22 進一步固定 radial+motif construction。 |
| D13 | Atlas 是遠大於正常 viewport 的中心起步局部世界；pan/zoom 明示，camera 不因 execution 搶回控制。 | 具體格數與 pixels 可調；不回退縮小全景或 auto-follow。 |
| D14 | solver 絕不進遊戲內自動解。 | 人類試錯是核心樂趣，runtime 不需要搜尋。 |
| D15 | **歷史／已被 D25 取代**：Save v5 + compact checkpoint budgets。 | 新 authority 使用breaking v6；v5只代表舊build。 |
| D16 | **歷史／已被 D22 取代**：map patent 以 1→2→3→4 layers 推進。 | active milestone 不做 layer progression/swap；Technology 改服務單層 Research/Factory。 |
| D17 | Production 使用 fixed-capacity SoA runtime、固定 event/scratch buffers、layout+content identity；只有 Production ticks 推進。 | 保留；只有 profiling與新 authority證明需改才重議。 |
| D18 | release candidate 前不維護跨 build save 相容或 legacy generator/migration chain。 | v6已顯式拒絕v5；正式migration matrix仍等release candidate建立。 |
| D19 | **歷史／已被 D20 取代**：Lab = 同頁 Atlas + Pilot Bench，之後直送 Factory。 | overlay 與雙空間同頁混淆。 |
| D20 | **部分保留、transfer 語意已被 D23 取代**：三個獨立建築 Research、Pilot、Production。 | 三頁角色保留；Research→Pilot contract/layout transfer 移除。 |
| D21 | **歷史／schema 已被 D24 取代**：Blueprint v1 的 Research/Pilot 都保存 portable FactoryLayout。 | 新 Research 沒有 FactoryLayout，必須改存 ResearchProgram。 |
| D22 | Active Research 是單一 Atlas：固定奇形 Machine PathStamp + prefix calibration；terrain 為 wall/abyss/swamp/同層 A→B portal；mapgen 為 seeded radial+motif constructive；跨層/swap 暫停。 | 讓探索本身成為空間玩法，移除第二個工廠頁與跨層複雜度。只有整體玩測證明單層 PathStamp 核心無法成立才重議。 |
| D23 | Research 只探索、不產生 contract。Pilot 是零時間/成本的任意合法 FactoryLayout sandbox；commission 不要求 cure/contract，Production exact copy 並承擔所有結果。 | 切斷「先證明正確才准量產」的僵硬 web workflow，讓 Pilot 是試作、Production 是後果。 |
| D24 | Blueprint wire/ruleset freeze為v2。`research-program`保存ordered `{typeId,stroke}`；`pilot-plant`保存routing與`{id,typeId,stroke,anchor,footRot}`；舊v1 `research-route`顯式拒絕。 | fixed path/shape由content fingerprint compatible catalog還原，不在wire重複；兩種payload不得cross-kind reinterpret。 |
| D25 | Save core wire freeze為breaking v6：full/compact/slots/rewind保存ResearchProgram/shot、path/stroke與contract-free Pilot/Production；v5顯式拒絕。 | 不能維護v5 Route Floor/contract authority；checkpointStorage UI/lineage integration已完成。 |

## Current authority summary

- UI：F1 單一 Research Atlas、F2 Pilot Plant、F3 Production；M/T/B drawers。
- Research：`ResearchProgram = ordered fixed PathStamps + prefix calibration`；stamp由前一endpoint接續，無任意placement、FactoryLayout、Route Floor、contract、多層/swap。
- Pilot：任意合法 FactoryLayout sandbox；no clock/cost；可不 cure、不 match 直接 commission。
- Production：initial layout exact copy Pilot；live runtime 以實際 outcome 決定 inventory/waste/economy。
- Blueprint：ResearchProgram kind + Pilot layout kind，Library 跨 save。
- Save：v6 core wire、checkpoint lineage/recovery與focused tests完成；全repo gate是持續驗收。
