import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, RefreshCw, X } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { phrase, readableError, useLanguage } from "../../lib/language";
import { checkoutOrderMessage } from "../../lib/checkout-status.mjs";
import { cleanPaymentReturn, createRefreshGate, watchPayment, watchAccountRefresh, paymentReturnOrder, rememberedPayment, pendingPaymentOrder, rememberPayment, createPaymentNotices } from "../../lib/payment-sync.mjs";
import { canRefreshPaymentOrder, refreshPaymentOrder } from "../../lib/payment-refresh.mjs";
import { canResumeMk99Order, resumeMk99Payment, paymentResumeMessage } from "../../lib/payment-resume.mjs";
import { orderPriceSummary } from "../../lib/order-price-summary.mjs";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";

type Account = { user: { userId: string; username: string | null; email: string; role: string; emailVerified: boolean } };
type Usage = { quota: { freeRemaining: number; paidRemaining: number; totalRemaining: number }; signupBenefit?: { status: "pending" | "granted"; amount: number } | null };
type Activity = { ledger: Array<{ kind: string; free_delta: number; paid_delta: number; created_at: number }>; orders: Array<{ id: string; package_name: string; credits: number; status: string; provider?: string; payment_protocol?: string; payment_status?: string; risk_state?:string; credited_at?:number|null; paid_at?:number|null; checkout?:{outcome:string;issue:string}|null; created_at: number; refund_eligibility?:string; base_amount_fen?:number; service_fee_fen?:number; total_amount_fen?:number }> };
type Data = { account: Account; usage: Usage; activity: Activity | null };
type Authorization = "none" | "checking" | "pending" | "approved" | "expired" | "invalid" | "used" | "error";
type OrderRefreshFeedback = { orderId: string; message: string; code?: string; requestId?: string; diagnostic?: { stage: string; upstreamHttpStatus: number | null } };

