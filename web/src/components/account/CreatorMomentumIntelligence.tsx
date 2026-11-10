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
  score?:number;totalConfirmed?:number;cycle?:Cycle;curve?:Observation[];observedHours?:number};
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
 const message=finished===3
   ?t("今日三次临界机会均已有相应的研究参考信号；正式提醒记录以插件本机为准。","All three research reference nodes have been crossed; actual reminders are confirmed by the extension.")
   :t("每个阶段独立积累、到达其实际阈值后产生一次原创发布提醒机会，下一阶段重新开始蓄势。","Each stage builds independently. Its actual threshold enables one original-post reminder; the next stage begins a new accumulation cycle.");
 return <Card data-testid="creator-momentum-intelligence" className="cmi-terminal min-w-0 overflow-hidden">
  <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
   <div className="flex min-w-0 items-center gap-3"><span className="cmi-symbol"><Zap size={22}/></span>
    <div className="min-w-0"><p className="cmi-overline">CREATOR MOMENTUM INTELLIGENCE</p>
    <CardTitle className="mt-1">{t("互动势能智能分析终端","Creator Momentum Intelligence")}</CardTitle></div></div>
   <span className="cmi-pill">{t("付费专属","PAID ACCESS")}</span>
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
    <div className="cmi-hero">
     <div className="min-w-0 space-y-3">
      <p className="cmi-overline">{t("今日临界循环 / CURRENT CYCLE","DAILY THRESHOLD CYCLE")}</p>
      <div className="flex flex-wrap items-baseline gap-2"><strong className="cmi-primary-number tabular-nums">{percent}<span className="text-base font-medium">%</span></strong>
       <span className="text-sm text-muted-foreground">{t("本阶段参考进度","Current reference-stage progress")}</span></div>
      <h3 className="text-base font-bold">{stageLabel}</h3>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{message}</p>
     </div>
     <div className="cmi-gauge" aria-label={t(`当前阶段参考进度 ${percent}%`,`Reference stage progress ${percent}%`)}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="45" stroke="currentColor" strokeOpacity=".12" strokeWidth="9" fill="none"/>
       <circle cx="60" cy="60" r="45" stroke="#2578e4" strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={`${percent*2.827} 282.7`} transform="rotate(-90 60 60)"/></svg>
      <span>{finished===3?"III":numerals[current-1]}<small>{t("阶段","STAGE")}</small></span>
     </div>
    </div>
    <div className="cmi-overview-grid">
     <div><small>CMI · {t("全日势能指数","Daily index")}</small><strong className="tabular-nums">{score.toFixed(1)}<em> / 100</em></strong></div>
     <div><small>{t("今日已确认交付事件","Confirmed delivery events")}</small><strong className="tabular-nums">{insights.totalConfirmed??0}</strong></div>
     <div><small>{t("已越过的研究参考节点","Reference nodes crossed")}</small><strong className="tabular-nums">{finished}<em> / 3</em></strong></div>
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
     <summary>{t("查看 CMI 趋势与阶段循环分析","Explore CMI trend and stage cycles")}<ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180"/></summary>
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
      <p data-testid="cmi-methodology" className="text-xs leading-relaxed text-muted-foreground">
       {t("CMI 使用后台最新三段区间与已确认交付事件生成自研参考指数；它不等于 X 官方分发权重，也不代表已发布 X 评论。参考节点不是实际已弹提醒；真实触发、每日冻结阈值和展示记录由插件本机判定。","CMI is a proprietary research index based on current admin ranges and confirmed AI deliveries, not an official X rank or published-reply count. Reference crossings are not verified reminders; actual triggers and frozen daily thresholds are owned by the extension.")}
      </p>
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
