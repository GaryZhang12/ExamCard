/* SPDX-License-Identifier: Apache-2.0 */
/* ExamCard 1.1.0 · local keyword knowledge-tag recommendations.
 * Recommendations never replace existing tags and never decide question type. */
(function (root) {
  'use strict';
  var VERSION = 'p1-keyword-v1';
  var RULES = [
    { tag: '工程问题', any: ['工程', '工作总量', '效率', '合作完成', '合作施工', '单独完成', '轮流工作'], score: 3, exclude: ['工程监理', '工程验收'] },
    { tag: '排列组合', any: ['排列组合', '排列数', '组合数', '不同的排法', '不同的选法', '分组方法', '插空', '捆绑'], score: 3 },
    { tag: '概率问题', any: ['概率', '随机抽取', '至少一次', '期望值', '独立重复', '古典概型'], score: 3 },
    { tag: '平均数', any: ['平均数', '平均值', '平均每', '平均增长量', '平均运送距离', '平均水平'], score: 2 },
    { tag: '增长率', any: ['增长率', '增幅', '同比增长', '环比增长', '增速', '增长多少'], score: 2 },
    { tag: '比重', any: ['比重', '占比', '占全国', '占全省', '所占比例', '比例'], score: 2 },
    { tag: '言语理解', any: ['言语理解', '逻辑填空', '片段阅读', '主旨', '意在说明', '文段', '填入横线', '语句排序'], score: 2 },
    { tag: '判断推理', any: ['判断推理', '图形推理', '定义判断', '类比推理', '逻辑判断', '削弱', '加强', '前提', '结论'], score: 2 },
    { tag: '政治理论', any: ['政治理论', '习近平', '党的二十大', '中国式现代化', '新发展理念', '全面深化改革', '马克思主义', '中国特色社会主义'], score: 3 },
    { tag: '科学推理', any: ['科学推理', '力学', '重力', '摩擦力', '电路', '光学', '声学', '化学', '物理', '受力分析'], score: 3 },
    { tag: '深圳特色', any: ['深圳', '深圳市考', '先行示范区', '粤港澳大湾区', '前海'], score: 2 }
  ];
  function normalize(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim(); }
  function classify(stem) {
    var text = normalize(stem);
    var candidates = [];
    if (text.length < 4) return { version: VERSION, candidates: [], confident: false, reason: '题干过短，暂不推荐' };
    RULES.forEach(function (rule) {
      if ((rule.exclude || []).some(function (x) { return text.indexOf(x) >= 0; })) return;
      var hits = rule.any.filter(function (x) { return text.indexOf(x) >= 0; });
      if (!hits.length) return;
      candidates.push({ tag: rule.tag, score: rule.score + Math.min(2, hits.length - 1), hits: hits });
    });
    candidates.sort(function (a, b) { return b.score - a.score || a.tag.localeCompare(b.tag); });
    var top = candidates[0];
    var second = candidates[1];
    var confident = !!(top && top.score >= 3 && (!second || top.score > second.score));
    return { version: VERSION, candidates: candidates, confident: confident, reason: top ? (confident ? '关键词命中明确' : '存在多个候选，请人工确认') : '未命中本地关键词' };
  }
  root.KeywordClassifier = { VERSION: VERSION, RULES: RULES, classify: classify };
})(typeof window !== 'undefined' ? window : globalThis);
