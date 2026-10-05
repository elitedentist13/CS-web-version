/* Same three locales as the Banana dashboard (joyful_ui_lang_v1). */
(function (g) {
    var KEY = 'joyful_ui_lang_v1';
    var lang = 'en';
    var onLang = null;
    var STR = {
        'lang.en': { en: 'English', 'zh-CN': 'English', 'zh-Hant': 'English' },
        'lang.zhCN': { en: '中文', 'zh-CN': '中文', 'zh-Hant': '中文' },
        'lang.zhHant': { en: '繁體中文', 'zh-CN': '繁體中文', 'zh-Hant': '繁體中文' },
        'lang.group': { en: 'Display language', 'zh-CN': '显示语言', 'zh-Hant': '顯示語言' },
        'ui.brand': { en: 'Banana · Lateral ceph', 'zh-CN': '香蕉 · 侧位头影', 'zh-Hant': '香蕉 · 側位頭影' },
        'ui.title': { en: 'Banana · Lateral cephalometric', 'zh-CN': '香蕉 · 侧位头影测量', 'zh-Hant': '香蕉 · 側位頭影測量' },
        'btn.load': { en: 'Load film', 'zh-CN': '载入底片', 'zh-Hant': '載入底片' },
        'btn.detect': { en: 'Auto landmarks', 'zh-CN': '自动定点', 'zh-Hant': '自動定點' },
        'btn.advanced': { en: 'Advanced', 'zh-CN': '进阶', 'zh-Hant': '進階' },
        'btn.advancedTitle': { en: 'Show training library and reference-set tools.', 'zh-CN': '显示训练库与参考组工具。', 'zh-Hant': '顯示訓練庫與參考組工具。' },
        'btn.refPub': { en: 'Published 1502', 'zh-CN': '公开库 1502', 'zh-Hant': '公開庫 1502' },
        'btn.refPubTitle': { en: 'Auto-detect from the read-only 1502 published tracings only.', 'zh-CN': '只用只读的 1502 份公开描记做自动定点。', 'zh-Hant': '只用唯讀的 1502 份公開描記做自動定點。' },
        'btn.refPlus': { en: 'Published + in-house', 'zh-CN': '公开库 + 院内', 'zh-Hant': '公開庫 + 院內' },
        'btn.refPlusTitle': { en: 'Auto-detect from the 1502 published tracings plus in-house training films. The two libraries stay stored separately.', 'zh-CN': '用 1502 公开描记加上院内训练片。两库分开存放。', 'zh-Hant': '用 1502 公開描記加上院內訓練片。兩庫分開存放。' },
        'btn.learn': { en: 'Add this set to clinic training', 'zh-CN': '将本组加入院内训练', 'zh-Hant': '將本組加入院內訓練' },
        'btn.learnUndo': { en: 'Undo last film', 'zh-CN': '撤销上张', 'zh-Hant': '撤銷上張' },
        'lbl.mmPx': { en: 'mm/px', 'zh-CN': 'mm/px', 'zh-Hant': 'mm/px' },
        'btn.calibrate': { en: 'Calibrate ruler', 'zh-CN': '标定尺', 'zh-Hant': '標定尺' },
        'btn.calibrateTitle': { en: 'Click two ends of a known millimetre marker on the film.', 'zh-CN': '在底片已知毫米标记两端各点一下。', 'zh-Hant': '在底片已知毫米標記兩端各點一下。' },
        'lbl.rulerMm': { en: 'ruler mm', 'zh-CN': '尺长 mm', 'zh-Hant': '尺長 mm' },
        'btn.invert': { en: 'Invert', 'zh-CN': '反相', 'zh-Hant': '反相' },
        'btn.invertTitle': { en: 'Invert the film for tracing dark fossae.', 'zh-CN': '反相以便描记暗区。', 'zh-Hant': '反相以便描記暗區。' },
        'lbl.bright': { en: 'bright', 'zh-CN': '亮度', 'zh-Hant': '亮度' },
        'lbl.contrast': { en: 'contrast', 'zh-CN': '对比', 'zh-Hant': '對比' },
        'btn.fhUp': { en: 'FH up', 'zh-CN': '眶耳平面水平', 'zh-Hant': '眶耳平面水平' },
        'btn.fhUpTitle': { en: 'Rotate the film so Frankfort (Po–Or) is horizontal.', 'zh-CN': '旋转底片使眶耳平面（Po–Or）水平。', 'zh-Hant': '旋轉底片使眶耳平面（Po–Or）水平。' },
        'btn.undo': { en: 'Undo point', 'zh-CN': '撤销定点', 'zh-Hant': '撤銷定點' },
        'btn.undoTitle': { en: 'Undo the last landmark drag.', 'zh-CN': '撤销上一次拖动的标志点。', 'zh-Hant': '撤銷上一次拖動的標誌點。' },
        'btn.reset': { en: 'Reset view', 'zh-CN': '重设视图', 'zh-Hant': '重設視圖' },
        'btn.resetTitle': { en: 'Reset zoom and pan.', 'zh-CN': '重设缩放与平移。', 'zh-Hant': '重設縮放與平移。' },
        'btn.save': { en: 'Save tracing', 'zh-CN': '保存描记', 'zh-Hant': '儲存描記' },
        'btn.saveTitle': { en: 'Save this tracing on the patient film. Reopen the same ceph to restore it as the default landmarks.', 'zh-CN': '把这组描记存到该病人底片。再次打开同一张头影时作为默认标志点。', 'zh-Hant': '把這組描記存到該病人底片。再次開啟同一張頭影時作為預設標誌點。' },
        'btn.loadTrace': { en: 'Load tracing', 'zh-CN': '载入描记', 'zh-Hant': '載入描記' },
        'btn.loadTraceTitle': { en: 'Restore the tracing saved for this film (this computer or the patient record). Use after Auto landmarks to get the saved points back.', 'zh-CN': '恢复该片已保存的描记（本机或病人底片）。自动定点后可用此按钮取回保存的点。', 'zh-Hant': '恢復該片已儲存的描記（本機或病人底片）。自動定點後可用此按鈕取回儲存的點。' },
        'btn.print': { en: 'Print report', 'zh-CN': '打印报告', 'zh-Hant': '列印報告' },
        'btn.printTitle': { en: 'Print a one-page ceph report.', 'zh-CN': '打印一页头影报告。', 'zh-Hant': '列印一頁頭影報告。' },
        'btn.json': { en: 'Export JSON', 'zh-CN': '导出 JSON', 'zh-Hant': '匯出 JSON' },
        'btn.csv': { en: 'Export CSV', 'zh-CN': '导出 CSV', 'zh-Hant': '匯出 CSV' },
        'btn.png': { en: 'Export marked PNG', 'zh-CN': '导出标记图', 'zh-Hant': '匯出標記圖' },
        'btn.extractHelp': { en: 'Extraction notes', 'zh-CN': '拔牙说明', 'zh-Hant': '拔牙說明' },
        'btn.extractHelpTitle': { en: 'Chairside reminder of extract vs keep on the tracing.', 'zh-CN': '椅旁对照：描记上倾向拔牙或不拔。', 'zh-Hant': '椅旁對照：描記上傾向拔牙或不拔。' },
        'btn.adopt': { en: 'Adopt selection', 'zh-CN': '采用此组', 'zh-Hant': '採用此組' },
        'btn.changeSet': { en: 'Change set', 'zh-CN': '更换组别', 'zh-Hant': '更換組別' },
        'setBar.title': { en: 'Click UNet or 1502 to view a set, then Adopt selection.', 'zh-CN': '点 UNet 或 1502 查看组别，再采用此组。', 'zh-Hant': '點 UNet 或 1502 查看組別，再採用此組。' },
        'cap.needDetect': { en: 'Run Auto landmarks, then view UNet and 1502.', 'zh-CN': '先自动定点，再查看 UNet 与 1502。', 'zh-Hant': '先自動定點，再查看 UNet 與 1502。' },
        'hint.side': { en: '19 ISBI 2015 landmarks plus U1a / L1a (incisor apices) and FopA / FopP (functional occlusal plane). Drag those handles so IMPA, Wits and N-perp match textbook constructions. Auto-detect offers 2 sets: UNet (default) and the 1502 library average (plus in-house if Published + in-house is on). Compare values to Caucasian or HK Chinese norms (green = within 1 SD, amber = 1–2 SD, red = beyond). Calibrate millimetres from a known marker on the film. The extraction index is a ceph-only tendency vs those norms — crowding, Bolton and growth are not on this film.', 'zh-CN': '19 个 ISBI 2015 标志点，另加 U1a / L1a（切牙根尖）与 FopA / FopP（功能𬌗平面）。拖动这些点使 IMPA、Wits、N-perp 符合教科书作法。自动定点两组：UNet（默认）与 1502 库平均（公开库 + 院内时加上院内）。对照白人或香港华人常值（绿＝1 个标准差内，黄＝1–2 个，红＝以外）。用底片已知标记标定毫米。拔牙指数只反映头影相对常值的倾向——拥挤、Bolton、生长发育不在这张侧位片上。', 'zh-Hant': '19 個 ISBI 2015 標誌點，另加 U1a / L1a（切牙根尖）與 FopA / FopP（功能咬合平面）。拖動這些點使 IMPA、Wits、N-perp 符合教科書作法。自動定點兩組：UNet（預設）與 1502 庫平均（公開庫 + 院內時加上院內）。對照白人或香港華人常值（綠＝1 個標準差內，黃＝1–2 個，紅＝以外）。用底片已知標記標定毫米。拔牙指數只反映頭影相對常值的傾向——擁擠、Bolton、生長發育不在這張側位片上。' },
        'h.pub': { en: 'Published tracings', 'zh-CN': '公开描记', 'zh-Hant': '公開描記' },
        'h.pubHint': { en: 'ISBI 2015 + Aariz + PKU. Read-only.', 'zh-CN': 'ISBI 2015 + Aariz + PKU。只读。', 'zh-Hant': 'ISBI 2015 + Aariz + PKU。唯讀。' },
        'h.clinic': { en: 'Clinic training', 'zh-CN': '院内训练', 'zh-Hant': '院內訓練' },
        'h.overlay': { en: 'Progress overlay', 'zh-CN': '疗程叠加', 'zh-Hant': '療程疊加' },
        'h.overlayHint': { en: 'Register a prior tracing on SN at Sella, Frankfort at Porion, or palatal plane at ANS.', 'zh-CN': '将先前描记套到 SN 于蝶鞍、眶耳平面于耳点，或腭平面于前鼻棘。', 'zh-Hant': '將先前描記套到 SN 於蝶鞍、眶耳平面於耳點，或腭平面於前鼻棘。' },
        'btn.ovSn': { en: 'SN at S', 'zh-CN': 'SN 于 S', 'zh-Hant': 'SN 於 S' },
        'btn.ovFh': { en: 'FH at Po', 'zh-CN': 'FH 于 Po', 'zh-Hant': 'FH 於 Po' },
        'btn.ovPp': { en: 'ANS–PNS', 'zh-CN': 'ANS–PNS', 'zh-Hant': 'ANS–PNS' },
        'btn.ovOff': { en: 'Clear', 'zh-CN': '清除', 'zh-Hant': '清除' },
        'h.landmarks': { en: 'Landmarks', 'zh-CN': '标志点', 'zh-Hant': '標誌點' },
        'lbl.norms': { en: 'Norms', 'zh-CN': '常值', 'zh-Hant': '常值' },
        'btn.normCauc': { en: 'Caucasian', 'zh-CN': '白人', 'zh-Hant': '白人' },
        'btn.normCaucTitle': { en: 'Caucasian adult textbook means (Steiner / Downs / Tweed).', 'zh-CN': '白人成人教科书均值（Steiner / Downs / Tweed）。', 'zh-Hant': '白人成人教科書均值（Steiner / Downs / Tweed）。' },
        'btn.normCn': { en: 'HK Chinese', 'zh-CN': '香港华人', 'zh-Hant': '香港華人' },
        'btn.normCnTitle': { en: 'Southern Chinese / Hong Kong adult composite (Chan 1972; Cooke & Wei 1988).', 'zh-CN': '华南 / 香港成人综合常值（Chan 1972；Cooke & Wei 1988）。', 'zh-Hant': '華南 / 香港成人綜合常值（Chan 1972；Cooke & Wei 1988）。' },
        'btn.ageAdult': { en: 'Adult', 'zh-CN': '成人', 'zh-Hant': '成人' },
        'btn.ageAdultTitle': { en: 'Published adult table. Default.', 'zh-CN': '公开成人常值。默认。', 'zh-Hant': '公開成人常值。預設。' },
        'btn.ageChild': { en: 'Child', 'zh-CN': '儿童', 'zh-Hant': '兒童' },
        'btn.ageChildTitle': { en: 'Approximate mixed-dentition offset vs the adult table — not a published child study.', 'zh-CN': '相对成人表的替牙期近似偏移，不是发表的儿童常值研究。', 'zh-Hant': '相對成人表的替牙期近似偏移，不是發表的兒童常值研究。' },
        'btn.sexM': { en: 'M', 'zh-CN': '男', 'zh-Hant': '男' },
        'btn.sexF': { en: 'F', 'zh-CN': '女', 'zh-Hant': '女' },
        'st.age': { en: 'Norm age band: {label}.', 'zh-CN': '常值年龄段：{label}。', 'zh-Hant': '常值年齡段：{label}。' },
        'st.sex': { en: 'Norm sex offset: {label}.', 'zh-CN': '常值性别偏移：{label}。', 'zh-Hant': '常值性別偏移：{label}。' },
        'btn.sexU': { en: 'unspecified', 'zh-CN': '未指定', 'zh-Hant': '未指定' },
        'btn.walk': { en: 'Check points', 'zh-CN': '核对定点', 'zh-Hant': '核對定點' },
        'btn.walkTitle': { en: 'Click to walk through Go, Po, Or, Ar, incisor apices and pronasale.', 'zh-CN': '点击后依次核对 Go、Po、Or、Ar、切牙根尖与鼻尖。', 'zh-Hant': '點擊後依序核對 Go、Po、Or、Ar、切牙根尖與鼻尖。' },
        'btn.walkNext': { en: 'Next', 'zh-CN': '下一个', 'zh-Hant': '下一個' },
        'btn.walkSkip': { en: 'Skip', 'zh-CN': '跳过', 'zh-Hant': '跳過' },
        'btn.walkDone': { en: 'Done', 'zh-CN': '完成', 'zh-Hant': '完成' },
        'st.walk': { en: 'Check {n}/{of}: {id} — {hint}', 'zh-CN': '核对 {n}/{of}：{id} — {hint}', 'zh-Hant': '核對 {n}/{of}：{id} — {hint}' },
        'st.walkDone': { en: 'Point check finished.', 'zh-CN': '定点核对完成。', 'zh-Hant': '定點核對完成。' },
        'walk.Go': { en: 'posterior-inferior mandibular angle', 'zh-CN': '下颌角后下点', 'zh-Hant': '下頜角後下點' },
        'walk.Po': { en: 'superior point of the external auditory meatus', 'zh-CN': '外耳道上缘（耳点）', 'zh-Hant': '外耳道上緣（耳點）' },
        'walk.Or': { en: 'lowest point of the orbital rim', 'zh-CN': '眶下缘最低点', 'zh-Hant': '眶下緣最低點' },
        'walk.Ar': { en: 'junction of posterior ramus and cranial base', 'zh-CN': '下颌升支后缘与颅底交界', 'zh-Hant': '下頜升支後緣與顱底交界' },
        'walk.U1a': { en: 'upper incisor root apex', 'zh-CN': '上切牙根尖', 'zh-Hant': '上切牙根尖' },
        'walk.L1a': { en: 'lower incisor root apex', 'zh-CN': '下切牙根尖', 'zh-Hant': '下切牙根尖' },
        'walk.Pn': { en: 'nose tip for the E-line', 'zh-CN': '鼻尖（审美线）', 'zh-Hant': '鼻尖（審美線）' },
        'norm.src.caucasian': { en: 'Caucasian adult textbook (Steiner / Downs / Tweed / McNamara)', 'zh-CN': '白人成人教科书（Steiner / Downs / Tweed / McNamara）', 'zh-Hant': '白人成人教科書（Steiner / Downs / Tweed / McNamara）' },
        'norm.src.chinese': { en: 'Southern Chinese / Hong Kong adult (Chan 1972; Cooke & Wei 1988)', 'zh-CN': '华南 / 香港成人（Chan 1972；Cooke & Wei 1988）', 'zh-Hant': '華南 / 香港成人（Chan 1972；Cooke & Wei 1988）' },
        'sum.skeletal': { en: 'Skeletal · 骨性', 'zh-CN': '骨性', 'zh-Hant': '骨性' },
        'sum.vertical': { en: 'Vertical · 垂直', 'zh-CN': '垂直向', 'zh-Hant': '垂直向' },
        'sum.profile': { en: 'Profile · 侧貌', 'zh-CN': '侧貌', 'zh-Hant': '側貌' },
        'sum.incisor': { en: 'Incisors / lip · 切牙/唇', 'zh-CN': '切牙 / 唇', 'zh-Hant': '切牙 / 唇' },
        'sum.extract': { en: 'Extraction · 拔牙倾向', 'zh-CN': '拔牙倾向', 'zh-Hant': '拔牙傾向' },
        'sum.notes': { en: 'notes', 'zh-CN': '说明', 'zh-Hant': '說明' },
        'sum.lip': { en: 'lip', 'zh-CN': '唇', 'zh-Hant': '唇' },
        'th.measure': { en: 'Measure', 'zh-CN': '项目', 'zh-Hant': '項目' },
        'th.value': { en: 'Value', 'zh-CN': '数值', 'zh-Hant': '數值' },
        'th.delta': { en: 'Δ', 'zh-CN': 'Δ', 'zh-Hant': 'Δ' },
        'th.norm': { en: 'Norm', 'zh-CN': '常值', 'zh-Hant': '常值' },
        'g.steiner': { en: 'Steiner', 'zh-CN': 'Steiner', 'zh-Hant': 'Steiner' },
        'g.downs': { en: 'Downs', 'zh-CN': 'Downs', 'zh-Hant': 'Downs' },
        'g.tweed': { en: 'Tweed', 'zh-CN': 'Tweed', 'zh-Hant': 'Tweed' },
        'g.wits': { en: 'Wits', 'zh-CN': 'Wits', 'zh-Hant': 'Wits' },
        'g.mcnamara': { en: 'McNamara', 'zh-CN': 'McNamara', 'zh-Hant': 'McNamara' },
        'g.ricketts': { en: 'Ricketts', 'zh-CN': 'Ricketts', 'zh-Hant': 'Ricketts' },
        'g.jarabak': { en: 'Jarabak', 'zh-CN': 'Jarabak', 'zh-Hant': 'Jarabak' },
        'g.soft': { en: 'Soft tissue', 'zh-CN': '软组织', 'zh-Hant': '軟組織' },
        'g.extract': { en: 'Extraction index', 'zh-CN': '拔牙指数', 'zh-Hant': '拔牙指數' },
        'g.cvm': { en: 'CVM', 'zh-CN': 'CVM 颈椎成熟', 'zh-Hant': 'CVM 頸椎成熟' },
        'lbl.cvm': { en: 'CVM (child)', 'zh-CN': 'CVM（儿童）', 'zh-Hant': 'CVM（兒童）' },
        'btn.cvmClear': { en: 'Clear', 'zh-CN': '清除', 'zh-Hant': '清除' },
        'btn.autoCvm': { en: 'Auto CVM', 'zh-CN': '自动 CVM', 'zh-Hant': '自動 CVM' },
        'btn.autoCvmTitle': { en: 'Classify CS1–CS6 from the C2–C4 region (Dental_001 model). You can still override.', 'zh-CN': '用 C2–C4 模型自动分 CS1–CS6（Dental_001）。仍可手工改。', 'zh-Hant': '用 C2–C4 模型自動分 CS1–CS6（Dental_001）。仍可手工改。' },
        'st.cvmApi': { en: 'Auto CVM {label} from the C2–C4 model.', 'zh-CN': '自动 CVM {label}（C2–C4 模型）。', 'zh-Hant': '自動 CVM {label}（C2–C4 模型）。' },
        'st.cvmNeedWeights': { en: 'C2–C4 weights are not on this PC. Stage CS1–CS6 by hand, or add Dental_001 weights under xray-ai-service/ceph/weights/.', 'zh-CN': '本机没有 C2–C4 权重。请手工选 CS1–CS6，或把 Dental_001 权重放到 xray-ai-service/ceph/weights/。', 'zh-Hant': '本機沒有 C2–C4 權重。請手工選 CS1–CS6，或把 Dental_001 權重放到 xray-ai-service/ceph/weights/。' },
        'st.cvmFail': { en: 'Auto CVM could not reach the local AI service. Stage CS1–CS6 by hand.', 'zh-CN': '自动 CVM 连不上本机 AI 服务。请手工选 CS1–CS6。', 'zh-Hant': '自動 CVM 連不上本機 AI 服務。請手工選 CS1–CS6。' },
        'st.cvmRun': { en: 'Reading C2–C4 for CVM…', 'zh-CN': '正在读取 C2–C4 做 CVM…', 'zh-Hant': '正在讀取 C2–C4 做 CVM…' },
        'sum.cvm': { en: 'CVM · interceptive', 'zh-CN': 'CVM · 早期阻断', 'zh-Hant': 'CVM · 早期阻斷' },
        'cvm.need': { en: 'Stage C2–C4 on the film (Baccetti CS1–CS6 / Aariz). The 19 landmarks cannot classify CVM. Timing hint only — not a treatment plan.', 'zh-CN': '请按底片 C2–C4 判定（Baccetti CS1–CS6 / Aariz）。19 个标志点不能分类 CVM。仅为时机提示，不是治疗计划。', 'zh-Hant': '請按底片 C2–C4 判定（Baccetti CS1–CS6 / Aariz）。19 個標誌點不能分類 CVM。僅為時機提示，不是治療計畫。' },
        'cvm.cs1': { en: 'Early interceptive (crossbite, habits, space) can start now. Functional Class II usually waits — peak is still about 2 years away.', 'zh-CN': '可开始早期阻断（反𬌗、习惯、间隙）。功能矫治 / II 类骨矫形通常再等 — 高峰约 2 年。', 'zh-Hant': '可開始早期阻斷（反咬、習慣、間隙）。功能矯治 / II 類骨矯形通常再等 — 高峰約 2 年。' },
        'cvm.cs2': { en: 'Continue interceptive if needed. Plan functional / growth-modification for CS3 — about 1 year to peak.', 'zh-CN': '需要时继续阻断。功能 / 生长改良安排到 CS3 — 距高峰约 1 年。', 'zh-Hant': '需要時繼續阻斷。功能 / 生長改良安排到 CS3 — 距高峰約 1 年。' },
        'cvm.cs3': { en: 'Peak window. Best time for growth-modification / functional Class II if indicated. Finish remaining interceptive problems now.', 'zh-CN': '高峰窗口。若有指征，现为生长改良 / 功能 II 类最佳时机。剩余阻断问题现在做完。', 'zh-Hant': '高峰窗口。若有指徵，現為生長改良 / 功能 II 類最佳時機。剩餘阻斷問題現在做完。' },
        'cvm.cs4': { en: 'Peak just passed. Residual growth only; the interceptive window is closing.', 'zh-CN': '高峰刚过。仅剩残余生长；阻断窗口在关闭。', 'zh-Hant': '高峰剛過。僅剩殘餘生長；阻斷窗口在關閉。' },
        'cvm.cs5': { en: 'Little residual growth. Early interceptive timing has passed; comprehensive treatment rather than growth modification.', 'zh-CN': '残余生长很少。早期阻断时机已过；宜综合矫治而非生长改良。', 'zh-Hant': '殘餘生長很少。早期阻斷時機已過；宜綜合矯治而非生長改良。' },
        'cvm.cs6': { en: 'Growth complete. Not an interceptive-timing stage.', 'zh-CN': '生长完成。不是早期阻断时机。', 'zh-Hant': '生長完成。不是早期阻斷時機。' },
        'st.cvm': { en: 'CVM {label}.', 'zh-CN': 'CVM {label}。', 'zh-Hant': 'CVM {label}。' },
        'set.imgEdge': { en: 'Image + edge', 'zh-CN': '影像 + 边缘', 'zh-Hant': '影像 + 邊緣' },
        'set.boxEdge': { en: 'Box + edge', 'zh-CN': '框 + 边缘', 'zh-Hant': '框 + 邊緣' },
        'set.clinic': { en: 'Clinic overlay', 'zh-CN': '院内叠加', 'zh-Hant': '院內疊加' },
        'set.close': { en: 'Close-match', 'zh-CN': '近邻匹配', 'zh-Hant': '近鄰匹配' },
        'set.api': { en: 'AI service', 'zh-CN': 'AI 服务', 'zh-Hant': 'AI 服務' },
        'set.unet': { en: 'UNet auto landmarks', 'zh-CN': 'UNet 自动定点', 'zh-Hant': 'UNet 自動定點' },
        'set.lib1502': { en: '1502 library ± self-training average', 'zh-CN': '1502 库 ± 自训练平均', 'zh-Hant': '1502 庫 ± 自訓練平均' },
        'set.lib1502plus': { en: '1502 + self-training library average', 'zh-CN': '1502 + 自训练库平均', 'zh-Hant': '1502 + 自訓練庫平均' },
        'lm.S': { en: 'Sella', 'zh-CN': '蝶鞍点', 'zh-Hant': '蝶鞍點' },
        'lm.N': { en: 'Nasion', 'zh-CN': '鼻根点', 'zh-Hant': '鼻根點' },
        'lm.Or': { en: 'Orbitale', 'zh-CN': '眶点', 'zh-Hant': '眶點' },
        'lm.Po': { en: 'Porion', 'zh-CN': '耳点', 'zh-Hant': '耳點' },
        'lm.A': { en: 'A-point (Subspinale)', 'zh-CN': 'A 点', 'zh-Hant': 'A 點' },
        'lm.B': { en: 'B-point (Supramentale)', 'zh-CN': 'B 点', 'zh-Hant': 'B 點' },
        'lm.Pog': { en: 'Pogonion', 'zh-CN': '颏前点', 'zh-Hant': '頦前點' },
        'lm.Me': { en: 'Menton', 'zh-CN': '颏下点', 'zh-Hant': '頦下點' },
        'lm.Gn': { en: 'Gnathion', 'zh-CN': '颏顶点', 'zh-Hant': '頦頂點' },
        'lm.Go': { en: 'Gonion', 'zh-CN': '下颌角点', 'zh-Hant': '下頜角點' },
        'lm.L1': { en: 'Incision inferius', 'zh-CN': '下切牙切缘', 'zh-Hant': '下切牙切緣' },
        'lm.U1': { en: 'Incision superius', 'zh-CN': '上切牙切缘', 'zh-Hant': '上切牙切緣' },
        'lm.Ls': { en: 'Upper lip', 'zh-CN': '上唇', 'zh-Hant': '上唇' },
        'lm.Li': { en: 'Lower lip', 'zh-CN': '下唇', 'zh-Hant': '下唇' },
        'lm.Sn': { en: 'Subnasale', 'zh-CN': '鼻下点', 'zh-Hant': '鼻下點' },
        'lm.PogS': { en: 'Soft-tissue pogonion', 'zh-CN': '软组织颏前点', 'zh-Hant': '軟組織頦前點' },
        'lm.PNS': { en: 'Posterior nasal spine', 'zh-CN': '后鼻棘', 'zh-Hant': '後鼻棘' },
        'lm.ANS': { en: 'Anterior nasal spine', 'zh-CN': '前鼻棘', 'zh-Hant': '前鼻棘' },
        'lm.Ar': { en: 'Articulare', 'zh-CN': '关节点', 'zh-Hant': '關節點' },
        'extra.U1a': { en: 'U1 apex', 'zh-CN': '上切牙根尖', 'zh-Hant': '上切牙根尖' },
        'extra.L1a': { en: 'L1 apex', 'zh-CN': '下切牙根尖', 'zh-Hant': '下切牙根尖' },
        'extra.FopA': { en: 'FOP anterior', 'zh-CN': '功能𬌗平面前', 'zh-Hant': '功能咬合平面前' },
        'extra.FopP': { en: 'FOP posterior', 'zh-CN': '功能𬌗平面后', 'zh-Hant': '功能咬合平面後' },
        'extra.Pn': { en: 'Pronasale (nose tip)', 'zh-CN': '鼻尖点', 'zh-Hant': '鼻尖點' },
        'tag.check': { en: '(check)', 'zh-CN': '（请核对）', 'zh-Hant': '（請核對）' },
        'tag.moved': { en: '(moved)', 'zh-CN': '（已移）', 'zh-Hant': '（已移）' },
        'ph.average': { en: 'average', 'zh-CN': '均角', 'zh-Hant': '均角' },
        'ph.high-angle': { en: 'high-angle', 'zh-CN': '高角', 'zh-Hant': '高角' },
        'ph.low-angle': { en: 'low-angle', 'zh-CN': '低角', 'zh-Hant': '低角' },
        'ph.straight': { en: 'straight', 'zh-CN': '直面型', 'zh-Hant': '直面型' },
        'ph.convex': { en: 'convex', 'zh-CN': '凸面型', 'zh-Hant': '凸面型' },
        'ph.concave': { en: 'concave', 'zh-CN': '凹面型', 'zh-Hant': '凹面型' },
        'ph.proclined': { en: 'proclined', 'zh-CN': '唇倾', 'zh-Hant': '唇傾' },
        'ph.retroclined': { en: 'retroclined', 'zh-CN': '舌倾', 'zh-Hant': '舌傾' },
        'ph.protrusive': { en: 'protrusive', 'zh-CN': '前突', 'zh-Hant': '前突' },
        'ph.retrusive': { en: 'retrusive', 'zh-CN': '后缩', 'zh-Hant': '後縮' },
        'ph.balanced': { en: 'balanced', 'zh-CN': '适中', 'zh-Hant': '適中' },
        'ph.—': { en: '—', 'zh-CN': '—', 'zh-Hant': '—' },
        'extract.low': { en: 'Low', 'zh-CN': '低', 'zh-Hant': '低' },
        'extract.borderline': { en: 'Borderline', 'zh-CN': '交界', 'zh-Hant': '交界' },
        'extract.moderate': { en: 'Moderate', 'zh-CN': '中等', 'zh-Hant': '中等' },
        'extract.high': { en: 'High', 'zh-CN': '高', 'zh-Hant': '高' },
        'extract.disclaimer': { en: 'Ceph only; crowding / Bolton / growth not assessed. Not a treatment plan.', 'zh-CN': '仅头影；未评估拥挤 / Bolton / 生长发育。不是治疗计划。', 'zh-Hant': '僅頭影；未評估擁擠 / Bolton / 生長發育。不是治療計劃。' },
        'hint.Class II camouflage (upper premolars more often than 4 premolars)': { en: 'Class II camouflage (upper premolars more often than 4 premolars)', 'zh-CN': 'II 类掩饰（以上前磨牙为多，不是自动拔四颗）', 'zh-Hant': 'II 類掩飾（以上前磨牙為多，不是自動拔四顆）' },
        'hint.Class III: lower-arch camouflage or surgery; not a 4-premolar pattern': { en: 'Class III: lower-arch camouflage or surgery; not a 4-premolar pattern', 'zh-CN': 'III 类：下颌掩饰或手术；不是拔四颗前磨牙的模式', 'zh-Hant': 'III 類：下頜掩飾或手術；不是拔四顆前磨牙的模式' },
        'st.loadFirst': { en: 'Load a lateral ceph first.', 'zh-CN': '请先载入侧位头影片。', 'zh-Hant': '請先載入側位頭影片。' },
        'st.loadHint': { en: 'Load a lateral cephalogram (JPG / PNG / BMP). Auto-detect shows UNet (default) and the 1502 library average; Adopt selection keeps one.', 'zh-CN': '载入侧位头影片（JPG / PNG / BMP）。自动定点给出 UNet（默认）与 1502 库平均；采用此组后保留一组。', 'zh-Hant': '載入側位頭影片（JPG / PNG / BMP）。自動定點給出 UNet（預設）與 1502 庫平均；採用此組後保留一組。' },
        'st.detecting': { en: 'Auto-detecting landmarks…', 'zh-CN': '正在自动定点…', 'zh-Hant': '正在自動定點…' },
        'st.badFile': { en: 'Could not read that file.', 'zh-CN': '无法读取该文件。', 'zh-Hant': '無法讀取該檔案。' },
        'st.cors': { en: 'Could not fetch the Banana film (CORS). Use Load file.', 'zh-CN': '无法读取香蕉底片（CORS）。请改用载入底片。', 'zh-Hant': '無法讀取香蕉底片（CORS）。請改用載入底片。' },
        'st.missingCat': { en: 'Missing data/isbi2015.json', 'zh-CN': '缺少 data/isbi2015.json', 'zh-Hant': '缺少 data/isbi2015.json' },
        'st.nothingUndo': { en: 'Nothing to undo.', 'zh-CN': '没有可撤销的定点。', 'zh-Hant': '沒有可撤銷的定點。' },
        'st.undid': { en: 'Undid the last point move.', 'zh-CN': '已撤销上一次定点。', 'zh-Hant': '已撤銷上一次定點。' },
        'st.saveNeed': { en: 'Adopt a set before saving a tracing.', 'zh-CN': '请先采用一组再保存描记。', 'zh-Hant': '請先採用一組再儲存描記。' },
        'st.saved': { en: 'Tracing saved for this patient ({key}). Reopen Banana Ceph analysis to restore it.', 'zh-CN': '已为该病人保存描记（{key}）。再次打开香蕉头影测量即可恢复。', 'zh-Hant': '已為該病人儲存描記（{key}）。再次開啟香蕉頭影測量即可恢復。' },
        'st.savingCloud': { en: 'Saving a film copy and study ID for this patient…', 'zh-CN': '正在为该病人保存底片副本与研究 ID…', 'zh-Hant': '正在為該病人儲存底片副本與研究 ID…' },
        'st.savedCloud': { en: 'Tracing saved as a patient ceph study (film copy + ID). Reopen Banana Ceph analysis on any clinic PC to restore it.', 'zh-CN': '描记已存为该病人头影研究（底片副本与 ID）。任意诊所电脑再次打开香蕉头影测量即可恢复。', 'zh-Hant': '描記已存為該病人頭影研究（底片副本與 ID）。任意診所電腦再次開啟香蕉頭影測量即可恢復。' },
        'st.savedLocal': { en: 'Tracing saved on this computer ({key}). Reopen this film here to restore it.', 'zh-CN': '描记已保存在这台电脑（{key}）。在此再次打开该片可恢复。', 'zh-Hant': '描記已儲存在這台電腦（{key}）。在此再次開啟該片可恢復。' },
        'st.savedNeedSql': { en: 'Tracing kept on this computer. Run xray_ceph.sql in Supabase so a film copy, save ID and tracing follow the patient.', 'zh-CN': '描记只留在这台电脑。请在 Supabase 运行 xray_ceph.sql，才会把底片副本、保存 ID 和描记跟该病人走。', 'zh-Hant': '描記只留在這台電腦。請在 Supabase 執行 xray_ceph.sql，才會把底片副本、保存 ID 和描記跟該病人走。' },
        'st.restored': { en: 'Restored the saved tracing for this patient.', 'zh-CN': '已恢复该病人保存的描记。', 'zh-Hant': '已恢復該病人儲存的描記。' },
        'st.restoredCloud': { en: 'Restored the saved tracing from this patient film.', 'zh-CN': '已从该病人底片恢复保存的描记。', 'zh-Hant': '已從該病人底片恢復儲存的描記。' },
        'st.restoredLocal': { en: 'Restored the tracing saved on this computer.', 'zh-CN': '已恢复这台电脑上保存的描记。', 'zh-Hant': '已恢復這台電腦上儲存的描記。' },
        'st.loadNone': { en: 'No saved tracing for this film.', 'zh-CN': '此片没有已保存的描记。', 'zh-Hant': '此片沒有已儲存的描記。' },
        'st.overlayOn': { en: 'Overlaid prior tracing ({n} pts) registered {mode}.', 'zh-CN': '已叠加先前描记（{n} 点），对位 {mode}。', 'zh-Hant': '已疊加先前描記（{n} 點），對位 {mode}。' },
        'st.overlayOff': { en: 'Progress overlay cleared.', 'zh-CN': '已清除疗程叠加。', 'zh-Hant': '已清除療程疊加。' },
        'st.need3': { en: 'Run Auto landmarks first, then view UNet and 1502.', 'zh-CN': '请先自动定点，再查看 UNet 与 1502。', 'zh-Hant': '請先自動定點，再查看 UNet 與 1502。' },
        'st.viewAll': { en: 'Click-view both sets first, then Adopt selection.', 'zh-CN': '请先点看这 2 组，再采用此组。', 'zh-Hant': '請先點看這 2 組，再採用此組。' },
        'st.compare': { en: 'Compare UNet and 1502, then Adopt selection.', 'zh-CN': '比较 UNet 与 1502 后采用此组。', 'zh-Hant': '比較 UNet 與 1502 後採用此組。' },
        'st.calCancel': { en: 'Calibration cancelled.', 'zh-CN': '已取消标定。', 'zh-Hant': '已取消標定。' },
        'st.calFirst': { en: 'First ruler point set. Click the other end.', 'zh-CN': '已点第一端。请点另一端。', 'zh-Hant': '已點第一端。請點另一端。' },
        'st.noExport': { en: 'Nothing to export.', 'zh-CN': '没有可导出的内容。', 'zh-Hant': '沒有可匯出的內容。' },
        'st.learnNone': { en: 'Auto-detect or adopt a set first. Training stores the whole 19-point set.', 'zh-CN': '请先自动定点或采用一组。训练保存整组 19 点。', 'zh-Hant': '請先自動定點或採用一組。訓練儲存整組 19 點。' },
        'st.learnFail': { en: 'Could not add that set.', 'zh-CN': '无法加入该组。', 'zh-Hant': '無法加入該組。' },
        'st.plusEmpty': { en: 'Published + in-house is selected, but there are no in-house films yet. Adopt a set and add it to clinic training first.', 'zh-CN': '已选公开库 + 院内，但还没有院内片。请先采用一组并加入训练。', 'zh-Hant': '已選公開庫 + 院內，但還沒有院內片。請先採用一組並加入訓練。' },
        'st.noPatient': { en: 'No Banana patient in this window', 'zh-CN': '本窗口没有香蕉病人', 'zh-Hant': '本視窗沒有香蕉病人' },
        'bar.who': { en: 'Patient', 'zh-CN': '病人', 'zh-Hant': '病人' },
        'bar.suffix': { en: 'choose Published 1502 or Published + in-house, then view UNet and 1502 and Adopt selection. Share this window in X-ray Helper to save a view.', 'zh-CN': '请选公开库 1502 或公开库 + 院内，查看 UNet 与 1502 后采用。用 X 光助手分享本窗口即可存回。', 'zh-Hant': '請選公開庫 1502 或公開庫 + 院內，查看 UNet 與 1502 後採用。用 X 光助手分享本視窗即可存回。' },
        'ex.back': { en: 'Back to tracing', 'zh-CN': '返回描记', 'zh-Hant': '返回描記' },
        'ex.print': { en: 'Print', 'zh-CN': '打印', 'zh-Hant': '列印' },
        'ex.title': { en: 'Extraction index · 拔牙倾向', 'zh-CN': '拔牙指数', 'zh-Hant': '拔牙指數' },
        'ex.lead': { en: 'Chairside reminder of what the Banana ceph score is looking at. It is a tracing vs the selected norm set — not a decision to extract.', 'zh-CN': '椅旁备忘：香蕉头影分数在看什么。这是描记相对所选常值的倾向，不是拔牙决定。', 'zh-Hant': '椅旁備忘：香蕉頭影分數在看什麼。這是描記相對所選常值的傾向，不是拔牙決定。' },
        'ex.warn': { en: 'Do not extract from this number alone. Crowding, Bolton, growth, TMJ, smile and the patient’s wish are not on the lateral film.', 'zh-CN': '不要单凭这个数字拔牙。拥挤、Bolton、生长发育、关节、微笑与病人意愿都不在这张侧位片上。', 'zh-Hant': '不要單憑這個數字拔牙。擁擠、Bolton、生長發育、關節、微笑與病人意願都不在這張側位片上。' },
        'ex.hScore': { en: 'What the score is', 'zh-CN': '分数怎么来', 'zh-Hant': '分數怎麼來' },
        'ex.scoreP': { en: 'Starts at 50 (undecided). Each measure that is 1–2 SD from the chosen HK Chinese or Caucasian mean tilts the score. 2 SD tilts more. Soft-tissue millimetres count only after the film ruler is calibrated.', 'zh-CN': '从 50（未定）起算。相对所选香港华人或白人均值偏 1–2 个标准差就加减分，偏 2 个以上加得更多。软组织毫米只在标定尺之后才计入。', 'zh-Hant': '從 50（未定）起算。相對所選香港華人或白人均值偏 1–2 個標準差就加減分，偏 2 個以上加得更多。軟組織毫米只在標定尺之後才計入。' },
        'ex.scoreHk': { en: 'Use HK Chinese (Chan 1972; Cooke & Wei 1988) for this clinic. Caucasian IMPA 90° and lips on the S-line will call many Southern Chinese faces “extract” when they are only the local norm.', 'zh-CN': '本诊所请用香港华人常值（Chan 1972；Cooke & Wei 1988）。若用白人 IMPA 90°、唇贴 S 线，许多华南面型会被误判为该拔。', 'zh-Hant': '本診所請用香港華人常值（Chan 1972；Cooke & Wei 1988）。若用白人 IMPA 90°、唇貼 S 線，許多華南面型會被誤判為該拔。' },
        'ex.hBands': { en: 'Bands', 'zh-CN': '分段', 'zh-Hant': '分段' },
        'ex.bandLow': { en: 'Low 0–34', 'zh-CN': '低 0–34', 'zh-Hant': '低 0–34' },
        'ex.bandLowD': { en: 'Keep / IPR / expansion more likely from the ceph.', 'zh-CN': '头影较支持不拔 / 邻面去釉 / 开展。', 'zh-Hant': '頭影較支持不拔 / 鄰面去釉 / 開展。' },
        'ex.bandMid': { en: 'Borderline 35–54', 'zh-CN': '交界 35–54', 'zh-Hant': '交界 35–54' },
        'ex.bandMidD': { en: 'Mixed. Models and smile decide.', 'zh-CN': '混合。模型与微笑决定。', 'zh-Hant': '混合。模型與微笑決定。' },
        'ex.bandMod': { en: 'Moderate 55–74', 'zh-CN': '中等 55–74', 'zh-Hant': '中等 55–74' },
        'ex.bandModD': { en: 'Extraction camouflage is on the table.', 'zh-CN': '可以考虑拔牙掩饰。', 'zh-Hant': '可以考慮拔牙掩飾。' },
        'ex.bandHigh': { en: 'High 75–100', 'zh-CN': '高 75–100', 'zh-Hant': '高 75–100' },
        'ex.bandHighD': { en: 'Typical bimax / convex / lip-protrusive pattern.', 'zh-CN': '典型双颌前突 / 凸面 / 唇突。', 'zh-Hant': '典型雙頜前突 / 凸面 / 唇突。' },
        'ex.hOr': { en: 'Extract or keep — from the tracing', 'zh-CN': '拔或不拔 — 只看描记', 'zh-Hant': '拔或不拔 — 只看描記' },
        'ex.leansExtract': { en: 'Leans extract · 倾向拔牙', 'zh-CN': '倾向拔牙', 'zh-Hant': '傾向拔牙' },
        'ex.leansKeep': { en: 'Leans keep · 倾向不拔', 'zh-CN': '倾向不拔', 'zh-Hant': '傾向不拔' },
        'ex.ex1': { en: 'IMPA high — lower incisors already proclined; little room to unravel crowding without making the lip worse.', 'zh-CN': 'IMPA 偏高 — 下切牙已唇倾；再排齐拥挤容易让唇更突。', 'zh-Hant': 'IMPA 偏高 — 下切牙已唇傾；再排齊擁擠容易讓唇更突。' },
        'ex.ex2': { en: 'Interincisal acute — bimaxillary protrusion (common in HK).', 'zh-CN': '上下切牙角过锐 — 双颌前突（香港常见）。', 'zh-Hant': '上下切牙角過銳 — 雙頜前突（香港常見）。' },
        'ex.ex3': { en: 'FMIA low — Tweed: lower incisor too proclined relative to Frankfort.', 'zh-CN': 'FMIA 偏低 — Tweed：下切牙相对眶耳平面过唇倾。', 'zh-Hant': 'FMIA 偏低 — Tweed：下切牙相對眶耳平面過唇傾。' },
        'ex.ex4': { en: 'Convex profile — A-point ahead of N–Pog; retraction can flatten the face.', 'zh-CN': '凸面型 — A 点在 N–Pog 之前；内收可改善侧貌。', 'zh-Hant': '凸面型 — A 點在 N–Pog 之前；內收可改善側貌。' },
        'ex.ex5': { en: 'Lips ahead of Steiner S-line (Ls / Li to Sn–Pog′) — after calibration.', 'zh-CN': '唇在 Steiner S 线之前（标定后才计毫米）。', 'zh-Hant': '唇在 Steiner S 線之前（標定後才計毫米）。' },
        'ex.ex6': { en: 'Class II ANB / Wits — scored as upper-arch camouflage (premolars more often than four premolars).', 'zh-CN': 'II 类 ANB / Wits — 计为上颌掩饰（以上前磨牙为多，不是自动拔四颗）。', 'zh-Hant': 'II 類 ANB / Wits — 計為上頜掩飾（以上前磨牙為多，不是自動拔四顆）。' },
        'ex.k1': { en: 'IMPA low / retroclined — further retraction dumps the incisors and hollows the lip.', 'zh-CN': 'IMPA 偏低 / 舌倾 — 再内收会使切牙更倒、唇凹陷。', 'zh-Hant': 'IMPA 偏低 / 舌傾 — 再內收會使切牙更倒、唇凹陷。' },
        'ex.k2': { en: 'Interincisal obtuse — not a bimax face.', 'zh-CN': '上下切牙角过钝 — 不是双突面型。', 'zh-Hant': '上下切牙角過鈍 — 不是雙突面型。' },
        'ex.k3': { en: 'FMIA high — Tweed already “upright”.', 'zh-CN': 'FMIA 偏高 — Tweed 已偏直立。', 'zh-Hant': 'FMIA 偏高 — Tweed 已偏直立。' },
        'ex.k4': { en: 'Concave profile / strong chin — extraction can make the face dish-in.', 'zh-CN': '凹面 / 颏强 — 拔牙可能让面中份更凹。', 'zh-Hant': '凹面 / 頦強 — 拔牙可能讓面中份更凹。' },
        'ex.k5': { en: 'Retrusive lips on the S-line — do not retract for “numbers”.', 'zh-CN': 'S 线上唇后缩 — 不要为了数字再内收。', 'zh-Hant': 'S 線上唇後縮 — 不要為了數字再內收。' },
        'ex.k6': { en: 'High-angle (SN–GoGn out) — small penalty: retraction needs vertical control; not an automatic extract.', 'zh-CN': '高角（SN–GoGn 超标）— 只扣一点：内收需控制垂直向，不是自动该拔。', 'zh-Hant': '高角（SN–GoGn 超標）— 只扣一點：內收需控制垂直向，不是自動該拔。' },
        'ex.hClass': { en: 'Class II vs Class III — not the same extraction', 'zh-CN': 'II 类与 III 类 — 不是同一种拔牙', 'zh-Hant': 'II 類與 III 類 — 不是同一種拔牙' },
        'ex.c2': { en: 'Class II adds to the score as upper-arch camouflage. Typical pattern is upper premolars (sometimes two uppers only), not automatic 14-24-34-44.', 'zh-CN': 'II 类加分视为上颌掩饰。常见是上前磨牙（有时只拔两颗上），不是自动 14-24-34-44。', 'zh-Hant': 'II 類加分視為上頜掩飾。常見是上前磨牙（有時只拔兩顆上），不是自動 14-24-34-44。' },
        'ex.c3': { en: 'Class III is not added as a 4-premolar extract. The hint says lower-arch camouflage or surgery. Retroclined lower incisors in Class III usually argue against more lower retraction.', 'zh-CN': 'III 类不加成分去拔四颗前磨牙。提示为下颌掩饰或手术。III 类下切牙已舌倾时，通常不宜再下颌内收。', 'zh-Hant': 'III 類不加成分去拔四顆前磨牙。提示為下頜掩飾或手術。III 類下切牙已舌傾時，通常不宜再下頜內收。' },
        'ex.hTable': { en: 'Measures the index actually uses', 'zh-CN': '指数实际用到的项目', 'zh-Hant': '指數實際用到的項目' },
        'ex.thM': { en: 'Measure', 'zh-CN': '项目', 'zh-Hant': '項目' },
        'ex.thE': { en: 'Extract if…', 'zh-CN': '偏拔若…', 'zh-Hant': '偏拔若…' },
        'ex.thK': { en: 'Keep if…', 'zh-CN': '偏留若…', 'zh-Hant': '偏留若…' },
        'ex.thN': { en: 'Notes', 'zh-CN': '说明', 'zh-Hant': '說明' },
        'ex.hMiss': { en: 'What is missing (so the index stays humble)', 'zh-CN': '片上看不到的（所以指数要谦虚）', 'zh-Hant': '片上看不到的（所以指數要謙虛）' },
        'ex.m1': { en: 'Arch-length discrepancy / crowding / spacing', 'zh-CN': '牙弓长度不调 / 拥挤 / 间隙', 'zh-Hant': '牙弓長度不調 / 擁擠 / 間隙' },
        'ex.m2': { en: 'Bolton, tooth-size, unerupted 8s', 'zh-CN': 'Bolton、牙量、未萌智齿', 'zh-Hant': 'Bolton、牙量、未萌智齒' },
        'ex.m3': { en: 'Growth remaining, FMA vs age, airway / tonsils', 'zh-CN': '剩余生长、FMA 与年龄、气道 / 扁桃体', 'zh-Hant': '剩餘生長、FMA 與年齡、氣道 / 扁桃體' },
        'ex.m4': { en: 'TMJ, periodontal support, restorations, missing teeth', 'zh-CN': '关节、牙周、修复体、缺牙', 'zh-Hant': '關節、牙周、修復體、缺牙' },
        'ex.m5': { en: 'Smile arc, gingival display, nasolabial angle on the photo', 'zh-CN': '微笑弧、露龈、照片上的鼻唇角', 'zh-Hant': '微笑弧、露齦、照片上的鼻唇角' },
        'ex.trust': { en: 'If those conflict with a High score, trust the mouth and the face, not the chip.', 'zh-CN': '若这些与「高」分冲突，请信口内与面型，不要信这一格。', 'zh-Hant': '若這些與「高」分衝突，請信口內與面型，不要信這一格。' },
        'ex.backOther': { en: 'Close this tab. The film is still on the tracing window.', 'zh-CN': '请关掉此页。底片仍在描记窗口。', 'zh-Hant': '請關掉此頁。底片仍在描記視窗。' },
        'ex.backAlone': { en: 'This notes page was opened on its own, so there is no film to restore. Go back to Banana Ceph analysis and load the tracing again.', 'zh-CN': '说明页是单独打开的，没有底片可恢复。请回到香蕉头影测量再载入描记。', 'zh-Hant': '說明頁是單獨開啟的，沒有底片可恢復。請回到香蕉頭影測量再載入描記。' },
        'st.norms': { en: 'Norms: {label}. Green = within 1 SD, amber = 1–2 SD, red = beyond.', 'zh-CN': '常值：{label}。绿＝1 个标准差内，黄＝1–2 个，红＝以外。', 'zh-Hant': '常值：{label}。綠＝1 個標準差內，黃＝1–2 個，紅＝以外。' },
        'st.plusRef': { en: 'Reference: 1502 published PLUS {n} in-house training film(s). Libraries stay separate.', 'zh-CN': '参考：1502 公开库 + {n} 张院内训练片。两库分开。', 'zh-Hant': '參考：1502 公開庫 + {n} 張院內訓練片。兩庫分開。' },
        'st.pubOnly': { en: 'Reference: published 1502 library only. In-house training is stored but not used.', 'zh-CN': '参考：只用 1502 公开库。院内训练已存但不使用。', 'zh-Hant': '參考：只用 1502 公開庫。院內訓練已存但不使用。' },
        'st.viewAdopt': { en: 'Viewing set {n} · {label}. Click Adopt selection to keep it.', 'zh-CN': '正在看第 {n} 组 · {label}。点采用此组以保留。', 'zh-Hant': '正在看第 {n} 組 · {label}。點採用此組以保留。' },
        'st.viewOther': { en: 'Viewing set {n} · {label}. Click the other sets first.', 'zh-CN': '正在看第 {n} 组 · {label}。请先点其他组。', 'zh-Hant': '正在看第 {n} 組 · {label}。請先點其他組。' },
        'st.adopted': { en: 'Adopted set {n} · {label}. Selection bar hidden so the film is clear.', 'zh-CN': '已采用第 {n} 组 · {label}。选择条已收起，以免挡住底片。', 'zh-Hant': '已採用第 {n} 組 · {label}。選擇條已收起，以免擋住底片。' },
        'st.refClinic': { en: 'Reference: 1502 published + {n} in-house film(s). Viewing set {i} · {label}. Compare UNet and 1502, then Adopt selection.', 'zh-CN': '参考：1502 公开 + {n} 张院内。正在看第 {i} 组 · {label}。比较 UNet 与 1502 后采用。', 'zh-Hant': '參考：1502 公開 + {n} 張院內。正在看第 {i} 組 · {label}。比較 UNet 與 1502 後採用。' },
        'st.threeReady': { en: '2 auto-detect sets ready. Viewing set {n} · {label}. Compare UNet and 1502, then Adopt selection.', 'zh-CN': '2 组自动定点已就绪。正在看第 {n} 组 · {label}。比较 UNet 与 1502 后采用。', 'zh-Hant': '2 組自動定點已就緒。正在看第 {n} 組 · {label}。比較 UNet 與 1502 後採用。' },
        'st.threeLocal': { en: 'UNet unavailable — 1502 library average is ready. Viewing set {n} · {label}. Compare both sets, then Adopt selection.', 'zh-CN': 'UNet 不可用 — 1502 库平均已就绪。正在看第 {n} 组 · {label}。比较两组后采用。', 'zh-Hant': 'UNet 不可用 — 1502 庫平均已就緒。正在看第 {n} 組 · {label}。比較兩組後採用。' },
        'st.twoReady': { en: '2 auto-detect sets ready. Viewing {label} (default UNet). Compare with 1502, then Adopt selection.', 'zh-CN': '2 组自动定点已就绪。正在看 {label}（默认 UNet）。与 1502 比较后采用。', 'zh-Hant': '2 組自動定點已就緒。正在看 {label}（預設 UNet）。與 1502 比較後採用。' },
        'st.twoLocal': { en: 'UNet unavailable — showing the 1502 library average. Compare both sets, then Adopt selection.', 'zh-CN': 'UNet 不可用 — 显示 1502 库平均。比较两组后采用。', 'zh-Hant': 'UNet 不可用 — 顯示 1502 庫平均。比較兩組後採用。' },
        'st.calOk': { en: 'Calibrated: {mm} mm = {px} px → {scale} mm/px. Linear measures are now in millimetres.', 'zh-CN': '已标定：{mm} mm = {px} px → {scale} mm/px。线性项目现为毫米。', 'zh-Hant': '已標定：{mm} mm = {px} px → {scale} mm/px。線性項目現為毫米。' },
        'st.calStart': { en: 'Calibration: click two ends of a {mm} mm marker on the film.', 'zh-CN': '标定：在底片 {mm} mm 标记两端各点一下。', 'zh-Hant': '標定：在底片 {mm} mm 標記兩端各點一下。' },
        'st.manualScale': { en: 'Manual scale {n} mm/px. Linear measures use this value.', 'zh-CN': '手动比例 {n} mm/px。线性项目用此值。', 'zh-Hant': '手動比例 {n} mm/px。線性項目用此值。' },
        'st.learnAdded': { en: 'Added the whole adopted set ({n} landmarks{label}) to clinic training ({films} film(s)). The 1502 published tracings stay unchanged.', 'zh-CN': '已将采用组整组（{n} 点{label}）加入院内训练（{films} 张）。1502 公开库不变。', 'zh-Hant': '已將採用組整組（{n} 點{label}）加入院內訓練（{films} 張）。1502 公開庫不變。' },
        'st.learnUndo': { en: 'Removed the last clinic training film. Now {n} film(s). Published 1502 unchanged.', 'zh-CN': '已去掉最近一张院内训练片。现为 {n} 张。1502 公开库不变。', 'zh-Hant': '已去掉最近一張院內訓練片。現為 {n} 張。1502 公開庫不變。' },
        'cap.still': { en: 'View {left} still, then Adopt.', 'zh-CN': '还需查看 {left}，再采用。', 'zh-Hant': '還需查看 {left}，再採用。' },
        'cap.ready': { en: '{n} · {label} — Adopt to keep.', 'zh-CN': '{n} · {label} — 采用以保留。', 'zh-Hant': '{n} · {label} — 採用以保留。' },
        'learn.line': { en: '{n} whole set(s), {p} points. Reference: {ref}. Never mixed into the 1502 library.', 'zh-CN': '{n} 整组，{p} 点。参考：{ref}。绝不混入 1502 库。', 'zh-Hant': '{n} 整組，{p} 點。參考：{ref}。絕不混入 1502 庫。' },
        'learn.plus': { en: '1502 + in-house', 'zh-CN': '1502 + 院内', 'zh-Hant': '1502 + 院內' },
        'learn.pub': { en: 'published 1502 only', 'zh-CN': '仅公开库 1502', 'zh-Hant': '僅公開庫 1502' },
        'note.not calibrated': { en: 'not calibrated', 'zh-CN': '未标定', 'zh-Hant': '未標定' },
        'note.on FOP': { en: 'on FOP', 'zh-CN': '在功能𬌗平面上', 'zh-Hant': '在功能咬合平面上' },
        'note.N-perp to FH': { en: 'N-perp to FH', 'zh-CN': 'N-perp 垂直于眶耳平面', 'zh-Hant': 'N-perp 垂直於眶耳平面' },
        'note.50 undecided': { en: '50 undecided', 'zh-CN': '50 未定', 'zh-Hant': '50 未定' },
        'ph.skeletal Class I': { en: 'skeletal Class I', 'zh-CN': '骨性 I 类', 'zh-Hant': '骨性 I 類' },
        'ph.skeletal Class II tendency': { en: 'skeletal Class II tendency', 'zh-CN': '骨性 II 类倾向', 'zh-Hant': '骨性 II 類傾向' },
        'ph.skeletal Class III tendency': { en: 'skeletal Class III tendency', 'zh-CN': '骨性 III 类倾向', 'zh-Hant': '骨性 III 類傾向' },
        'why.proclined lower incisors (IMPA)': { en: 'proclined lower incisors (IMPA)', 'zh-CN': '下切牙唇倾（IMPA）', 'zh-Hant': '下切牙唇傾（IMPA）' },
        'why.retroclined lower incisors': { en: 'retroclined lower incisors', 'zh-CN': '下切牙舌倾', 'zh-Hant': '下切牙舌傾' },
        'why.acute interincisal (bimax)': { en: 'acute interincisal (bimax)', 'zh-CN': '切牙角过锐（双突）', 'zh-Hant': '切牙角過銳（雙突）' },
        'why.obtuse interincisal': { en: 'obtuse interincisal', 'zh-CN': '切牙角过钝', 'zh-Hant': '切牙角過鈍' },
        'why.convex profile': { en: 'convex profile', 'zh-CN': '凸面型', 'zh-Hant': '凸面型' },
        'why.concave profile': { en: 'concave profile', 'zh-CN': '凹面型', 'zh-Hant': '凹面型' },
        'why.low FMIA (Tweed)': { en: 'low FMIA (Tweed)', 'zh-CN': 'FMIA 偏低（Tweed）', 'zh-Hant': 'FMIA 偏低（Tweed）' },
        'why.high FMIA': { en: 'high FMIA', 'zh-CN': 'FMIA 偏高', 'zh-Hant': 'FMIA 偏高' },
        'why.upper lip ahead of S-line': { en: 'upper lip ahead of S-line', 'zh-CN': '上唇在 S 线前', 'zh-Hant': '上唇在 S 線前' },
        'why.retrusive upper lip': { en: 'retrusive upper lip', 'zh-CN': '上唇后缩', 'zh-Hant': '上唇後縮' },
        'why.lower lip ahead of S-line': { en: 'lower lip ahead of S-line', 'zh-CN': '下唇在 S 线前', 'zh-Hant': '下唇在 S 線前' },
        'why.retrusive lower lip': { en: 'retrusive lower lip', 'zh-CN': '下唇后缩', 'zh-Hant': '下唇後縮' },
        'why.Class II skeletal (upper-arch camouflage)': { en: 'Class II skeletal (upper-arch camouflage)', 'zh-CN': '骨性 II 类（上颌掩饰）', 'zh-Hant': '骨性 II 類（上頜掩飾）' },
        'why.Class III skeletal (not scored as 4-premolar extraction)': { en: 'Class III skeletal (not scored as 4-premolar extraction)', 'zh-CN': '骨性 III 类（不计为拔四颗前磨牙）', 'zh-Hant': '骨性 III 類（不計為拔四顆前磨牙）' },
        'why.Wits Class II': { en: 'Wits Class II', 'zh-CN': 'Wits II 类', 'zh-Hant': 'Wits II 類' },
        'why.high-angle: retract with vertical control': { en: 'high-angle: retract with vertical control', 'zh-CN': '高角：内收须控制垂直向', 'zh-Hant': '高角：內收須控制垂直向' },
        'why.angles near this norm set': { en: 'angles near this norm set', 'zh-CN': '角度接近本常值组', 'zh-Hant': '角度接近本常值組' },
        'note.proxy U1-L1 (drag FopA / FopP)': { en: 'proxy U1-L1 (drag FopA / FopP)', 'zh-CN': '暂用 U1-L1（请拖 FopA / FopP）', 'zh-Hant': '暫用 U1-L1（請拖 FopA / FopP）' },
        'note.Steiner S-line (Sn–Pog′)': { en: 'Steiner S-line (Sn–Pog′)', 'zh-CN': 'Steiner S 线（Sn–Pog′）', 'zh-Hant': 'Steiner S 線（Sn–Pog′）' },
        'note.approx (drag U1a / L1a)': { en: 'approx (drag U1a / L1a)', 'zh-CN': '近似（请拖 U1a / L1a）', 'zh-Hant': '近似（請拖 U1a / L1a）' },
        'note.U1a-U1 / L1a-L1': { en: 'U1a-U1 / L1a-L1', 'zh-CN': 'U1a-U1 / L1a-L1', 'zh-Hant': 'U1a-U1 / L1a-L1' },
        'note.L1–L1a vs MP': { en: 'L1–L1a vs MP', 'zh-CN': 'L1–L1a 对下颌平面', 'zh-Hant': 'L1–L1a 對下頜平面' },
        'note.L1–L1a vs FH': { en: 'L1–L1a vs FH', 'zh-CN': 'L1–L1a 对眶耳平面', 'zh-Hant': 'L1–L1a 對眶耳平面' },
        'note.approx (drag L1a)': { en: 'approx (drag L1a)', 'zh-CN': '近似（请拖 L1a）', 'zh-Hant': '近似（請拖 L1a）' },
        'bar.line': { en: 'Banana cephalometric sidecar — {who} — choose Published 1502 or Published + in-house, then view UNet and 1502 and Adopt selection. Share this window in X-ray Helper to save a view.', 'zh-CN': '香蕉头影侧窗 — {who} — 请选公开库 1502 或公开库 + 院内，查看 UNet 与 1502 后采用。用 X 光助手分享本窗口即可存回。', 'zh-Hant': '香蕉頭影側窗 — {who} — 請選公開庫 1502 或公開庫 + 院內，查看 UNet 與 1502 後採用。用 X 光助手分享本視窗即可存回。' },
        'ex.tIMPA_e': { en: 'High vs norm', 'zh-CN': '相对常值偏高', 'zh-Hant': '相對常值偏高' },
        'ex.tIMPA_k': { en: 'Low / retroclined', 'zh-CN': '偏低 / 舌倾', 'zh-Hant': '偏低 / 舌傾' },
        'ex.tFMIA_e': { en: 'Low (Tweed)', 'zh-CN': '偏低（Tweed）', 'zh-Hant': '偏低（Tweed）' },
        'ex.tFMIA_k': { en: 'High', 'zh-CN': '偏高', 'zh-Hant': '偏高' },
        'ex.tII_e': { en: 'Acute (bimax)', 'zh-CN': '过锐（双突）', 'zh-Hant': '過銳（雙突）' },
        'ex.tII_k': { en: 'Obtuse', 'zh-CN': '过钝', 'zh-Hant': '過鈍' },
        'ex.tConv_e': { en: 'Convex', 'zh-CN': '凸面', 'zh-Hant': '凸面' },
        'ex.tConv_k': { en: 'Concave', 'zh-CN': '凹面', 'zh-Hant': '凹面' },
        'ex.tLip_e': { en: 'Lips ahead', 'zh-CN': '唇在前', 'zh-Hant': '唇在前' },
        'ex.tLip_k': { en: 'Lips retrusive', 'zh-CN': '唇后缩', 'zh-Hant': '唇後縮' },
        'ex.tANB_e': { en: 'Class II', 'zh-CN': 'II 类', 'zh-Hant': 'II 類' },
        'ex.tANB_k': { en: 'Class I', 'zh-CN': 'I 类', 'zh-Hant': 'I 類' },
        'ex.tANB_n': { en: 'Class III ≠ 4s', 'zh-CN': 'III 类 ≠ 拔四颗', 'zh-Hant': 'III 類 ≠ 拔四顆' },
        'ex.tWits_e': { en: 'Class II', 'zh-CN': 'II 类', 'zh-Hant': 'II 類' },
        'ex.tWits_k': { en: '—', 'zh-CN': '—', 'zh-Hant': '—' },
        'ex.tGo_e': { en: '—', 'zh-CN': '—', 'zh-Hant': '—' },
        'ex.tGo_k': { en: 'High-angle −4', 'zh-CN': '高角 −4', 'zh-Hant': '高角 −4' },
        'ex.tGo_n': { en: 'vertical', 'zh-CN': '垂直向', 'zh-Hant': '垂直向' },
        'ex.tMm': { en: 'mm', 'zh-CN': '毫米', 'zh-Hant': '毫米' }
    };

    function norm(raw) {
        var s = String(raw || '').trim();
        if (s === 'zh' || s === 'zh-CN' || s === 'zh-cn' || s === 'cn') return 'zh-CN';
        if (s === 'zh-Hant' || s === 'zh-TW' || s === 'zh-HK' || s === 'zh-hant' || s === 'tw') return 'zh-Hant';
        if (s === 'en' || s === 'en-US' || s === 'en-GB') return 'en';
        return 'en';
    }
    function read() {
        try { lang = norm(localStorage.getItem(KEY)); } catch (e) { lang = 'en'; }
        return lang;
    }
    function write(next) {
        lang = norm(next);
        try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
        return lang;
    }
    function t(key, vars) {
        var row = STR[key];
        var s = row ? (row[lang] || row.en || key) : key;
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                s = String(s).split('{' + k + '}').join(String(vars[k]));
            });
        }
        return s;
    }
    function phrase(en) {
        if (en == null || en === '') return '';
        var k = 'ph.' + en;
        if (STR[k]) return t(k);
        k = 'note.' + en;
        if (STR[k]) return t(k);
        k = 'why.' + en;
        if (STR[k]) return t(k);
        k = 'hint.' + en;
        if (STR[k]) return t(k);
        return String(en);
    }
    function fill(root) {
        root = root || document;
        var nodes = root.querySelectorAll('[data-i18n]');
        var i, el, key;
        for (i = 0; i < nodes.length; i++) {
            el = nodes[i];
            key = el.getAttribute('data-i18n');
            if (key) el.textContent = t(key);
        }
        nodes = root.querySelectorAll('[data-i18n-title]');
        for (i = 0; i < nodes.length; i++) {
            el = nodes[i];
            key = el.getAttribute('data-i18n-title');
            if (key) el.setAttribute('title', t(key));
        }
        nodes = root.querySelectorAll('[data-i18n-aria]');
        for (i = 0; i < nodes.length; i++) {
            el = nodes[i];
            key = el.getAttribute('data-i18n-aria');
            if (key) el.setAttribute('aria-label', t(key));
        }
        if (document.title === '' || /Banana|香蕉|Ceph|头影|頭影/.test(document.title)) {
            var brand = document.querySelector('[data-i18n="ui.brand"]');
            if (brand) document.title = t('ui.title');
            if (/extraction/i.test(location.pathname || '')) document.title = t('ex.title');
        }
        var html = document.documentElement;
        if (html) html.setAttribute('lang', lang);
        var btns = root.querySelectorAll('.lang-toggle-btn');
        for (i = 0; i < btns.length; i++) {
            var on = norm(btns[i].getAttribute('data-lang')) === lang;
            btns[i].classList.toggle('active', on);
            btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }
    function apply() {
        fill(document);
        if (typeof onLang === 'function') onLang(lang);
    }
    function setLang(next) {
        write(next);
        apply();
        return lang;
    }
    function boot(opts) {
        opts = opts || {};
        onLang = opts.onLang || onLang;
        read();
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest && e.target.closest('.lang-toggle-btn');
            if (!btn) return;
            e.preventDefault();
            setLang(btn.getAttribute('data-lang'));
        });
        window.addEventListener('storage', function (e) {
            if (e.key !== KEY) return;
            read();
            apply();
        });
        apply();
        return lang;
    }

    g.CEPH_I18N = {
        KEY: KEY,
        t: t,
        phrase: phrase,
        lang: function () { return lang; },
        read: read,
        setLang: setLang,
        apply: apply,
        fill: fill,
        boot: boot,
        norm: norm
    };
})(typeof window !== 'undefined' ? window : this);
