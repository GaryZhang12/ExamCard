const {load}=require('./helpers.cjs'),test=require('node:test'),assert=require('node:assert/strict');
const R=load('review-scheduler.js').ReviewScheduler;
test('D+1/D+3/D+7 review tasks are deterministic, grouped and never duplicate questions',()=>{
  const items=[{bankQuestionId:'q2',tags:['政治理论'],lastAt:1},{bankQuestionId:'q1',tags:['政治理论'],lastAt:2},{bankQuestionId:'s1',tags:['申论表达'],lastAt:3},{bankQuestionId:'x',tags:['工程问题'],lastAt:4}];
  const p=R.plan(items,{startDate:'2026-10-31'});
  assert.equal(p.intervals.join(','),'1,3,7');assert.equal(p.tasks.length,6);
  assert.equal(p.tasks.map(t=>t.date).sort().join(','),'2026-11-01,2026-11-01,2026-11-03,2026-11-03,2026-11-07,2026-11-07');
  const political=p.tasks.filter(t=>t.tagIds.includes('政治理论'));assert.equal(political.length,3);assert.equal(political[0].bankQuestionIds.join(','),'q1,q2');assert.ok(!p.tasks.some(t=>t.bankQuestionIds.includes('x')));
});
test('review scheduler has no task for unclassified questions',()=>{
  assert.equal(R.plan([{bankQuestionId:'q',tags:['工程问题']}],{startDate:'2026-10-31'}).tasks.length,0);
  assert.equal(R.plan([],{startDate:'2026-10-31'}).tasks.length,0);
});
