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
  const [closingId,setClosingId]=useState<string|null>(null);
  const [notice,setNotice]=useState("");
  async function cancelUnpaidOrder(o:BoltOrder){
    if(o.status!=="pending"&&o.status!=="unknown")return;
    const yes=window.confirm(t(
      "请仅在尚未发起 USDT 转账时取消。本操作只关闭本站订单，不能撤回已发送的链上交易。已付款请不要取消，应先核验。确认关闭旧订单并允许重新选择支付宝或 USDT 吗？",
      "Cancel only if you have NOT sent USDT. This closes only our local invoice, not an already sent blockchain transfer. If paid, verify instead. Close this invoice and choose Alipay or USDT again?"
    ));
    if(!yes)return;
    setClosingId(o.id);
    setNotice("");
    try{
      const response=await api<{order:BoltOrder}>("/v1/boltutil/orders/"+encodeURIComponent(o.id)+"/cancel",{
        method:"POST",body:JSON.stringify({confirm:true})
      });
      setOrders(previous=>previous.map(item=>item.id===o.id?{...item,...response.order}:item));
      setNotice(t("旧 USDT 订单已关闭，可以重新选择支付方式。","Old USDT invoice closed; you can choose a new payment method."));
    }catch(e){setNotice(e instanceof Error?e.message:t("关闭失败，请查询原订单。","Unable to close; verify your original invoice."));}
    finally{setClosingId(null);}
  }
  useEffect(()=>{
    let live=true;
    // Account-history mounting is read-only. User cancellation requires a
    // separate explicit confirmation; do not mutate on automatic refresh.
    void api<{orders:BoltOrder[]}>("/v1/boltutil/orders")
      .then(data=>{if(live&&Array.isArray(data.orders))setOrders(data.orders);})
      .catch(()=>{if(live)setError(true);});
    return ()=>{live=false;};
  },[]);
  const matching=orders.filter(o=>o.productType===productType);
  if(!matching.length||error)return null;
  return <section data-testid={"account-usdt-"+productType+"-orders"} className="mt-4 min-w-0 border-t border-border pt-4" aria-label={t("USDT 付款记录","USDT payment history")}>
      <h4 className="mb-2 text-sm font-semibold">{productType==="credits"?t("USDT 充值订单","USDT top-up orders"):t("USDT 订阅订单","USDT subscription orders")}</h4>
      <p className="mb-3 text-xs text-muted-foreground">{t("TRON、Polygon、BNB、Ethereum、Solana 五链订单独立记录；权益到账以服务端核验为准。","TRON, Polygon, BNB, Ethereum and Solana orders are tracked separately; entitlements require server verification.")}</p>
      {notice&&<p role="status" className="mb-2 text-xs">{notice}</p>}
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
            {(o.status==="pending"||o.status==="unknown")&&<button type="button" className="button secondary"
              disabled={closingId===o.id} onClick={()=>void cancelUnpaidOrder(o)}>
              {closingId===o.id?t("正在关闭…","Closing…"):t("未付款？关闭订单并更换支付方式","Not paid? Close and switch payment method")}
            </button>}
            {o.status==="closed"&&<a className="button" href="/pricing/">{t("重新下单","Order again")}</a>}
          </div>
        </div>)}
      </div>
  </section>;
}
