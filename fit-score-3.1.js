/* Jianren FIT SCORE 3.1 — standalone, browser-compatible core.
 * No synthetic norms or fabricated PubMed references.
 * Historical kai-log-v1 data is never mutated.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  root.JianrenFitScore=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const DAY=86400000;
  const clamp=(x,a=0,b=100)=>Math.min(b,Math.max(a,x));
  function decay(value,base,days,halfLife){
    if(![value,base,days,halfLife].every(Number.isFinite)||halfLife<=0||days<0||base>value) throw Error("Invalid decay parameters");
    return base+(value-base)*Math.pow(2,-days/halfLife);
  }
  function recentLoad(events,now=Date.now(),halfLife=14){
    if(!Array.isArray(events)||halfLife<=0) throw Error("Invalid training load");
    return events.reduce((sum,e)=>{
      const t=new Date(e.date).getTime(),load=Number(e.load);
      if(!Number.isFinite(t)||t>now||!Number.isFinite(load)||load<0) return sum;
      return sum+load*Math.pow(2,-(now-t)/DAY/halfLife);
    },0);
  }
  function weightedScore(metrics){
    const available=metrics.filter(m=>Number.isFinite(m.score)&&m.score>=0&&m.score<=100&&m.verified===true&&m.weight>0);
    const weight=available.reduce((s,m)=>s+m.weight,0);
    return {score:weight?Math.round(available.reduce((s,m)=>s+m.score*m.weight,0)/weight*10)/10:null,
      coverage:metrics.reduce((s,m)=>s+(m.weight>0?m.weight:0),0)?weight/metrics.reduce((s,m)=>s+(m.weight>0?m.weight:0),0):0,
      missing:metrics.filter(m=>!available.includes(m)).map(m=>m.id)};
  }
  // empirical percentile; reference cohort must be validated, representative and protocol-matched
  function percentile(value,reference,{lowerIsBetter=false,minN=100}={}){
    if(!Number.isFinite(value)||!Array.isArray(reference)) return {pr:null,reason:"invalid_input"};
    const xs=reference.filter(Number.isFinite);
    if(xs.length<minN) return {pr:null,reason:"insufficient_norms",n:xs.length};
    const below=xs.filter(x=>lowerIsBetter?x>value:x<value).length;
    const equal=xs.filter(x=>x===value).length;
    return {pr:Math.round(100*(below+equal/2)/xs.length*10)/10,n:xs.length,method:"empirical_midrank"};
  }
  function comparePerformance(baseline,current,{minimumDetectableChange=0,comparable=true}={}){
    if(!comparable||![baseline,current,minimumDetectableChange].every(Number.isFinite)||minimumDetectableChange<=0)
      return {status:"insufficient_evidence",triggerQuestionnaire:false};
    const delta=current-baseline;
    return {status:delta < -minimumDetectableChange?"possible_decline":"no_confirmed_decline",
      delta,triggerQuestionnaire:delta < -minimumDetectableChange};
  }
  const questions=[
    {id:"source",label:"你如何發現能力下降？",options:["實測表現下降","相同負荷更吃力","疲勞或恢復變差","只有分數下降","多種情況"]},
    {id:"duration",label:"變化持續多久？",options:["少於一週","1–2週","超過2週","不確定"]},
    {id:"sleep",label:"最近睡眠是否變差？",options:["沒有","稍微","明顯","不確定"]},
    {id:"training",label:"最近訓練負荷有何變化？",options:["增加","減少","大致相同","不確定"]},
    {id:"nutrition",label:"最近是否減少熱量攝取、體重快速下降或補水不足？",options:["沒有","有","不確定"]},
    {id:"illness",label:"最近是否有感染、發燒或新用藥？",options:["沒有","有","不確定"]},
    {id:"redflags",label:"是否有運動時胸痛、昏厥、嚴重呼吸困難或新發明顯心悸？",options:["沒有","有","不確定"]}
  ];
  function assess(answers){
    const flags=answers.redflags;
    if(flags==="有") return {triage:"urgent",message:"停止運動並儘速尋求醫療評估；若症狀正在發生或嚴重，請立即就醫。",causes:[]};
    const causes=[];
    if(answers.sleep==="明顯") causes.push("睡眠不足或恢復受影響");
    if(answers.training==="增加") causes.push("近期訓練負荷增加");
    if(answers.training==="減少") causes.push("訓練刺激減少");
    if(answers.nutrition==="有") causes.push("能量或水分攝取不足");
    if(answers.illness==="有") causes.push("近期疾病或用藥因素");
    return {triage:flags==="不確定"?"clarify_safety":"routine",causes,
      message:causes.length?"以上為待確認的可能因素，不是診斷。":"目前資料不足以判定原因，建議在可比條件下重新測試。"};
  }
  function evidenceRecommendation(item){
    if(!item||!item.pmid||!/^\d+$/.test(String(item.pmid))||!item.verified)
      return {available:false,message:"尚無已核實 PubMed 文獻，不能顯示為循證建議。"};
    return {available:true,title:item.title,pmid:String(item.pmid),url:"https://pubmed.ncbi.nlm.nih.gov/"+item.pmid+"/",grade:item.grade||"未分級"};
  }
  return {decay,recentLoad,weightedScore,percentile,comparePerformance,questions,assess,evidenceRecommendation};
});
