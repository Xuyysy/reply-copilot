import {useEffect,useState} from "react";
import {Activity,ArrowRight,ChevronDown,LockKeyhole,RefreshCw,TrendingUp,Zap} from "lucide-react";
import {api,ApiError} from "../../lib/api";
import {phrase,useLanguage} from "../../lib/language";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
import {Button} from "../ui/button";

type Stage={stage:number;referenceState:"before_reference_window"|"inside_reference_window"|"past_reference_window";referenceCrossed:boolean};
type Cycle={stage:number;percent:number;referenceCrossings:number;windowStage:number;stages:Stage[]};
type Observation={hour:number;score:number;cycleProgress:number;cycleStage:number;referenceCrossings:number};
type Insights={eligible:boolean;available:boolean;day?:string;timezone?:string;policyVersion?:string;
  score?:number;cycle?:Cycle;curve?:Observation[];observedHours?:number};
type PanelState="loading"|"ready"|"locked"|"off"|"error";
const numerals=["I","II","III"];

function MomentumChart({observations,observedHours,language}:{observations:Observation[];observedHours:number;language:"zh"|"en"}){
  const points=observations.slice(0,Math.max(1,Math.min(24,observedHours)));
  const x=(hour:number)=>32+hour*656/23;
  const y=(n:number)=>172-Math.max(0,Math.min(100,n))*1.35;
  const path=(key:"score"|"cycleProgress")=>points.map((p,i)=>`${i?"L":"M"}${x(p.hour).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const spikes=points.filter((p,i)=>i>0&&p.referenceCrossings>points[i-1].referenceCrossings);
  return <div className="cmi-chart-scroll">
    <svg viewBox="0 0 720 208" width="100%" role="img" aria-label={phrase(language,"CMI 指数与当前阶段势能双曲线","CMI index and current-stage momentum chart")}>
      {[0,25,50,75,100].map(n=><g key={n}><line x1="32" y1={y(n)} x2="688" y2={y(n)} stroke="currentColor" strokeOpacity=".12" strokeDasharray="3 6"/>
        <text x="23" y={y(n)+3} fontSize="10" textAnchor="end" fill="currentColor" opacity=".55">{n}</text></g>)}
      {[0,6,12,18,23].map(h=><text key={h} x={x(h)} y="199" fontSize="10" fill="currentColor" opacity=".56" textAnchor={h===0?"start":h===23?"end":"middle"}>{String(h).padStart(2,"0")}:00</text>)}
      <path d={path("score")} stroke="#3565db" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <path d={path("cycleProgress")} stroke="#0f9a9b" strokeWidth="2.7" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 5"/>
      {spikes.map(p=><g key={p.hour}><line x1={x(p.hour)} x2={x(p.hour)} y1="30" y2="175" stroke="#0f9a9b" strokeWidth="1.2" strokeDasharray="3 5" strokeOpacity=".6"/>
        <circle cx={x(p.hour)} cy={y(p.cycleProgress)} r="4" fill="#0f9a9b" stroke="white" strokeWidth="1.5"/></g>)}
    </svg>
  </div>;
}

export default function CreatorMomentumIntelligence({userId}:{userId:string}){
 const language=useLanguage();
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [revision,setRevision]=useState(0);
 const [state,setState]=useState<PanelState>("loading");
 const [insights,setInsights]=useState<Insights|null>(null);
 useEffect(()=>{
   let active=true;
   setState("loading");setInsights(null);
   void api<Insights>("/v1/creator-momentum/insights").then(result=>{
     if(!active)return;
     setInsights(result);setState(!result.eligible?"locked":!result.available?"off":"ready");
   }).catch(error=>{
     if(!active)return;
     setState(error instanceof ApiError&&error.status===403?"locked":"error");
   });
   return()=>{active=false};
 },[userId,revision]);
 useEffect(()=>{
   let last=Date.now();
   const refresh=()=>{if(document.visibilityState==="visible"&&Date.now()-last>90_000){last=Date.now();setRevision(x=>x+1);}};
   document.addEventListener("visibilitychange",refresh);
   return()=>document.removeEventListener("visibilitychange",refresh);
 },[userId]);
 const cycle=insights?.cycle;
 const current=cycle?.stage??1;
 const finished=cycle?.referenceCrossings??0;
 const percent=cycle?.percent??0;
 const score=insights?.score??0;
 const stageLabel=finished===3?t("今日三个参考节点均已越过","All three reference nodes crossed"):
   t(`阶段 ${numerals[current-1]} · 蓄势进行中`,`Stage ${numerals[current-1]} · Building momentum`);
 const signalLabel=finished===3
   ?t("今日三段参考积累完成","All reference stages crossed")
   :cycle?.windowStage===current
     ?t(`阶段 ${numerals[current-1]} · 临界参考区间`,`Stage ${numerals[current-1]} · Reference window`)
     :t(`阶段 ${numerals[current-1]} · 势能积累中`,`Stage ${numerals[current-1]} · Building momentum`);
 const signalDescription=t("该状态依据当前后台区间推算，并非插件已弹出的提醒记录。","This is a research projection from current admin ranges, not a confirmed extension reminder.");
 const message=t("三个阶段各有一次原创发布提醒机会。达到插件当天的实际阈值后，在下一次原生回复操作时提醒。","Each of the three stages can prompt one original post, on the next native reply after the extension's actual daily threshold is met.");
 return <Card data-testid="creator-momentum-intelligence" className="cmi-terminal min-w-0 overflow-hidden">
  <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
   <div className="flex min-w-0 items-center gap-3"><span className="cmi-symbol"><Zap size={22}/></span>
    <div className="min-w-0"><p className="cmi-overline">CREATOR MOMENTUM INTELLIGENCE</p>
    <CardTitle className="mt-1">{t("互动势能智能分析终端","Creator Momentum Intelligence")}</CardTitle></div></div>
   <div className="flex flex-wrap items-center gap-2">
    <span className="cmi-pill">{t("付费专属","PAID ACCESS")}</span>
    <Button variant="outline" size="sm" asChild>
     <a data-cmi-learn-more href="/#momentum-framework" aria-label={t("详细了解互动势能临界值理论","Learn more about the Creator Momentum Threshold theory")}>
      {t("详细了解","Learn more")}<ArrowRight size={14} aria-hidden="true"/>
     </a>
    </Button>
   </div>
  </CardHeader>
  <CardContent className="space-y-4">
   {state==="loading"&&<div role="status" className="cmi-placeholder">{t("正在读取今日势能分析…","Loading today's momentum analysis…")}</div>}
   {state==="locked"&&<div data-cmi-locked className="cmi-placeholder flex flex-wrap items-center justify-between gap-4">
     <div className="flex min-w-0 items-start gap-3"><LockKeyhole size={22} className="shrink-0 text-slate-500"/><div>
      <p className="font-semibold">{t("解锁互动势能研究终端","Unlock the Creator Momentum Terminal")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("仅对持有有效付费权益的账户开放三阶段临界分析与 CMI 趋势。","The three-stage research dashboard and CMI trends require verified paid access.")}</p>
     </div></div><Button variant="outline" asChild><a href="/pricing/">{t("查看付费方案","See plans")}<ArrowRight size={15}/></a></Button>
   </div>}
   {state==="off"&&<div data-cmi-off className="cmi-placeholder">
    <strong>{t("分析功能暂未开放","Momentum analysis is not currently active")}</strong>
    <p className="mt-2 text-sm text-muted-foreground">{t("请以管理后台当前功能状态为准。","Availability follows the current admin policy.")}</p>
   </div>}
   {state==="error"&&<div className="cmi-placeholder flex items-center justify-between gap-3" role="alert">
    <span>{t("暂时无法读取分析数据","Unable to load momentum insights")}</span>
    <Button variant="outline" size="sm" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={14}/>{t("重试","Retry")}</Button>
   </div>}
   {state==="ready"&&insights&&cycle&&<>
    <div className="cmi-hero" data-cmi-overview>
     <div className="min-w-0 space-y-3">
      <p className="cmi-overline">CMI · {t("今日互动势能指数","Daily Creator Momentum Index")}</p>
      <div className="flex flex-wrap items-baseline gap-2">
       <strong data-cmi-score className="cmi-primary-number tabular-nums">{score.toFixed(1)}</strong>
       <span className="text-sm text-muted-foreground">/ 100 · {t("自研参考指数","Proprietary research index")}</span>
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t("将三阶段互动积累映射为连续的势能参考信号，帮助识别下一次原创释放机会。","Converts three-stage activity accumulation into a continuous momentum reference signal for the next original-post opportunity.")}</p>
     </div>
     <div className="cmi-gauge" aria-label={t(`当前阶段参考进度 ${percent}%`,`Reference stage progress ${percent}%`)}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="45" stroke="currentColor" strokeOpacity=".12" strokeWidth="9" fill="none"/>
       <circle cx="60" cy="60" r="45" stroke="#2578e4" strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={`${percent*2.827} 282.7`} transform="rotate(-90 60 60)"/></svg>
      <span>{finished===3?"III":numerals[current-1]}<small>{percent}% · {t("本阶段","CYCLE")}</small></span>
     </div>
    </div>
    <div className="cmi-overview-grid" data-cmi-signal-summary>
     <div>
      <small>{t("今日临界信号","Today's threshold signal")}</small>
      <strong className="cmi-overview-state">{signalLabel}</strong>
      <p className="cmi-fine-print">{signalDescription}</p>
     </div>
     <div>
      <small>{t("原创释放机会 · 研究参考节点","Original-post opportunities · Research nodes")}</small>
      <strong className="tabular-nums">{finished}<em> / 3</em></strong>
      <p className="cmi-fine-print">{t("三个阶段分别积累、分别识别；不代表实际提醒已展示。","Three independent stages; this count does not confirm any reminder was shown.")}</p>
     </div>
    </div>
    <div className="cmi-cycle-progress" data-cmi-cycle-progress>
     <div className="flex flex-wrap justify-between gap-2 text-sm">
      <span className="font-semibold">{stageLabel}</span>
      <span className="tabular-nums text-muted-foreground">{t("本阶段参考进度","Current stage")} · {percent}%</span>
     </div>
     <div role="progressbar" aria-label={t("本阶段势能参考进度","Current stage reference momentum")} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="cmi-cycle-track">
      <div className="cmi-cycle-fill" style={{width:`${percent}%`}} />
     </div>
     <p className="cmi-fine-print">{message}</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
     <h3 className="font-semibold text-sm">{t("三次原创释放机会","Three original-post opportunities")}</h3>
     <span className="text-xs text-muted-foreground">{t("参考信号 · 非实际提醒记录","Research signals · Not verified reminders")}</span>
    </div>
    <div className="cmi-stage-grid" aria-label={t("今日三阶段参考状态","Three-stage daily reference status")}>
     {(cycle.stages??[]).map(s=><div key={s.stage} className={`cmi-stage cmi-stage-${s.referenceState}`}>
      <div className="flex items-center justify-between gap-2"><strong>STAGE {numerals[s.stage-1]}</strong><Zap size={16}/></div>
      <span>{s.referenceCrossed?t("研究参考节点已越过","Research reference node crossed"):
       s.referenceState==="inside_reference_window"?t("处于临界参考区间","Inside reference window"):
       t("继续积累","Building")}</span>
      <small>{t(`第 ${s.stage} 次原创机会`,`Original-post opportunity ${s.stage}`)}</small>
     </div>)}
    </div>
    <details data-cmi-details className="cmi-detail group">
     <summary>{t("查看势能曲线与研究解读","Explore momentum curves and research insights")}<ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180"/></summary>
     <div className="space-y-5 px-1 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div>
       <h3 className="font-semibold">{t("全天势能演化","Momentum evolution")}</h3><p className="text-xs text-muted-foreground">{t("整体势能持续观察 · 阶段进度分段归零","Daily cumulative index · Per-stage progress resets")}</p></div>
       <span className="text-xs text-muted-foreground">{insights.day} · UTC+08</span></div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><i className="cmi-legend-line cmi-blue"/>{t("CMI 全日指数","Daily CMI")}</span><span className="flex items-center gap-1"><i className="cmi-legend-line cmi-teal"/>{t("当前阶段进度","Current stage progress")}</span></div>
      <MomentumChart observations={insights.curve??[]} observedHours={insights.observedHours??24} language={language}/>
      <div className="cmi-advice"><div className="flex items-center gap-2"><TrendingUp size={18}/><strong>{t("原创建议 · 阶段性释放","Original-post guidance · Staged release")}</strong></div>
       <p className="text-sm leading-relaxed">{t("互动是蓄势，临界是信号，原创是释放。三个阶段分别对应一次提醒机会；达到当天实际阈值后，在下一次点击 X 原生回复时提示发布原创。","Engagement builds momentum. Thresholds signal opportunity. Original posts release it. Each of the three stages has one reminder opportunity, shown on the next native X reply after its actual daily threshold is met.")}</p></div>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
       <p>{t("我认为，原创帖的传播机会，并不只取决于发布的那一刻。持续参与高质量讨论，可能让账号建立话题关联、受众连接与行为信号。","I believe an original post's distribution opportunity is shaped by more than its publish time. Meaningful discussions may build topic relevance, audience links and behavioral signals.")}</p>
       <p>{t("我将互动积累过程中可能出现传播条件非线性变化的关键节点定义为「互动势能临界值」。","I define the point where accumulated engagement may correspond to nonlinear distribution changes as the Creator Momentum Threshold.")}</p>
      </div>
     </div>
    </details>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
     <span>{t("每次刷新自动读取后台最新触发区间","Refresh uses the latest admin threshold ranges")}</span>
     <Button variant="ghost" size="sm" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={14}/>{t("更新分析","Refresh")}</Button>
    </div>
   </>}
  </CardContent>
 </Card>;
}
