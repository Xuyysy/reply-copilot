import {phrase,useLanguage} from "../../lib/language";
import {Badge} from "../ui/badge";
import {Button} from "../ui/button";

export type BoltOrder={
  id:string;
  productType:"credits"|"subscription";
  creditOrderId:string|null;
  subscriptionOrderId:string|null;
  network:"TRC20"|"POLYGON"|"BEP20"|"ERC20"|"SOLANA";
  amount:string|null;
  quotedAmount:string;
  status:string;
  entitlementApplied:boolean;
  paidAt:number|null;
  expiresAt:number|null;
};

export function boltPaymentStatus(order:BoltOrder,language:"zh"|"en"):string{
  const t=(zh:string,en:string)=>phrase(language,zh,en);
  if(order.entitlementApplied)return t("权益已到账","Entitlement applied");
  switch(order.status){
    case "closed":return t("订单已关闭","Invoice closed");
    case "manual_review":return t("待人工核对","Manual review required");
    case "paid":return t("付款已核验，权益处理中","Payment confirmed; entitlement pending");
    case "pending":return order.expiresAt!==null&&order.expiresAt<=Date.now()
      ?t("付款窗口已结束","Payment window ended")
      :t("待付款","Awaiting payment");
    case "unknown":return t("付款待核验","Payment unconfirmed");
    case "failed":return t("付款未完成","Payment failed");
    default:return t("待核验","Verification pending");
  }
}

export function BoltPaymentBadge({order}:{order:BoltOrder}){
  return <Badge variant="outline" className="shrink-0 font-medium">
    USDT · {order.network}
  </Badge>;
}

/** The same actions are used inside the ordinary subscription and credit
 * order rows. There is no second USDT-order section or duplicate invoice. */
export function BoltOrderActions({order,closing,onCancel}:{
  order:BoltOrder;closing:boolean;onCancel:(order:BoltOrder)=>void;
}){
  const language=useLanguage(),t=(zh:string,en:string)=>phrase(language,zh,en);
  const pending=order.status==="pending"||order.status==="unknown";
  const canContinue=order.status==="pending"&&order.expiresAt!==null&&order.expiresAt>Date.now();
  const canReview=order.status==="manual_review"||order.status==="unknown"||
    (order.status==="pending"&&!canContinue);
  return <div className="flex flex-wrap items-center gap-2">
    {canContinue&&<Button size="sm" variant="outline" asChild>
      <a href={"/usdt-checkout/?order="+encodeURIComponent(order.id)}>{t("继续付款","Continue payment")}</a>
    </Button>}
    {canReview&&<Button size="sm" variant="outline" asChild>
      <a href={"/usdt-checkout/?order="+encodeURIComponent(order.id)}>{t("核验原订单","Verify original invoice")}</a>
    </Button>}
    {pending&&<Button size="sm" variant="outline" type="button"
      disabled={closing} onClick={()=>onCancel(order)}>
      {closing?t("正在关闭…","Closing…"):t("取消订单","Cancel order")}
    </Button>}
    {order.status==="closed"&&<Button size="sm" variant="outline" asChild>
      <a href="/pricing/">{t("重新下单","Order again")}</a>
    </Button>}
  </div>;
}

export function BoltStandaloneOrderRow({order,closing,onCancel}:{
  order:BoltOrder;closing:boolean;onCancel:(order:BoltOrder)=>void;
}){
  const language=useLanguage(),t=(zh:string,en:string)=>phrase(language,zh,en);
  return <li className="flex min-w-0 flex-col gap-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{order.productType==="subscription"?t("订阅","Subscription"):t("永久额度包","Permanent credits")}</strong>
        <BoltPaymentBadge order={order}/>
      </div>
      <p className="text-muted-foreground">{order.amount??order.quotedAmount} USDT</p>
      <p className="text-xs text-muted-foreground">{boltPaymentStatus(order,language)}</p>
    </div>
    <BoltOrderActions order={order} closing={closing} onCancel={onCancel}/>
  </li>;
}
