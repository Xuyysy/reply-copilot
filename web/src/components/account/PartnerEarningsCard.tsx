import {useEffect,useState} from "react";
import {api} from "../../lib/api";
import {phrase,readableError,type Language} from "../../lib/language";
import {Button} from "../ui/button";
import PartnerAlipayRecipient from "./PartnerAlipayRecipient";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";

type Result={enabled:boolean;policy?:{status:"active"|"paused";level:string;rate_bps:number;term_months:number|null}|null;
 totals?:{orders:number;buyers:number;gross_fen:number;net_fen:number;held_fen:number;paid_fen:number;reserved_fen:number;outstanding_fen:number};
 orders?:{order_domain:string;paid_at:number;principal_fen:number;commission_fen:number;net_fen:number;hold_until:number}[]};
export default function PartnerEarningsCard({language,owner}:{language:Language;owner:string}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [result,setResult]=useState<Result|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [opened,setOpened]=useState(false);
 useEffect(()=>{
  if(!opened)return;
  let live=true;setBusy(true);setResult(null);setError("");
  void api<Result>("/v1/partners/me").then(v=>{if(live)setResult(v);}).catch(e=>{if(live)setError(readableError(e,language));}).finally(()=>{if(live)setBusy(false);});
  return()=>{live=false;};
 // locale changes do not trigger another read
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[opened,owner]);
 const money=(fen:number)=>new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{style:"currency",currency:"CNY"}).format(fen/100);
 if(!opened)return <Button type="button" variant="outline" onClick={()=>setOpened(true)}>{t("查询推广伙伴资格","Check partner eligibility")}</Button>;
 const p=result?.policy,s=result?.totals;
 return <Card><CardHeader><CardTitle>{t("推广伙伴 · 收益记录","Partner · Earnings history")}</CardTitle></CardHeader>
 <CardContent className="space-y-3">
 <Button type="button" variant="outline" onClick={()=>{setOpened(false);setResult(null);setError("");}}>{t("关闭","Close")}</Button>
 {busy&&<p role="status">{t("查询中…","Loading…")}</p>}
 {error&&<p role="alert">{error}</p>}
 {result&&!p&&<p>{t("目前未开放推广伙伴资格或尚未获得授权。","Partner eligibility is unavailable or not granted.")}</p>}
 {p&&<p>{p.status==="active"?t("已授权","Authorized"):t("已暂停","Paused")} · {p.level} · {p.rate_bps/100}%</p>}
 {s&&<div className="grid gap-2 sm:grid-cols-2">{[[t("累计佣金","Gross commission"),s.gross_fen],[t("退款后佣金","Net commission"),s.net_fen],[t("冻结期内","Within holding period"),s.held_fen],[t("结算预留","Reserved"),s.reserved_fen],[t("已结算","Paid"),s.paid_fen],[t("待核对净额（含欠款）","Outstanding net (including debt)"),s.outstanding_fen]].map(([label,n])=><div key={String(label)} className="rounded border p-3"><p className="text-xs text-muted-foreground">{label}</p><strong>{money(Number(n))}</strong></div>)}</div>}
 {s&&<p>{t("计佣订单","Commission orders")}: {s.orders} · {t("计佣客户","Commission customers")}: {s.buyers}</p>}
 {p&&<p className="text-sm text-muted-foreground">{t("金额仅为账本记录，不代表可提现余额。付款仍需人工核对，当前不开放结算申请。","Ledger records are not withdrawable balances. Manual verification is required; payout requests are not enabled.")}</p>}
 {result?.orders?.length? <div className="space-y-2"><h3>{t("最近 30 笔佣金","Latest 30 commissions")}</h3>{result.orders.map((o,i)=><div key={i} className="rounded border p-2 text-sm">{new Date(o.paid_at).toLocaleString()} · {o.order_domain==="recharge"?t("次数套餐","Credits"):t("订阅","Subscription")} · {money(o.net_fen)}<p>{t("原始佣金","Original commission")}: {money(o.commission_fen)}</p></div>)}</div>:null}
 {p&&<PartnerAlipayRecipient key={owner} language={language}/>}
 </CardContent></Card>;
}
