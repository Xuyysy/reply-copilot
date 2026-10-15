import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { phrase, readableError, useLanguage } from "../../lib/language";
import { Alert, AlertDescription } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

type Account = { user: { username: string | null; email: string; role: string; emailVerified: boolean } };
type Usage = { quota: { freeRemaining: number; paidRemaining: number; totalRemaining: number } };
type Activity = { ledger: Array<{ kind: string; free_delta: number; paid_delta: number; created_at: number }>; orders: Array<{ id: string; package_name: string; credits: number; status: string; created_at: number }> };
type Data = { account: Account; usage: Usage; activity: Activity };

export default function AccountDashboard() {
  const language = useLanguage();
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "error" | "ready">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const code = typeof location !== "undefined" ? new URL(location.href).searchParams.get("device_code") : null;
  const validCode = code && /^[A-F0-9]{8}$/.test(code) ? code : null;

  const load = useCallback(async () => {
    setState("loading"); setMessage(""); setData(null);
    try {
      const [account, usage, activity] = await Promise.all([api<Account>("/v1/me"), api<Usage>("/v1/usage"), api<Activity>("/v1/activity")]);
      setData({ account, usage, activity }); setState("ready");
    } catch (error) { setState(error instanceof ApiError && error.status === 401 ? "signed-out" : "error"); setMessage(readableError(error, language)); }
  }, [language]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [load]);

  async function approve() {
    if (!validCode || busy) return;
    setBusy(true); setMessage("");
    try { await api("/v1/extension/approve", { method: "POST", body: JSON.stringify({ deviceCode: validCode }) }); setApproved(true); setMessage(t("绑定成功，请返回插件继续操作。", "Connected. Return to the extension to continue.")); }
    catch (error) { setMessage(readableError(error, language)); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setData(null);
    try { await api("/v1/auth/logout", { method: "POST", body: "{}" }); location.href = "/login"; }
    catch (error) { setMessage(readableError(error, language)); setState("signed-out"); setBusy(false); }
  }
  const signInHref = validCode ? `/login?device_code=${validCode}` : "/login";
  if (state === "loading") return <div className="space-y-5" aria-label={t("正在读取账户", "Loading account")}><Skeleton className="h-32 w-full rounded-xl" /><div className="grid grid-cols-3 gap-4">{[0, 1, 2].map(item => <Skeleton key={item} className="h-36 rounded-xl" />)}</div><Skeleton className="h-48 w-full rounded-xl" /></div>;
  if (state === "signed-out") return <Card><CardHeader><CardTitle>{t("请先登录", "Please sign in")}</CardTitle></CardHeader><CardContent className="space-y-5"><p className="text-muted-foreground">{t("登录后即可查看余额、额度流水和插件绑定。", "Sign in to see your credits, activity and extension connection.")}</p><Button asChild><a href={signInHref}>{t("登录或注册", "Sign in or register")}<ArrowRight /></a></Button></CardContent></Card>;
  if (state === "error" || !data) return <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-5">{message || t("账户暂时无法读取。", "Account unavailable.")}<Button variant="outline" onClick={() => void load()}>{t("重试", "Retry")}</Button></AlertDescription></Alert>;
  const { account, usage, activity } = data;
  const date = (value: number) => new Date(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US");
  const labels: Record<string, [string, string]> = { signup_grant: ["注册赠送", "Welcome credits"], generation_debit: ["AI 生成", "AI generation"], generation_refund: ["失败返还", "Refund"], purchase_grant: ["充值到账", "Top-up"], admin_adjustment: ["人工调整", "Manual adjustment"] };
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-5"><div><p className="section-kicker">{t("账户概览", "Overview")}</p><h2 className="mb-1 text-3xl font-semibold tracking-tight">{account.user.username || t("我的账户", "My account")}</h2><p className="app-muted break-all">{account.user.email}</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={15} />{t("刷新", "Refresh")}</Button></div>
    <div className="grid grid-cols-3 gap-4">{[[t("剩余可生成次数", "Generations remaining"), usage.quota.totalRemaining], [t("免费额度", "Free credits"), usage.quota.freeRemaining], [t("付费额度", "Paid credits"), usage.quota.paidRemaining]].map(([label, value], index) => <Card key={String(label)} className={index === 0 ? "border-primary/30 bg-[#f3f8fd]" : ""}><CardContent className="p-6"><p className="text-sm text-muted-foreground">{label}</p><strong className="mt-3 block text-4xl font-semibold tracking-tight">{value}</strong></CardContent></Card>)}</div>
    {validCode && <Card className="border-primary/30"><CardHeader><CardTitle>{t("连接 Chrome 插件", "Connect Chrome extension")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{t(`插件请求绑定此账户，设备码：${validCode}。请确认这是你发起的操作。`, `An extension requests access to this account. Device code: ${validCode}. Approve only if you started this.`)}</p><Button disabled={busy || approved} onClick={() => void approve()}>{busy && <Loader2 className="animate-spin" />}{approved ? t("已绑定", "Connected") : t("确认绑定插件", "Approve extension")}</Button>{message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}</CardContent></Card>}
    <div className="grid grid-cols-2 gap-5"><Card><CardHeader><CardTitle>{t("最近额度流水", "Recent activity")}</CardTitle></CardHeader><CardContent>{activity.ledger.length ? <ul className="divide-y divide-border">{activity.ledger.map((item, index) => <li className="flex items-center justify-between gap-4 py-3 text-sm" key={`${item.created_at}-${index}`}><div><strong>{phrase(language, ...(labels[item.kind] || [item.kind, item.kind]))}</strong><p className="text-muted-foreground">{date(item.created_at)}</p></div><span className={item.free_delta + item.paid_delta >= 0 ? "text-emerald-700" : "text-foreground"}>{item.free_delta + item.paid_delta > 0 ? "+" : ""}{item.free_delta + item.paid_delta}</span></li>)}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">{t("暂无额度记录。", "No activity yet.")}</p>}</CardContent></Card><Card><CardHeader><CardTitle>{t("充值订单", "Top-up orders")}</CardTitle></CardHeader><CardContent>{activity.orders.length ? <ul className="divide-y divide-border">{activity.orders.map(order => <li key={order.id} className="flex items-center justify-between gap-4 py-3 text-sm"><div><strong>{order.package_name} · {order.credits} {t("次", "credits")}</strong><p className="text-muted-foreground">{date(order.created_at)} · <span className="break-all">{order.id}</span></p></div><Badge variant="secondary">{order.status === "pending" ? t("待付款", "Pending") : order.status === "paid" ? t("已付款", "Paid") : order.status}</Badge></li>)}</ul> : <p className="py-8 text-center text-sm text-muted-foreground">{t("暂无订单。", "No orders yet.")}</p>}</CardContent></Card></div>
    <Card><CardContent className="flex items-center justify-between gap-5 p-6"><div><h3 className="mb-1 text-lg font-semibold">{t("按需充值", "Top up when needed")}</h3><p className="text-sm text-muted-foreground">{t("支付尚未开放，创建待付款订单不会扣款或增加额度。", "Payment is not yet available. Pending orders do not charge or grant credits.")}</p></div><Button variant="outline" asChild><a href="/pricing">{t("查看套餐", "View plans")}<ArrowRight /></a></Button></CardContent></Card>
    {message && !validCode && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
    <div className="flex gap-3"><Button variant="outline" disabled={busy} onClick={() => void logout()}>{t("退出登录", "Sign out")}</Button>{account.user.role === "admin" && <Button variant="outline" asChild><a href="/admin">{t("管理后台", "Admin")}</a></Button>}</div>
  </div>;
}
