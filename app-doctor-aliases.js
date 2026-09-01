/**
 * Report-side doctor identity: confirmed name groups only.
 * Short surnames that could be several people stay on their own line,
 * except Ng — clinic bills use "Dr NG" for Dr Ng Pui Ching (Michael).
 */
var DoctorAliases = (function () {
    var SHORT_LABELS = {
        chan: 'DR. CHAN',
        wong: 'DR. WONG',
        'wong qb': 'DR. WONG QB',
        lam: 'DR. LAM',
        lee: 'DR. LEE',
        yeung: 'DR. YEUNG',
        lai: 'DR. LAI'
    };

    var GROUPS = [
        {
            key: 'ng-pui-ching',
            label: 'Dr Ng Pui Ching',
            aliases: [
                'NG', 'Dr NG', 'DR NG', 'DR. NG', 'DR.NG', 'Dr. NG', 'Dr. Ng',
                'Ng Pui Ching', 'Dr Ng Pui Ching', 'DR NG PUI CHING', 'DR. NG PUI CHING',
                'DR.NG PUI CHING', 'NG Pui Ching', 'Ng Pui-Ching',
                'Michael NG', 'Michael Ng', 'Dr Michael NG', 'Dr Michael Ng',
                'DR MICHAEL NG', 'DR. MICHAEL NG', 'DR.MICHAEL NG',
                '[Dr Michael NG] Dr Ng Pui Ching',
                '[Dr NG] Dr Ng Pui Ching',
                '[Dr NG PUI CHING] DR NG PUI CHING',
                '吳培精', '吳培精牙科醫生'
            ]
        },
        {
            key: 'annette-ng',
            label: 'Dr Annette Ng Si Ki',
            aliases: ['DR. ANNETTE NG', 'DR. NG SI KI ANNETTE', 'Annette Ng', 'Ng Si Ki Annette']
        },
        {
            key: 'rachel-ng',
            label: 'Dr Rachel Ng',
            aliases: ['DR.RACHEL NG', 'DR. RACHEL NG', 'Rachel Ng']
        },
        {
            key: 'albert-ho',
            label: 'Dr Albert Ho Shing Kit',
            aliases: ['DR ALBERT HO', 'DR. HO SHING KIT, ALBERT', 'Albert Ho', 'Ho Shing Kit Albert']
        },
        {
            key: 'irene-au-yeung',
            label: 'Dr Irene Au-Yeung Yuen Kwan',
            aliases: [
                'DR AU YEUNG YUEN KWAN IRENE',
                'Dr Au-Yeung Yuen Kwan,Irene',
                'DR. AU YEUNG',
                'DR. IRENE AU-YEUNG',
                'DR.AU-YEUNG',
                'Irene Au-Yeung',
                'Au Yeung Yuen Kwan Irene',
                '歐陽婉筠', '歐陽婉筠牙科醫生'
            ]
        },
        {
            key: 'cheung-hung-yan',
            label: 'Dr Cheung Hung Yan (Aubrey)',
            aliases: [
                'Dr Cheung Hung Yan', 'DR CHEUNG HUNG YAN', 'DR. AUBREY CHEUNG',
                'Aubrey Cheung', 'Cheung Hung Yan',
                '張鴻欣', '張鴻欣牙科醫生'
            ]
        },
        {
            key: 'elaine-lo',
            label: 'Dr Elaine Lo',
            aliases: ['DR ELAINE', 'DR ELAINE LO', 'Elaine Lo', 'Elaine']
        },
        {
            key: 'ellen-hung',
            label: 'Dr Ellen Hung',
            aliases: ['DR ELLEN HUNG', 'DR.HUNG', 'DR. HUNG', 'Ellen Hung']
        },
        {
            key: 'elvin-yip',
            label: 'Dr Elvin Yip',
            aliases: ['DR ELVIN YIP', 'DR. ELVIN YIP', 'Elvin Yip']
        },
        {
            key: 'henry-chiu',
            label: 'Dr Henry Chiu Tsz Hang',
            aliases: [
                'DR HENRY CHIU', 'DR. CHIU TSZ HANG, HENRY',
                'Henry Chiu', 'Chiu Tsz Hang Henry'
            ]
        },
        {
            key: 'joseph-lam',
            label: 'Dr Joseph Lam Kam Yui',
            aliases: [
                'DR JOSEPH LAM', 'DR. JOSEPH LAM', 'DR.JOSEPH LAM',
                'Joseph Lam', 'Dr Lam Kam Yui', 'Lam Kam Yui',
                '林錦銳', '林錦銳牙科醫生'
            ]
        },
        {
            key: 'michael-lam',
            label: 'Dr Michael Lam Chun Mo',
            aliases: [
                'DR. MICHAEL LAM', 'Michael Lam', 'Dr Lam Chun Mo', 'Lam Chun Mo',
                '林俊武', '林俊武牙科醫生'
            ]
        },
        {
            key: 'lee-yan-yan',
            label: 'Dr Lee Yan Yan',
            aliases: ['DR LEE YAN YAN', 'Lee Yan Yan', '李恩恩', '李恩恩牙科醫生']
        },
        {
            key: 'leung-ling-wai',
            label: 'Dr Leung Ling Wai (Cindy)',
            aliases: [
                'DR LEUNG LING WAI', 'DR. CINDY LEUNG', 'Cindy Leung', 'Leung Ling Wai',
                '梁淩慧', '梁淩慧牙科醫生'
            ]
        },
        {
            key: 'maggie-chan',
            label: 'Dr Maggie Chan Yuk Ching',
            aliases: [
                'Dr Maggie Chan Yuk Ching', 'DR. MAGGIE CHAN Y. C.',
                'Maggie Chan Yuk Ching', 'Maggie Chan Y C',
                '陳煜晴', '陳煜晴牙科醫生'
            ]
        },
        {
            key: 'parco-poon',
            label: 'Dr Parco Poon',
            aliases: ['DR PARCO POON', 'DR.PARCO POON', 'DR. POON', 'DR.POON', 'Parco Poon']
        },
        {
            key: 'stephanie-lee',
            label: 'Dr Stephanie Lee',
            aliases: ['DR STEPHANIE', 'DR. STEPHANIE LEE', 'Stephanie Lee', 'Stephanie']
        },
        {
            key: 'tam-jee-yan',
            label: 'Dr Tam Jee Yan',
            aliases: ['DR TAM JEE YAN', 'DR. TAM', 'DR.TAM', 'Tam Jee Yan', '譚智恩', '譚智恩牙科醫生']
        },
        {
            key: 'wesley-suen',
            label: 'Dr Wesley K.S. Suen',
            aliases: ['DR WESLEY K.S. SUEN', 'DR. SUEN', 'DR.SUEN', 'Wesley K.S. Suen', 'Wesley Suen']
        },
        {
            key: 'wong-ying-ying',
            label: 'Dr Wong Ying Ying',
            aliases: ['DR WONG YING YING', 'Wong Ying Ying', '王盈盈', '王盈盈牙科醫生']
        },
        {
            key: 'christy-loi',
            label: 'Dr Christy Loi Kei Yin',
            aliases: [
                'DR. CHRISTY LOI', 'DR. LOI KEI YIN CHRISTY', 'DR.LOI', 'DR. LOI',
                'Christy Loi', 'Loi Kei Yin Christy',
                '呂佳穎', '呂佳穎牙科醫生'
            ]
        },
        {
            key: 'karen-lai',
            label: 'Dr Karen K.Y. Lai',
            aliases: ['DR. KAREN KY LAI', 'DR.KAREN LAI', 'DR. KAREN LAI', 'Karen KY Lai', 'Karen Lai']
        },
        {
            key: 'julie-kung',
            label: 'Dr Julie Kung Choi Ka',
            aliases: ['DR. KUNG CHOI KA, JULIE', 'DR.KUNG', 'DR. KUNG', 'Julie Kung', 'Kung Choi Ka Julie']
        },
        {
            key: 'ling-wang',
            label: 'Dr Ling Wang',
            aliases: ['DR. LING WANG', 'DR.LING WANG', 'DR.WANG', 'DR. WANG', 'Ling Wang']
        },
        {
            key: 'samson-wong',
            label: 'Dr Samson Wong',
            aliases: ['DR. SAMSON WONG', 'DR.SAMSON WONG', 'Samson Wong', '黃霆森', '黃霆森牙科醫生']
        },
        {
            key: 'sheldon-chan',
            label: 'Dr Sheldon Chan',
            aliases: ['DR.SHELDON CHAN', 'DR.SHELDON  CHAN', 'DR. SHELDON CHAN', 'Sheldon Chan']
        },
        {
            key: 'susan-lau',
            label: 'Dr Susan Lau',
            aliases: ['DR.LAU SUSAN', 'DR.LAU', 'DR. LAU', 'DR. LAU SUSAN', 'Susan Lau']
        },
        {
            key: 'wong-kin',
            label: 'Dr Wong Kin',
            aliases: [
                'DR.WONG KIN', 'DR. WONG KIN', 'Wong Kin', '黃建', '黃建牙科醫生',
                'DR. JASON WONG', 'DR.JASON WONG', 'Jason Wong'
            ]
        },
        {
            key: 'woo-ho-yin',
            label: 'Dr Woo Ho Yin (Chris)',
            aliases: [
                'DR WOO HO YIN', 'DR.CHRIS WOO', 'DR. CHRIS WOO',
                'Woo Ho Yin', 'Chris Woo',
                '吳浩賢', '吳浩賢牙科醫生'
            ]
        },
        {
            key: 'crystal-zhang',
            label: 'Dr Crystal Zhang',
            aliases: ['DR.CRYSTAL ZHANG', 'DR. CRYSTAL ZHANG', 'Crystal Zhang', '張樂怡', '張樂怡牙科醫生']
        },
        {
            key: 'jasmine-yeung',
            label: 'Dr Yeung Chak Yan (Jasmine)',
            aliases: [
                'Dr Yeung Chak Yan', 'Yeung Chak Yan', 'Jasmine Yeung',
                '楊澤茵', '楊澤茵牙科醫生'
            ]
        },
        {
            key: 'ruby-yeung',
            label: 'Dr Ruby Yeung',
            aliases: ['DR. RUBY YEUNG', 'DR.RUBY YEUNG', 'Ruby Yeung']
        },
        {
            key: 'mak-wing-wa',
            label: 'Dr Mak Wing Wa',
            aliases: ['DR. MAK WING WA', 'Mak Wing Wa']
        },
        {
            key: 'dorothy-mak',
            label: 'Dr Dorothy Mak Yee Ki',
            aliases: [
                'Dr Mak Yee Ki', 'Dr Dorothy Mak', 'Dorothy Mak', 'Mak Yee Ki',
                '麥倚祈', '麥倚祈牙科醫生'
            ]
        }
    ];

    var aliasToGroup = {};

    function cleanName(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return '';
        s = s.replace(/^\[[^\]]*\]\s*/g, '');
        s = s.replace(/^\[[^\]]*\]\s*/g, '');
        s = s.replace(/牙科醫生\s*$/g, '');
        s = s.replace(/醫生\s*$/g, '');
        s = s.replace(/^dr\.?\s+/i, '');
        s = s.replace(/\s+dr\.?\s+/gi, ' ');
        s = s.toLowerCase();
        s = s.replace(/[,.;:'’"]/g, ' ');
        s = s.replace(/[-–—]/g, ' ');
        s = s.replace(/\s+/g, ' ').trim();
        s = s.replace(/^dr\s+/, '');
        s = s.replace(/^dr$/, '');
        return s;
    }

    GROUPS.forEach(function (g) {
        var list = (g.aliases || []).concat([g.label]);
        list.forEach(function (alias) {
            var c = cleanName(alias);
            if (c) aliasToGroup[c] = g;
        });
    });

    function resolveFromTexts(texts) {
        var shortHit = null;
        var groupHit = null;
        var looseHit = null;
        (texts || []).forEach(function (raw) {
            var original = String(raw == null ? '' : raw).trim();
            var cleaned = cleanName(original);
            if (!cleaned) return;
            var g = aliasToGroup[cleaned];
            if (g) {
                groupHit = { key: g.key, label: g.label, grouped: true };
                return;
            }
            if (SHORT_LABELS[cleaned]) {
                if (!shortHit) {
                    shortHit = {
                        key: 'short:' + cleaned,
                        label: SHORT_LABELS[cleaned],
                        isShort: true
                    };
                }
                return;
            }
            if (!looseHit) {
                looseHit = {
                    key: 'name:' + cleaned,
                    label: original.replace(/^\[[^\]]*\]\s*/g, '').trim() || original,
                    grouped: false
                };
            }
        });
        if (groupHit) return groupHit;
        if (shortHit) return shortHit;
        return looseHit;
    }

    function resolveFromDoctor(d) {
        if (!d) return null;
        return resolveFromTexts([d.english_name, d.chinese_name, d.display_name, d.doctor_code]) ||
            (d.id ? { key: 'id:' + String(d.id), label: String(d.english_name || d.display_name || d.doctor_code || '').trim() || '—' } : null);
    }

    function resolveFromBill(b, doctors) {
        if (!b) return { key: '__unknown__', label: '—' };
        var fromNames = resolveFromTexts([b.doctor_name, b.doctor_tag, b.dentist_name]);
        if (fromNames && fromNames.key) return fromNames;
        if (b.doctor_id && doctors && doctors.length) {
            var sid = String(b.doctor_id);
            var rec = null;
            for (var i = 0; i < doctors.length; i++) {
                if (doctors[i] && String(doctors[i].id) === sid) {
                    rec = doctors[i];
                    break;
                }
            }
            var fromDoc = resolveFromDoctor(rec);
            if (fromDoc) return fromDoc;
        }
        return fromNames || { key: '__unknown__', label: '—' };
    }

    function personKey(raw) {
        var p = resolveFromTexts([raw]);
        return p ? p.key : '';
    }

    var api = {
        cleanName: cleanName,
        personKey: personKey,
        resolveFromTexts: resolveFromTexts,
        resolveFromDoctor: resolveFromDoctor,
        resolveFromBill: resolveFromBill,
        SHORT_LABELS: SHORT_LABELS,
        GROUPS: GROUPS
    };

    if (typeof window !== 'undefined') window.DoctorAliases = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    return api;
})();
