const {test}=require('node:test'),assert=require('node:assert/strict'),{load}=require('./helpers.cjs');
const D=load('daily-plan-import.js').DailyPlanImport;
function planWithTypes(){
  const p=JSON.parse(D.planTemplate('foundation'));
  p.tasks=[];let m=19*60+30;
  const types=D.TASK_TYPES;
  types.forEach((type,i)=>{
    const start=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');m+=10;
    const end=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    p.tasks.push({task_id:'type-'+type,task_type:type,subject:'行测',topic:'类型'+type,priority:'normal',start,end,planned_minutes:10,learning_mode:'practice',course:null,material:null,stages:[{type:'practice',minutes:10}],acceptance:null,module:'资料分析',knowledge_point:'测试'});
  });
  return p;
}
test('legacy v1 without task_type/plan_mode still validates and derives business fields',()=>{
  const p=JSON.parse(D.jsonTemplate());delete p.plan_mode;delete p.tasks[0].task_type;
  const parsed=D.parseText(JSON.stringify(p),'legacy.json');assert.equal(D.validatePlan(parsed).length,0);
  const r=D.prepare(parsed,{}).records[0];assert.equal(r.taskType,'video');assert.equal(r.planMode,'foundation');assert.equal(r.learningMode,'course_first');
});
test('10 business task types validate and persist in prepared records',()=>{
  const p=planWithTypes();assert.equal(D.validatePlan(p).length,0);const rs=D.prepare(p,{}).records;assert.equal(rs.length,10);assert.equal([...new Set(rs.map(r=>r.taskType))].join(','),D.TASK_TYPES.join(','));
});
test('5 plan modes generate valid templates and cover all business types',()=>{
  const seen=new Set();for(const mode of D.PLAN_MODES){const s=D.planTemplate(mode);const p=D.parseText(s,mode+'.json');assert.equal(p.plan_mode,mode);assert.equal(D.validatePlan(p).length,0,s);p.tasks.forEach(t=>seen.add(t.task_type));}
  assert.equal([...seen].sort().join(','),D.TASK_TYPES.slice().sort().join(','));
});
test('mock exam template keeps xingce and shenlun as separate task streams',()=>{
  const p=D.parseText(D.planTemplate('mock_exam'),'mock.json');assert.equal(p.tasks.map(t=>t.subject).join(','),'行测,申论');assert.equal(p.tasks.map(t=>t.task_type).join(','),'mock_exam,mock_exam');assert.ok(p.tasks.every(t=>!String(t.topic).includes('+')));assert.equal(D.validatePlan(p).length,0);
});
test('unknown enums and priority=medium return explicit path/value/allowed errors',()=>{
  const p=JSON.parse(D.jsonTemplate());p.tasks[0].priority='medium';p.tasks[0].task_type='bogus';p.plan_mode='bogus';const errors=D.validatePlan(p);
  assert.ok(errors.some(e=>e.path==='tasks[0].priority'&&/high\/normal\/low/.test(e.message)&&/medium/.test(e.message)));
  assert.ok(errors.some(e=>e.path==='tasks[0].task_type'&&/bogus/.test(e.message)));
  assert.ok(errors.some(e=>e.path==='plan_mode'&&/bogus/.test(e.message)));
});
test('D+1/D+3/D+7 scheduling and due workload cap are deterministic and pure',()=>{
  const S=load('plan-scheduler.js').PlanScheduler;const task={id:'mem-1',title:'背诵',date:'2026-10-31',planMinutes:15};const reviews=S.reviewTasks(task);assert.equal(reviews.map(r=>r.dueDate).join(','),'2026-11-01,2026-11-03,2026-11-07');const all=reviews.map(r=>({...r,status:'pending'}));const due=S.dueReviews(all,'2026-11-07',{maxMinutes:20});assert.equal(due.selected.length,1);assert.equal(due.deferred.length,2);assert.equal(due.totalMinutes,15);assert.equal(task.date,'2026-10-31');assert.equal(reviews.length,3);
});
test('task total duration is calculated without counting other dates',()=>{
  const S=load('plan-scheduler.js').PlanScheduler;const tasks=[{id:'a',date:'2026-10-31',planMinutes:45,status:'pending'},{id:'b',date:'2026-10-31',planMinutes:20,status:'completed',actualMinutes:18},{id:'c',date:'2026-11-01',planMinutes:30,status:'pending'}];const w=S.workload(tasks,'2026-10-31');assert.equal(w.tasks,2);assert.equal(w.plannedMinutes,65);assert.equal(w.completedMinutes,18);
});
test('advisor requires sample, explains evidence, and never mutates tasks',()=>{
  const A=load('learning-advisor.js').LearningAdvisor;const tasks=[{id:'t',date:'2026-10-30',status:'completed',actualQuestions:10,actualCorrect:5,actualSource:'software',planMinutes:20,actualMinutes:20}];const before=JSON.stringify(tasks);const r=A.recommend({tasks});assert.equal(r.recommendations[0].code,'foundation_review');assert.ok(r.recommendations[0].evidence.questions===10);assert.equal(JSON.stringify(tasks),before);
  assert.equal(A.recommend({tasks:[{status:'completed',actualQuestions:3,actualCorrect:1,actualSource:'software'}]}).recommendations.length,0);
  assert.equal(A.recommend({tasks:[{status:'completed',actualQuestions:20,actualCorrect:5,actualSource:'manual'}]}).recommendations.length,0,'unverified/manual scores do not enter mastery advice');
});
