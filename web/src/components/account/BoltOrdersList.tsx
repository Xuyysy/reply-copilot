import {useEffect,useState} from "react";
import {api} from "../../lib/api";
import {phrase,useLanguage} from "../../lib/language";

type BoltOrder={id:string;productType:"credits"|"subscription";network:"TRC20"|"POLYGON"|"BEP20"|"ERC20"|"SOLANA";
  amount:string|null;quotedAmount:string;status:string;entitlementApplied:boolean;paidAt:number|null;expiresAt:number|null};
export default function BoltOrdersList({productType}:{productType:"credits"|"subscription"}){
  const language=useLanguage();
  const t=(zh:string,en:string)=>phrase(language,zh,en);
  const [orders,setOrders]=useState<BoltOrder[]>([]);
  const [error,setError]=useState(false);
  useEffect(()=>{
    let live=true;
    // Reconcile only *unpaid*, locally expired USDT invoices. No provider calls
    // or financial grants; a later real transfer is routed to manual review.
    void api("/v1/boltutil/expire",{method:"POST",body:"{}"})
      .catch(()=>null)
      .then(()=>api<{orders:BoltOrder[]}>("/v1/boltutil/orders"))
      .then(data=>{if(live&&Array.isArray(data.orders))setOrders(data.orders);})
      .catch(()=>{if(live)setError(true);});
    return ()=>{live=false;};
  },[]);
  const matching=orders.filter(o=>o.productType===productType);
  if(!matching.length||error)return null;
  return <section data-testid={"account-usdt-"+productType+"-orders"} className="mt-4 min-w-0 border-t border-border pt-4" aria-label={t("USDT 付款记录","USDT payment history")}>
      <h4 className="mb-2 text-sm font-semibold">{productType==="credits"?t("USDT 充值订单","USDT top-up orders"):t("USDT 订阅订单","USDT subscription orders")}</h4>
      <p className="mb-3 text-xs text-muted-foreground">{t("TRON、Polygon、BNB、Ethereum、Solana 五链订单独立记录；权益到账以服务端核验为准。","TRON, Polygon, BNB, Ethereum and Solana orders are tracked separately; entitlements require server verification.")}</p>
      <div className="space-y-2">
        {matching.slice(0,20).map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-2">
          <div><p><strong>{o.productType==="credits"?t("永久额度包","Permanent credits"):t("订阅","Subscription")}</strong>
            {" · "}{o.network}{" · "}{o.amount??o.quotedAmount} USDT</p>
            <p className="fineprint">{o.entitlementApplied?t("权益已到账","Entitlement applied"):
              o.status==="manual_review"?t("到账证据待人工复核","Payment awaiting manual review"):
              o.status==="paid"?t("已付款，权益核对中","Paid; entitlement pending"):
              o.status==="closed"?t("订单已关闭，可以重新下单","Invoice closed; you can order again"):
              o.status==="pending"&&o.expiresAt!==null&&o.expiresAt>Date.now()?t("待付款，可继续支付","Awaiting payment; invoice available"):
              o.status==="pending"&&o.expiresAt!==null&&o.expiresAt<=Date.now()?t("付款窗口已结束，正在核对关闭状态","Payment window ended; verifying closure"):
              t("付款状态未核实","Payment unconfirmed")}</p></div>
          <div className="flex flex-wrap gap-2">
            <a className="button secondary" href={"/usdt-checkout/?order="+encodeURIComponent(o.id)}>
              {o.status==="pending"&&o.expiresAt!==null&&o.expiresAt>Date.now()?t("继续支付","Continue payment"):t("查看原订单","Open order")}
            </a>
            {o.status==="closed"&&<a className="button" href="/pricing/">{t("重新下单","Order again")}</a>}
          </div>
        </div>)}
      </div>
  </section>;
}
