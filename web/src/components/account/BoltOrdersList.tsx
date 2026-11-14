import {useEffect,useState} from "react";
import {api} from "../../lib/api";
import {phrase,useLanguage} from "../../lib/language";

type BoltOrder={id:string;productType:string;network:"TRC20"|"POLYGON"|"BEP20";
  amount:string|null;quotedAmount:string;status:string;entitlementApplied:boolean;paidAt:number|null};
export default function BoltOrdersList(){
  const language=useLanguage();
  const t=(zh:string,en:string)=>phrase(language,zh,en);
  const [orders,setOrders]=useState<BoltOrder[]>([]);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let live=true;
    api<{orders:BoltOrder[]}>("/v1/boltutil/orders")
      .then(data=>{if(live&&Array.isArray(data.orders))setOrders(data.orders);})
      .catch(()=>{if(live)setError(true);});
    return ()=>{live=false;};
  },[]);
  if(!orders.length||error)return null;
  return <section className="container section" aria-labelledby="bolt-orders-heading" style={{maxWidth:1080}}>
    <div className="pricing-card space-y-3">
      <h2 id="bolt-orders-heading">{t("USDT 付款记录","USDT payment history")}</h2>
      <p className="fineprint">{t("TRON、Polygon、BNB Smart Chain 订单分链记录。回调不等于权益到账；可打开原订单主动查单。","Separate records for TRON, Polygon and BNB Smart Chain. Open an existing order to check payment and entitlements.")}</p>
      <div className="space-y-2">
        {orders.slice(0,20).map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-2">
          <div><p><strong>{o.productType==="credits"?t("永久额度包","Permanent credits"):t("订阅","Subscription")}</strong>
            {" · "}{o.network}{" · "}{o.amount??o.quotedAmount} USDT</p>
            <p className="fineprint">{o.entitlementApplied?t("权益已到账","Entitlement applied"):
              o.status==="manual_review"?t("人工审核","Manual review"):
              o.status==="paid"?t("已付款，权益核对中","Paid; entitlement pending"):
              t("未核实到账","Unconfirmed")}</p></div>
          <a className="button secondary" href={"/usdt-checkout/?order="+encodeURIComponent(o.id)}>
            {t("查看原订单","Open order")}
          </a>
        </div>)}
      </div>
    </div>
  </section>;
}