export default function AccountDashboard() {
  const language = useLanguage();
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "error" | "ready">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshingOrderId, setRefreshingOrderId] = useState<string | null>(null);
  const [orderRefreshFeedback, setOrderRefreshFeedback] = useState<OrderRefreshFeedback | null>(null);
  const [code, setCode] = useState(() => typeof location !== "undefined" ? new URL(location.href).searchParams.get("device_code") : null);
  const [authorization, setAuthorization] = useState<Authorization>(code ? "checking" : "none");
  const [dialogOpen, setDialogOpen] = useState(false);
  const submitting = useRef(false);
  const refreshInFlight = useRef(new Set<string>());
  const accountOwner=useRef<string|null>(null);
  const accountRefresh = useRef<ReturnType<typeof createRefreshGate>|null>(null);
  if(!accountRefresh.current)accountRefresh.current=createRefreshGate();
  const [paymentHint, setPaymentHint] = useState<string|null>(() => typeof location !== "undefined" ? paymentReturnOrder(location.href)||rememberedPayment() : null);
  type PaymentNotice = {orderId:string;kind:string;credits?:number};
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice|null>(null);
  const notices=useRef<ReturnType<typeof createPaymentNotices>|null>(null);
  if(!notices.current)notices.current=createPaymentNotices();
  const [continuingOrderId,setContinuingOrderId]=useState<string|null>(null);
  const validCode = code && /^[A-F0-9]{8}$/.test(code) ? code : null;

  const load = useCallback((silent=false,fresh=false):Promise<boolean> => accountRefresh.current!(async()=>{
    if(!silent){setState("loading");setMessage("");}
      try {
        const [account, usage, activity] = await Promise.all([api<Account>("/v1/me"), api<Usage>("/v1/usage"), api<Activity>("/v1/activity").catch(error => { if (error instanceof ApiError && error.status === 401) throw error; return null; })]);
        const sameAccount=accountOwner.current===null||accountOwner.current===account.user.userId;
        accountOwner.current=account.user.userId;
        notices.current!.setOwner(account.user.userId);setPaymentNotice(notices.current!.current());
        // Retain the monitored order until its watcher confirms a terminal result.
        // A concurrent account refresh must not cancel the paid notification.
        setPaymentHint(previous=>(sameAccount?previous:null)||pendingPaymentOrder(activity?.orders)||null);
        setData({ account, usage, activity }); setState("ready");return true;
      } catch(error){if(error instanceof ApiError&&error.status===401){notices.current!.setOwner(null);setPaymentNotice(null);setData(null);setState("signed-out");}else if(!silent)setState("error");setMessage(readableError(error,language));return false;}
  },{fresh}), [language]);
  useEffect(()=>{const clean=cleanPaymentReturn(location.href);if(clean!==location.href)history.replaceState(history.state,"",clean);},[]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => watchAccountRefresh(()=>load(true),globalThis,{intervalMs:state==="ready"?30000:0}), [load,state]);
  const pendingPaymentId=paymentHint||pendingPaymentOrder(data?.activity?.orders)||null;
  const paymentOwner=data?.account.user.userId??null;
  useEffect(()=>{
    if(state!=="ready"||!pendingPaymentId||!paymentOwner)return;
    let alive=true;
    const show=(kind:string,credits?:number)=>{if(!alive)return;const next=notices.current!.publish({orderId:pendingPaymentId,kind,credits},paymentOwner);if(next)setPaymentNotice(next);};
    show("confirming");
    const stop=watchPayment({orderId:pendingPaymentId,request:api,
      onPaid:async(result:any)=>{
        if(!alive)return;
        const synced=await load(true,true);
        // A successful refresh can end this watcher by removing the pending order.
        // Preserve the result, but never overwrite another account/order's notice.
        if(!notices.current!.isOwner(paymentOwner))return;
        const current=notices.current!.current();if(current&&current.orderId!==pendingPaymentId)return;
        const next=notices.current!.publish({orderId:pendingPaymentId,kind:synced?"paid":"paid_refresh_failed",credits:result.order.credits},paymentOwner);if(next)setPaymentNotice(next);
        setPaymentHint(previous=>previous===pendingPaymentId?null:previous);
        const u=new URL(location.href);if(u.searchParams.get("payment_order")===pendingPaymentId){u.searchParams.delete("payment_order");history.replaceState(history.state,"",u);}
      },
      onTimeout:()=>show("timeout"),
      onTerminal:(result:any)=>{if(!alive||!notices.current!.isOwner(paymentOwner))return;setPaymentHint(null);show(result.order.status);void load(true);},
      onError:(error:any)=>{if([401,403,404].includes(error?.status)&&alive&&notices.current!.isOwner(paymentOwner)){setPaymentHint(null);show("unavailable");}}
    });
    return()=>{alive=false;stop();};
  },[pendingPaymentId,state,load,language,paymentOwner]);
  function dismissPaymentNotice(){notices.current!.dismiss(paymentNotice);setPaymentNotice(null);}
  function paymentNoticeText(notice:PaymentNotice){
    if(notice.kind==="paid")return t(`支付成功，${notice.credits} 次额度已到账。`,`Payment successful. ${notice.credits} credits added.`);
    const texts:Record<string,[string,string]>={
      confirming:["正在确认支付结果…","Confirming payment…"],
      paid_refresh_failed:["支付已确认，账户信息暂时无法刷新，请稍后查看。","Payment confirmed; account refresh is temporarily unavailable."],
      timeout:["支付结果仍在确认，请稍后查看或手动刷新；不要重复付款。","Payment is still unconfirmed. Check later or refresh manually; do not pay again."],
      unavailable:["无法读取该订单，请确认当前登录账户。","Cannot read this order. Check the signed-in account."],
      closed:["该订单已关闭，无法继续付款。","This order is closed and cannot be paid."],
      failed:["该订单未完成付款，请查看订单状态。","Payment did not complete. Check the order status."],
      refunded:["该订单已退款，请查看订单状态。","This order was refunded. Check the order status."]
    };
    return phrase(language,...(texts[notice.kind]||texts.unavailable));
  }
  async function continuePayment(orderId:string){
    if(refreshInFlight.current.has(orderId))return;
    const owner=paymentOwner;setContinuingOrderId(orderId);setOrderRefreshFeedback(null);
    try {
      await resumeMk99Payment(orderId,{inFlight:refreshInFlight.current,
        request:async(path:string,options:RequestInit)=>{if(!notices.current!.isOwner(owner))throw new Error("ACCOUNT_CHANGED");const result=await api(path,options);if(!notices.current!.isOwner(owner))throw new Error("ACCOUNT_CHANGED");return result;},
        remember:rememberPayment,navigate:(url:string)=>location.assign(url)});
    }catch(error){if(notices.current!.isOwner(owner)){setOrderRefreshFeedback({orderId,message:error instanceof ApiError?readableError(error,language):paymentResumeMessage(error,language)});void load(true);}}
    finally{setContinuingOrderId(null);}
  }
  const checkAuthorization = useCallback(async () => {
    if (!validCode) { setAuthorization(code ? "invalid" : "none"); return; }
    setAuthorization("checking");
    try {
      const result = await api<{ status: Authorization }>(`/v1/extension/device-code/status?device_code=${encodeURIComponent(validCode)}`);
      setAuthorization(result.status);
      setDialogOpen(result.status === "pending");
    } catch (error) { setAuthorization("error"); setMessage(readableError(error, language)); }
  }, [validCode, code, language]);
  useEffect(() => { if (state === "ready" && code) void checkAuthorization(); }, [state, code, checkAuthorization]);

  function dismissAuthorization() {
    setDialogOpen(false);
    setCode(null);
    setAuthorization("none");
    const url = new URL(location.href);
    url.searchParams.delete("device_code");
    history.replaceState(history.state, "", url);
  }

  async function approve() {
    if (!validCode || busy || submitting.current || authorization !== "pending") return;
    submitting.current = true;
    setBusy(true); setMessage("");
    try { await api("/v1/extension/approve", { method: "POST", body: JSON.stringify({ deviceCode: validCode }) }); setAuthorization("approved"); setMessage(t("官网授权已批准，正在等待插件完成连接。", "Website approval complete. Waiting for the extension to finish connecting.")); }
    catch (error) {
      setMessage(readableError(error, language));
      if (error instanceof ApiError && ["INVALID_CODE", "DEVICE_CODE_EXPIRED", "DEVICE_CODE_USED"].includes(error.code)) { setDialogOpen(false); void checkAuthorization(); }
    }
    finally { submitting.current = false; setBusy(false); }
  }
  async function logout() {
    setBusy(true); notices.current!.setOwner(null);setPaymentNotice(null);setData(null);
    try { await api("/v1/auth/logout", { method: "POST", body: "{}" }); location.href = signInHref; }
    catch (error) { setMessage(readableError(error, language)); setState("signed-out"); setBusy(false); }
  }
  async function switchAccount() {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await api("/v1/auth/logout", { method: "POST", body: "{}" }); location.href = signInHref; }
    catch (error) { setMessage(readableError(error, language)); setBusy(false); }
  }
  async function requestRefund(orderId:string){
    const accepted=window.confirm(t("仅完全未使用的次数包可申请普通退款。退款金额将根据订单记录和适用条款核实后处理；提交申请不代表退款已获批准或确认金额。确定申请吗？","Ordinary refunds are available only for a completely unused package. Any refund amount will be reviewed against the order record and applicable terms; submitting a request does not confirm approval or an amount. Continue?"));
    if(!accepted)return;
    setBusy(true);setMessage("");
    try{await api(`/v1/orders/${encodeURIComponent(orderId)}/refunds`,{method:"POST",body:JSON.stringify({confirm:true})});await load();}
    catch(error){setMessage(readableError(error,language));}
    finally{setBusy(false);}
  }
  async function refreshPaymentStatus(orderId: string) {
    if (refreshInFlight.current.has(orderId)) return;
    setRefreshingOrderId(orderId);
    setOrderRefreshFeedback(null);
    try {
      const result = await refreshPaymentOrder<{ orderStatus?: string; verificationSource?: string }>(orderId, { inFlight: refreshInFlight.current, request: api, reload: load });
      if (result === false) return;
      const status = result.orderStatus;
      const statusMessage = result.verificationSource === "local_only"
        ? t("已刷新本地到账记录；此操作没有向支付平台查单，未到账时请等待异步通知或联系支持。", "Local credit records refreshed. No provider query was sent; wait for a verified notification or contact support if payment is not recorded.")
        : status === "paid"
        ? t("支付平台已确认成功，账户信息已刷新。", "The provider confirmed payment and account details were refreshed.")
        : status === "pending"
          ? t("已查询一次，订单仍待支付。", "Status checked once; the order is still awaiting payment.")
          : status === "closed" || status === "failed"
            ? t("已查询一次，支付未成功。", "Status checked once; payment did not succeed.")
            : t("已查询一次，支付结果仍待确认；请勿重复下单。", "Status checked once; payment is still unconfirmed. Do not place another order.");
      setOrderRefreshFeedback({ orderId, message: statusMessage });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setOrderRefreshFeedback({
        orderId,
        message: readableError(error, language),
        ...(apiError && /^[A-Z0-9_]{1,64}$/.test(apiError.code) ? { code: apiError.code } : {}),
        ...(apiError?.requestId ? { requestId: apiError.requestId } : {}),
        ...(apiError?.diagnostic ? { diagnostic: apiError.diagnostic } : {}),
      });
    } finally {
      setRefreshingOrderId(null);
    }
  }
  const signInHref = validCode ? `/login?mode=login&device_code=${validCode}` : "/login?mode=login";
  const registerHref = validCode ? `/login?mode=register&device_code=${validCode}` : "/login?mode=register";
  if (state === "loading") return <div className="space-y-5" aria-label={t("正在读取账户", "Loading account")}><Skeleton className="h-32 w-full rounded-xl" /><div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(item => <Skeleton key={item} className="h-36 rounded-xl" />)}</div><Skeleton className="h-48 w-full rounded-xl" /></div>;
  if (code && !validCode) return <Alert variant="destructive" role="alert"><AlertDescription>{t("设备码格式无效，请返回插件重新发起绑定。", "Invalid device code. Start again in the extension.")}</AlertDescription></Alert>;
  if (state === "signed-out") return <Card><CardHeader><CardTitle>{t("请先登录", "Please sign in")}</CardTitle></CardHeader><CardContent className="space-y-5"><p className="text-muted-foreground">{code ? t("登录或免费注册后，将自动返回插件授权确认。", "Sign in or register and you will return to extension approval automatically.") : t("登录后即可查看余额、额度流水和插件绑定。", "Sign in to see your credits, activity and extension connection.")}</p><div className="flex gap-3"><Button asChild><a href={signInHref}>{t("登录", "Sign in")}</a></Button><Button variant="outline" asChild><a href={registerHref}>{t("免费注册", "Register for free")}<ArrowRight /></a></Button></div></CardContent></Card>;
  if (state === "error" || !data) return <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-5">{message || t("账户暂时无法读取。", "Account unavailable.")}<Button variant="outline" onClick={() => void load()}>{t("重试", "Retry")}</Button></AlertDescription></Alert>;
  const { account, usage, activity } = data;
  const date = (value: number) => new Date(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US");
  const labels: Record<string, [string, string]> = { signup_grant: ["注册赠送", "Welcome credits"], generation_debit: ["AI 生成", "AI generation"], generation_refund: ["失败返还", "Refund"], purchase_grant: ["充值到账", "Top-up"], admin_adjustment: ["人工调整", "Manual adjustment"] };
  return <div className="space-y-5">
    {paymentNotice&&<Alert role="status" data-payment-notice className="pr-12"><AlertDescription>{paymentNoticeText(paymentNotice)}</AlertDescription><Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1" aria-label={t("关闭支付提示","Dismiss payment notice")} onClick={dismissPaymentNotice}><X size={16} aria-hidden="true" /></Button></Alert>}
    <div className="flex flex-wrap items-center justify-between gap-5"><div className="min-w-0"><p className="section-kicker">{t("账户概览", "Overview")}</p><h2 className="mb-1 break-words text-3xl font-semibold tracking-tight">{account.user.username || t("我的账户", "My account")}</h2><p className="app-muted break-all">{account.user.email}</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={15} />{t("刷新", "Refresh")}</Button></div>
    {usage.signupBenefit?.status === "pending" && <Alert role="status"><AlertDescription>{t("新人免费额度待领取：请在 Chrome 插件中登录并连接账户。账户和已购买额度仍可正常使用；如有疑问，请联系客服。", "Your welcome credits are pending. Sign in and connect your account in the Chrome extension. Your account and purchased credits remain available; contact support if you need help.")}</AlertDescription></Alert>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{[[t("剩余可生成次数", "Generations remaining"), usage.quota.totalRemaining], [t("免费额度", "Free credits"), usage.quota.freeRemaining], [t("付费额度", "Paid credits"), usage.quota.paidRemaining]].map(([label, value], index) => <Card key={String(label)} className={index === 0 ? "border-primary/30 bg-[#f3f8fd]" : ""}><CardContent className="p-6"><p className="text-sm text-muted-foreground">{label}</p><strong className="mt-3 block text-4xl font-semibold tracking-tight">{value}</strong></CardContent></Card>)}</div>
    {code && authorization !== "pending" && <Alert role="status" variant={authorization === "expired" || authorization === "invalid" || authorization === "used" || authorization === "error" ? "destructive" : "default"}><AlertDescription className="flex flex-wrap items-center gap-3">{authorization === "checking" ? t("正在检查设备码…", "Checking device code…") : authorization === "approved" ? t("官网授权已批准，正在等待插件完成连接。请返回插件查看绑定状态。", "Website approval complete. Return to the extension to check its connection.") : authorization === "expired" ? t("设备码已过期，请返回插件重新发起绑定。", "This code expired. Start again in the extension.") : authorization === "used" ? t("设备码已使用，不能再次授权。请在插件检查连接状态，或重新发起绑定。", "This code was used. Check the extension or start again.") : authorization === "invalid" ? t("设备码无效，请返回插件重新发起绑定。", "Invalid code. Start again in the extension.") : message || t("暂时无法检查设备码。", "Unable to check the code.")}{authorization === "error" && <Button variant="outline" size="sm" onClick={() => void checkAuthorization()}>{t("重试", "Retry")}</Button>}<Button variant="ghost" size="sm" onClick={dismissAuthorization}>{t("关闭提示", "Dismiss")}</Button></AlertDescription></Alert>}
    <Dialog open={dialogOpen && (authorization === "pending" || authorization === "approved")} onOpenChange={open => { if (!open && !busy) dismissAuthorization(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" showCloseButton={!busy} closeLabel={t("关闭", "Close")}><DialogHeader><DialogTitle>{t("连接 x-Reply-Helper", "Connect x-Reply-Helper")}</DialogTitle><DialogDescription>{t("你的 Chrome 插件正在请求连接当前账户。", "Your Chrome extension is requesting access to this account.")}</DialogDescription></DialogHeader><div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm"><p>{t("当前账户", "Current account")}：<strong className="break-all">{account.user.username || account.user.email}</strong></p><p>{t("邮箱", "Email")}：<span className="break-all">{account.user.email}</span></p><p>{t("本次设备码", "Device code")}：<strong className="font-mono tracking-widest">{validCode}</strong></p></div><p className="text-sm text-muted-foreground">{authorization === "approved" ? t("官网授权已批准，正在等待插件完成连接。请返回插件查看结果。", "Website approval complete. Return to the extension to check the result.") : t("仅在你本人从插件发起连接时确认。确认后，插件可使用当前账户的生成额度。", "Approve only if you started this in the extension. The extension will be able to use this account's credits.")}</p>{message && <Alert role="status" variant={authorization === "approved" ? "default" : "destructive"}><AlertDescription>{message}</AlertDescription></Alert>}<DialogFooter>{authorization === "approved" ? <Button onClick={dismissAuthorization}>{t("完成", "Done")}</Button> : <><Button variant="ghost" disabled={busy} onClick={() => void switchAccount()}>{t("切换账户", "Switch account")}</Button><Button variant="outline" disabled={busy} onClick={dismissAuthorization}>{t("取消", "Cancel")}</Button><Button disabled={busy} onClick={() => void approve()}>{busy && <Loader2 className="animate-spin" />}{t("确认连接插件", "Approve extension connection")}</Button></>}</DialogFooter></DialogContent></Dialog>
    <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
      <Card className="min-w-0 self-start">
        <CardHeader><CardTitle>{t("最近额度流水", "Recent activity")}</CardTitle></CardHeader>
        <CardContent className="min-w-0">
          {activity === null ? <div className="space-y-3 py-6 text-center text-sm text-muted-foreground"><p>{t("额度流水暂时无法读取。", "Activity is temporarily unavailable.")}</p><Button data-activity-retry variant="outline" size="sm" onClick={() => void load()}>{t("重试", "Retry")}</Button></div> :
            <div data-activity-scroll role="region" aria-label={t("最近额度流水列表", "Recent activity list")} tabIndex={0} className="max-h-[400px] min-w-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-primary">
              {activity.ledger.length ? <ul className="divide-y divide-border">{activity.ledger.map((item, index) => <li data-created-at={item.created_at} className="flex items-center justify-between gap-4 py-3 text-sm" key={`${item.created_at}-${index}`}><div className="min-w-0"><strong>{phrase(language, ...(labels[item.kind] || [item.kind, item.kind]))}</strong><p className="text-muted-foreground">{date(item.created_at)}</p></div><span className={`shrink-0 ${item.free_delta + item.paid_delta >= 0 ? "text-emerald-700" : "text-foreground"}`}>{item.free_delta + item.paid_delta > 0 ? "+" : ""}{item.free_delta + item.paid_delta}</span></li>)}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">{t("暂无额度记录。", "No activity yet.")}</p>}
            </div>}
        </CardContent>
      </Card>
      <Card data-orders-card className="min-w-0 self-start">
        <CardHeader><CardTitle>{t("充值订单", "Top-up orders")}</CardTitle></CardHeader>
        <CardContent className="min-w-0">{activity === null ? <p className="py-8 text-center text-sm text-muted-foreground">{t("订单暂时无法读取。", "Orders are temporarily unavailable.")}</p> : activity.orders.length ? <ul className="divide-y divide-border">{activity.orders.map(order => {const refundLabels:Record<string,[string,string]>={eligible:["可申请退款","Refund eligible"],used_ineligible:["已使用，不支持普通退款","Used; ordinary refund unavailable"],refund_pending:["退款处理中","Refund processing"],refunded:["已退款","Refunded"],manual_review:["需要人工处理","Manual review required"],not_paid:["未支付","Not paid"]};const paymentLabels:Record<string,[string,string]>={pending:["待付款","Pending payment"],unknown:["待确认","Unconfirmed"],paid:["已付款","Paid"],failed:["支付失败","Payment failed"],closed:["已关闭","Closed"],refunded:["已退款","Refunded"]};const canRefresh=canRefreshPaymentOrder(order);const feedback=orderRefreshFeedback?.orderId===order.id?orderRefreshFeedback:null;return <li key={order.id} className="flex flex-wrap items-center justify-between gap-4 py-3 text-sm"><div className="min-w-0"><strong>{order.package_name} · {order.credits} {t("次", "credits")}</strong><p className="text-muted-foreground">{date(order.created_at)} · <span className="break-all">{order.id}</span></p><p className="text-muted-foreground">{orderPriceSummary(order,language)}</p>{order.payment_protocol==="epay"&&order.payment_status==="pending"&&<a className="mt-2 inline-block underline" href={"/checkout/?order="+encodeURIComponent(order.id)}>{t("继续原订单付款","Continue this order")}</a>}{order.payment_protocol==="mk99"&&["closed","failed","refunded"].includes(order.payment_status||"")&&<a className="mt-2 inline-block underline" href="/feedback">{t("联系客服","Contact support")}</a>}{order.checkout&&order.checkout.outcome!=="ready"&&<p className="mt-2 text-muted-foreground">{checkoutOrderMessage({status:order.payment_status,checkout:order.checkout},language)}</p>}<div className="mt-2 flex flex-wrap items-center gap-2">{canResumeMk99Order(order)&&<Button type="button" data-order-continue size="sm" disabled={busy||refreshingOrderId===order.id||continuingOrderId===order.id} onClick={()=>void continuePayment(order.id)}>{continuingOrderId===order.id&&<Loader2 className="animate-spin" size={15}/>} {continuingOrderId===order.id?t("正在确认订单…","Checking order…"):t("继续支付","Continue payment")}</Button>}{canRefresh&&<Button data-order-refresh size="sm" variant="outline" disabled={busy||refreshingOrderId===order.id||continuingOrderId===order.id} onClick={()=>void refreshPaymentStatus(order.id)}>{refreshingOrderId===order.id?<Loader2 className="animate-spin" size={15}/>:<RefreshCw size={15}/>} {refreshingOrderId===order.id?t("正在刷新支付状态…","Checking payment status…"):(order.payment_protocol==="epay"?t("刷新到账记录（本地）","Refresh local credit record"):t("刷新支付状态","Refresh payment status"))}</Button>}</div>{feedback&&<div className="mt-2 space-y-1 rounded-md border border-border bg-muted/40 p-3" role={feedback.code?"alert":"status"}><p>{feedback.message}</p>{feedback.code&&<p className="text-xs text-muted-foreground">{t("错误代码","Error code")}: {feedback.code}</p>}{feedback.diagnostic&&<p className="text-xs text-muted-foreground">{t("诊断阶段","Stage")}: {feedback.diagnostic.stage} · {t("上游 HTTP","Upstream HTTP")}: {feedback.diagnostic.upstreamHttpStatus??t("无","none")}</p>}{feedback.requestId&&<p className="break-all font-mono text-xs text-muted-foreground">requestId: {feedback.requestId}</p>}</div>}</div><Badge className="shrink-0" variant="secondary">{phrase(language,...(paymentLabels[order.payment_status||""]||[order.status,order.status]))}</Badge></li>;})}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">{t("暂无订单。", "No orders yet.")}</p>}</CardContent>
      </Card>
    </div>
    <Card><CardContent className="flex items-center justify-between gap-5 p-6"><div><h3 className="mb-1 text-lg font-semibold">{t("按需充值", "Top up when needed")}</h3><p className="text-sm text-muted-foreground">{t("待付款订单不会增加额度，到账以服务端确认的支付记录为准。", "Pending orders do not grant credits. Credits are added only after server-confirmed payment.")}</p></div><Button variant="outline" asChild><a href="/pricing">{t("查看套餐", "View plans")}<ArrowRight /></a></Button></CardContent></Card>
    {message && !validCode && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
    <div className="flex gap-3"><Button variant="outline" disabled={busy} onClick={() => void logout()}>{t("退出登录", "Sign out")}</Button>{account.user.role === "admin" && <Button variant="outline" asChild><a href="/admin">{t("管理后台", "Admin")}</a></Button>}</div>
  </div>;
}
