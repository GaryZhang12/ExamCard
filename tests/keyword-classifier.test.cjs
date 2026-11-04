const {load}=require('./helpers.cjs'),test=require('node:test'),assert=require('node:assert/strict');
const ctx=load('keyword-classifier.js');const K=ctx.KeywordClassifier;
test('keyword classifier returns local scored candidates without mutating input',()=>{
  const r=K.classify('甲、乙两人合作完成一项工程，甲的效率是乙的2倍，问合作完成需要多少天？');
  assert.equal(r.version,K.VERSION);assert.equal(r.candidates[0].tag,'工程问题');assert.ok(r.candidates[0].hits.length>=2);assert.ok(r.confident);
});
test('keyword classifier distinguishes probability, politics, science and Shenzhen',()=>{
  assert.equal(K.classify('从袋中随机抽取两个球，求至少一次抽到红球的概率').candidates[0].tag,'概率问题');
  assert.equal(K.classify('党的二十大报告指出，中国式现代化是全面推进中华民族伟大复兴的必由之路').candidates[0].tag,'政治理论');
  assert.equal(K.classify('物体在重力作用下沿斜面下滑，摩擦力做功是多少').candidates[0].tag,'科学推理');
  assert.equal(K.classify('深圳建设中国特色社会主义先行示范区，前海合作区制度创新').candidates[0].tag,'深圳特色');
});
test('keyword classifier respects exclusion and ambiguous candidates',()=>{
  assert.equal(K.classify('工程监理单位应当审查施工组织设计').candidates.length,0);
  const r=K.classify('资料分析中比较比重与增长率的关系，并计算平均数');
  assert.ok(r.candidates.length>=2);
  assert.equal(r.confident,false);
});
test('keyword classifier never invents a tag for empty text',()=>{
  assert.equal(K.classify('').candidates.length,0);assert.equal(K.classify('   ').confident,false);
});
