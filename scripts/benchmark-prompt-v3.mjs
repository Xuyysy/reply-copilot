import {writeFileSync,mkdirSync} from "node:fs";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {DEFAULT_VOICE_PROFILE} from "../domain/voice-profile.js";
import {buildPrompts} from "../prompts/prompt-builder.js";
import {buildStagingV3Prompts} from "../prompts/prompt-v3-experiment.js";

// Synthetic topic prompts, NOT real X posts. Use authenticated, consented
// samples and a native-speaking blind review before drawing quality conclusions.
const topics={
 zh:["新版本刚上线，结果第一个用户就找到了 bug","健身一个月，体重没变但是力量涨了","这家咖啡店涨价之后排队的人反而更多","今天下雨，本来想跑步就算了","AI 写代码确实快，改 bug 的时间可不短","今年又有人说远程办公不行","订阅功能加完了才发现支付流程更难","我觉得手机今年真的没必要换","周末一觉睡到中午，计划全乱了","开源项目的文档比代码更难维护"],
 en:["Shipped a small update and the first user found a bug","A month at the gym, same weight but stronger lifts","My local coffee shop raised prices and the line got longer","It's raining and my running plans are falling apart","AI makes coding faster, debugging is still a mess","Another thread claiming remote work is dead","The subscription checkout took longer than the product","Not sure there's any reason to upgrade my phone","Slept until noon and lost the whole weekend plan","Writing docs is harder than maintaining my open source code"],
 ja:["新機能を公開したら最初のユーザーがバグを見つけた","筋トレを一か月続けたけど体重は変わらない","近所のカフェが値上げしたのに行列が長くなってる","雨で今日のランニングをやめようか迷ってる","AIでコードを書くのは速いけど修正は大変","リモートワークはもう終わりって話をまた見た","課金機能より決済の確認のほうが難しかった","今年はスマホを買い替えなくてもいいかな","昼まで寝てしまって週末の予定が全部ずれた","オープンソースのドキュメント作りが意外と大変"],
 ko:["새 기능을 출시했는데 첫 사용자가 바로 버그를 찾았네요","운동한 지 한 달인데 몸무게는 그대로예요","동네 카페가 가격을 올렸는데 줄은 더 길어졌어요","오늘 비가 와서 달리기를 쉴까 고민 중","AI로 코드는 빨리 쓰는데 디버깅은 여전히 어렵네요","재택근무가 끝났다는 글이 또 올라왔네요","구독 기능보다 결제 연동이 더 어려웠어요","올해는 휴대폰을 굳이 바꾸지 않아도 될 듯","늦잠 자느라 주말 계획이 다 밀려버렸네요","오픈소스 문서 정리가 생각보다 더 힘들어요"]
};
const tails={
 zh:["","你们也会这样吗？","有点没想到。"],
 en:["","Anyone else seeing this?","Did not expect that."],
 ja:["","みんなもそう？","ちょっと予想外だった。"],
 ko:["","다른 분들도 그런가요?","좀 의외였어요."]
};
const quantile=(a,q)=>{const sorted=[...a].sort((x,y)=>x-y);return sorted[Math.ceil(q*sorted.length)-1]??null};
const dims={};
for(const lang of ["zh","en","ja","ko"]) {
 const rows=[];const times={v2:[],v3:[]};
 for(let t=0;t<3;t++)for(let i=0;i<10;i++) {
  const id=lang+"-"+String(t*10+i+1).padStart(2,"0");
  const input={postContext:{text:topics[lang][i]+(tails[lang][t]?" "+tails[lang][t]:"")},voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"auto"},outputSchemaVersion:2};
  const sample={id,lang,source:"synthetic",v2Bytes:0,v3Bytes:0};
  // Alternate order to mitigate warmth and runtime scheduling bias.
  for(const fn of (i+t)%2 ? ["v3","v2"] : ["v2","v3"]) {
   const before=performance.now();
   const payload=(fn==="v2"?buildPrompts:buildStagingV3Prompts)(input);
   times[fn].push(performance.now()-before);
   sample[fn+"Bytes"]=Buffer.byteLength(payload.system,"utf8")+Buffer.byteLength(payload.user,"utf8");
  }
  rows.push(sample);
 }
 dims[lang]={count:rows.length,avgBytes:{v2:Math.round(rows.reduce((s,r)=>s+r.v2Bytes,0)/rows.length),v3:Math.round(rows.reduce((s,r)=>s+r.v3Bytes,0)/rows.length)},localBuildMs:{v2:{p50:quantile(times.v2,0.5),p95:quantile(times.v2,0.95)},v3:{p50:quantile(times.v3,0.5),p95:quantile(times.v3,0.95)}}};
}
const report={kind:"OFFLINE_SYNTHETIC_PROMPT_CONSTRUCTION_ONLY",sources:"synthetic_30_each_zh_en_ja_ko",networkCalls:0,aiCalls:0,totalSamples:120,measurements:dims,warning:"NOT a language-quality score or model/API latency result. Paid blind A/B and human review not performed."};
const index=process.argv.indexOf("--out");
if(index>=0){const output=process.argv[index+1];if(!output||output.startsWith("--"))throw Error("Provide --out <file>");mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify(report,null,2));
