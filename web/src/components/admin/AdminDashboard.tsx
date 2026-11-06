import CreatorFeaturesPanel from './CreatorFeaturesPanel';
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw, Search } from "lucide-react";
import CampaignPanel from "./CampaignPanel";
import SiteEditor from "./SiteEditor";
import SecurityPaymentPanel from "./SecurityPaymentPanel";
import AIModelManagementPanel from "./AIModelManagementPanel";
import AiCostBreakdown, { type ModelCost } from "./AiCostBreakdown";
import { api, ApiError, API_BASE } from "../../lib/api";
import { phrase, readableError, useLanguage, type Language } from "../../lib/language";
import { Alert, AlertDescription } from "../ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

type User = { id: string; username: string | null; email: string; status: string; free_balance: number; paid_balance: number; generations: number; role: string; is_test_account?: number; archived_at?: number | null; created_at?: number; last_active_at?: number | null; admin_note?: string };
type Package = { id: string; name_zh: string; name_en: string; credits: number; price_cents: number; promo_price_cents: number | null; price_cny_fen: number | null; sort_order: number; active: number; description_zh?: string; description_en?: string; settlement_mode?: string; exchange_rate_micros?: number | null; fee_rate_bps?: number; recommended_label_zh?: string; recommended_label_en?: string; featured?: number };
type Order = { id: string; email: string; package_name: string; credits: number; amount_cents: number; fee_cents: number | null; status: string; payment_status?: string | null; payment_currency?: string | null; provider?: string | null; amount_fen?: number | null; credited_at: number | null; created_at: number };
type Ledger = { id: string; email: string; kind: string; free_delta: number; paid_delta: number; reason: string | null; created_at: number };
type Setting = { key: string; value: string };
type AiUsage = { inputTokens: number; outputTokens: number; costMicroUsd: number };
type Metrics = Record<string, unknown> & { cost?: AiUsage; todayCost?: AiUsage; costByModel?: ModelCost[]; aiService?: { enabled: boolean; mode: string; provider: string; model: string; keyConfigured: boolean }; budgetUsedPercent?: number | null; monthRevenueFen?: number };
type Dashboard = { metrics: Metrics; users: User[]; packages: Package[]; orders: Order[]; settings: Setting[]; ledger: Ledger[] };
type Audit = { id: string; action: string; reason?: string; created_at: number; target_id?: string; actor_email?: string; operation_id?: string };
type UserDetail = { user: User; quota: unknown; orders: Order[]; ledger: Ledger[]; usage: unknown };
const contentKeys = ["xProfileUrl", "chromeStoreUrl", "supportEmail", "announcementZh", "announcementEn", "homeTitleZh", "homeTitleEn", "homeBodyZh", "homeBodyEn", "guideZh", "guideEn", "faqZh", "faqEn"];
const contentLabels: Record<string, [string, string]> = {
  xProfileUrl: ["X 主页链接", "X profile link"], chromeStoreUrl: ["Chrome 扩展商店链接", "Chrome extension store link"], supportEmail: ["客服邮箱", "Support email"],
  announcementZh: ["中文公告", "Announcement in Chinese"], announcementEn: ["英文公告", "Announcement in English"],
  homeTitleZh: ["首页中文标题", "Homepage title in Chinese"], homeTitleEn: ["首页英文标题", "Homepage title in English"],
  homeBodyZh: ["首页中文介绍", "Homepage introduction in Chinese"], homeBodyEn: ["首页英文介绍", "Homepage introduction in English"],
  guideZh: ["中文使用指南", "Usage guide in Chinese"], guideEn: ["英文使用指南", "Usage guide in English"],
  faqZh: ["中文常见问题", "Frequently asked questions in Chinese"], faqEn: ["英文常见问题", "Frequently asked questions in English"],
};
type Confirm = { title: string; description: string; action: () => Promise<void> } | null;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const microDollars = (value: unknown) => `$${(Number(value || 0) / 1_000_000).toFixed(4)}`;
const statusText = (value: string, language: Language) => ({ active: phrase(language, "正常", "Active"), frozen: phrase(language, "已冻结", "Frozen"), pending: phrase(language, "待付款", "Pending"), awaiting_payment: phrase(language, "等待支付", "Awaiting payment"), paid: phrase(language, "已付款", "Paid"), failed: phrase(language, "支付失败", "Payment failed"), closed: phrase(language, "已关闭", "Closed"), expired: phrase(language, "已关闭", "Closed"), refunded: phrase(language, "已退款", "Refunded"), unknown: phrase(language, "待确认", "Unknown") } as Record<string, string>)[value] || value;
const ledgerText = (value: string, language: Language) => ({ signup_grant: phrase(language, "注册赠送", "Welcome credits"), generation_debit: phrase(language, "AI 生成", "AI generation"), generation_refund: phrase(language, "失败返还", "Generation refund"), purchase_grant: phrase(language, "充值到账", "Top-up"), purchase_reversal: phrase(language, "购买退款撤销", "Purchase reversal"), admin_adjustment: phrase(language, "人工调整", "Manual adjustment") } as Record<string, string>)[value] || value;
const settingText = (value: string, language: Language) => ({ signup_grant: phrase(language, "注册赠送次数", "Signup credits"), registration_enabled: phrase(language, "开放注册", "Registration enabled"), ai_enabled: phrase(language, "开放 AI 生成", "AI generation enabled"), daily_cost_limit_micro_usd: phrase(language, "每日 AI 成本上限", "Daily AI cost limit"), announcement: phrase(language, "公告", "Announcement") } as Record<string, string>)[value] || value;

export default function AdminDashboard() {
  const language = useLanguage();
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [access, setAccess] = useState<"loading" | "ready" | "login" | "forbidden" | "error">("loading");
  const [data, setData] = useState<Dashboard | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("overview");
  const [paidFilter, setPaidFilter] = useState("all");
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [activeSince, setActiveSince] = useState("");
  const [note, setNote] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [orderDetail, setOrderDetail] = useState<any>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState<Package | null>(null);
  const [adjustUser, setAdjustUser] = useState("");
  const [adjustKind, setAdjustKind] = useState("free");
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const busyGuard = useRef(false);
  const operationIds = useRef(new Map<string, string>());
  const reasonRef = useRef("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState("");
  const reauthBusy = useRef(false);
  const [reauthPending, setReauthPending] = useState(false);
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);
  const reauthResolver = useRef<((ok: boolean) => void) | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  useEffect(()=>setNote(detail?.user.admin_note || ""),[detail]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [content, setContent] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const say = (text: string, failed = false) => { setNotice(text); setError(failed); };
  const read = <T,>(path: string) => api<T>(path);
  const write = async <T,>(path: string, body: object): Promise<T> => {
    const payload = { ...body, reason: (body as { reason?: string }).reason || reasonRef.current };
    if (payload.reason.trim().length < 8) throw new Error(t("操作原因至少 8 字", "Reason must contain at least 8 characters"));
    const passwordChange = path === "/v1/admin/security/password";
    // Never retain password fields in retry-map keys. The old password is rechecked server-side.
    const retryPayload = path.startsWith("/v1/admin/ai-models") ? { ...payload, apiKey: undefined, apiKeyUpdated: Boolean((payload as Record<string, unknown>).apiKey) } : payload;
    const key = passwordChange ? path : path + JSON.stringify(retryPayload);
    const operationId = passwordChange ? crypto.randomUUID() : operationIds.current.get(key) || crypto.randomUUID();
    if (!passwordChange) operationIds.current.set(key, operationId);
    const send = () => api<T>(path, { method: "POST", body: JSON.stringify({ ...payload, operationId }) });
    try {
      let result: T;
      try { result = await send(); } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== "ADMIN_REAUTH_REQUIRED") throw cause;
        setPassword(""); setReauthError(""); setReauthOpen(true);
        const authenticated = await new Promise<boolean>(resolve => { reauthResolver.current = resolve; });
        if (!authenticated) throw new Error(t("已取消身份验证", "Authentication cancelled"));
        result = await send();
      }
      operationIds.current.delete(key); return result;
    } catch (cause) { throw cause; }
  };

  const load = useCallback(async () => {
    setBusy(true); setAccess("loading"); setData(null); setNotice("");
    try {
      const metrics = await read<Metrics>("/v1/admin/dashboard");
      const [users, packages, orders, settings, ledger] = await Promise.all([
        read<{ users: User[] }>("/v1/admin/users"), read<{ packages: Package[] }>("/v1/admin/packages"), read<{ orders: Order[] }>("/v1/admin/orders"), read<{ settings: Setting[] }>("/v1/admin/settings"), read<{ ledger: Ledger[] }>("/v1/admin/ledger"),
      ]);
      const [auditResponse, contentResponse] = await Promise.all([read<{ audits: Audit[] }>("/v1/admin/audits"), read<{ content: Record<string, string> }>("/v1/admin/content")]);
      setAudits(auditResponse.audits); setContent(contentResponse.content);
      setData({ metrics, users: users.users, packages: packages.packages, orders: orders.orders, settings: settings.settings, ledger: ledger.ledger });
      setAccess("ready");
    } catch (cause) {
      setAccess(cause instanceof ApiError ? cause.status === 401 ? "login" : cause.status === 403 || cause.status === 404 ? "forbidden" : "error" : "error");
      say(readableError(cause, language), true);
    } finally { setBusy(false); }
  }, [language]);
  useEffect(() => { void load(); }, [load]);
  const run = async (action: () => Promise<void>) => { if (busyGuard.current) return; busyGuard.current = true; setBusy(true); setRetryAction(null); say(""); try { await action(); } catch (cause) { if (!(cause instanceof ApiError) || cause.status >= 500) setRetryAction(() => action); if (cause instanceof ApiError && cause.status === 401) { setData(null); setAccess(cause.status === 401 ? "login" : "forbidden"); } say(readableError(cause, language), true); } finally { busyGuard.current = false; setBusy(false); } };
  const securityWrite = async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
    if (busyGuard.current) throw new Error(t("请等待当前操作完成。", "Wait for the current operation."));
    busyGuard.current = true; setBusy(true);
    try { return await write<T>(path, body); }
    finally { busyGuard.current = false; setBusy(false); }
  };
  async function refresh() { await load(); }
  async function searchUsers(event: FormEvent) { event.preventDefault(); await run(async () => { const response = await read<{ users: User[] }>(`/v1/admin/users?${new URLSearchParams({q:search,paid:paidFilter,...(registeredFrom?{registeredFrom:String(new Date(registeredFrom+"T00:00:00").getTime())}:{}),...(registeredTo?{registeredTo:String(new Date(registeredTo+"T00:00:00").getTime()+86400000-1)}:{}),...(activeSince?{activeSince:String(new Date(activeSince+"T00:00:00").getTime())}:{})})}`); setData(previous => previous && { ...previous, users: response.users }); }); }
  function freeze(user: User) {
    const next = user.status === "frozen" ? "active" : "frozen";
    setConfirm({ title: next === "frozen" ? t("冻结账户", "Freeze account") : t("解冻账户", "Unfreeze account"), description: `${user.email} · ${next === "frozen" ? t("此用户将无法继续使用账户。", "This user will lose account access.") : t("此用户将重新获得账户访问权限。", "This user will regain account access.")}`, action: async () => { await write(`/v1/admin/users/${user.id}/status`, { status: next }); await refresh(); } });
  }
  function adjust(event: FormEvent) {
    event.preventDefault();
    const delta = Number(adjustDelta);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000 || adjustReason.trim().length < 8) { say(t("请输入非零整数次数，并填写至少 8 字的原因。", "Enter a nonzero integer and a reason of at least 8 characters."), true); return; }
    setConfirm({ title: t("确认调整额度", "Confirm credit adjustment"), description: `${t("用户", "User")} ${adjustUser} · ${adjustKind === "free" ? t("免费", "Free") : t("付费", "Paid")} ${delta > 0 ? "+" : ""}${delta} · ${adjustReason}`, action: async () => { await write(`/v1/admin/users/${encodeURIComponent(adjustUser)}/credits`, { kind: adjustKind, delta, reason: adjustReason.trim(), confirm: true }); setAdjustDelta(""); setAdjustReason(""); await refresh(); } });
  }
  function saveSetting(setting: Setting, value: string) { setConfirm({ title: t("确认修改系统设置", "Confirm setting change"), description: `${setting.key}: ${setting.value} → ${value}`, action: async () => { await write(`/v1/admin/settings/${setting.key}`, { value }); await refresh(); } }); }

  async function exportCsv(type: "users" | "orders", ids: string[]) {
    if (!ids.length) return; const response = await fetch(`${API_BASE}/v1/admin/export?${new URLSearchParams({type,ids:ids.join(",")})}`, {credentials:"include"});
    if (!response.ok) throw new Error(t("导出失败，请重新登录后重试", "Export failed. Sign in and retry."));
    const url = URL.createObjectURL(await response.blob()); const link=document.createElement("a"); link.href=url; link.download=`${type}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="space-y-6">
    {access !== "ready" && <Card className="max-w-3xl"><CardHeader><CardTitle>{access === "loading" ? t("正在加载管理后台", "Loading admin dashboard") : access === "login" ? t("请先登录", "Please sign in") : access === "forbidden" ? t("无法访问管理后台", "Admin access denied") : t("管理后台暂时不可用", "Admin dashboard unavailable")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{access === "login" ? t("请使用已开通管理员权限的官网账户登录。", "Sign in with your admin account.") : access === "forbidden" ? t("当前账户没有管理员权限，或管理入口尚未开放。", "This account is not an administrator, or the admin portal is closed.") : notice || t("正在检查登录状态和权限。", "Checking your session and permissions.")}</p>{notice && access !== "loading" && <Alert variant={error ? "destructive" : "default"} role="status"><AlertDescription>{notice}</AlertDescription></Alert>}{access === "login" && <Button asChild><a href="/login?mode=login">{t("前往登录", "Go to sign in")}</a></Button>}{access === "error" && <Button variant="outline" disabled={busy} onClick={() => void load()}>{t("重试", "Retry")}</Button>}</CardContent></Card>}
    {access === "ready" && notice && <Alert variant={error ? "destructive" : "default"} role="status"><AlertDescription>{notice}{retryAction && <Button className="ml-3" variant="outline" disabled={busy} onClick={() => void run(retryAction)}>{t("重试原操作", "Retry original operation")}</Button>}</AlertDescription></Alert>}
    {data && <Tabs value={tab} onValueChange={value => { setTab(value); if (value === "cost") void refresh(); }} className="space-y-6"><TabsList className="h-auto flex-wrap justify-start">{[["overview", t("概览", "Overview")], ["users", t("用户管理", "Users")], ["campaigns", t("福利发放", "Campaigns")], ["security", t("账号与支付开关", "Security & payment")], ["ledger", t("额度流水", "Credit ledger")], ["orders", t("订单", "Orders")], ["packages", t("套餐", "Packages")], ["cost", t("AI 成本", "AI cost")], ["ai-models", t("AI 模型管理", "AI models")], ["creator", t("创作者功能", "Creator features")], ["settings", t("设置", "Settings")], ["content", t("网站内容", "Site content")], ["audits", t("审计", "Audit log")]].map(([value, label]) => <TabsTrigger key={value} value={value} disabled={busy}>{label}</TabsTrigger>)}</TabsList>
      <TabsContent value="overview"><div className="mb-5 flex flex-wrap gap-2">{[["users","搜索用户"],["campaigns","赠送额度"],["packages","修改套餐"],["content","编辑官网"],["security","开关支付"],["orders","查看订单"]].map(([value,label])=><Button key={value} variant="outline" onClick={()=>setTab(value)}>{label}</Button>)}</div><div className="flex items-center justify-between mb-4"><h2 className="text-2xl font-semibold">{t("运营概览", "Operations overview")}</h2><Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />{t("刷新", "Refresh")}</Button></div><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[["newUsers7d", t("最近 7 天新增", "New users in 7 days")], ["revenue7dFen", t("最近 7 天收入（人民币）", "Revenue in 7 days (CNY)")], ["activeUsers", t("活跃用户", "Active users")], ["paidUsers", t("付费用户", "Paid users")], ["successfulOrders", t("成功订单", "Successful orders")], ["totalRevenueFen", t("累计收款（人民币）", "Total revenue (CNY)")], ["totalIssued", t("累计发放", "Credits issued")], ["totalUsed", t("累计使用", "Credits used")], ["users", t("用户总数", "Users")], ["verifiedUsers", t("已验证用户", "Verified")], ["todayUsers", t("今日新增", "New today")], ["todayGenerations", t("今日生成", "Generations today")], ["monthGenerations", t("本月生成", "Generations this month")], ["totalFreeGranted", t("免费额度发放", "Free credits granted")], ["abnormalRequests", t("异常请求", "Abnormal requests")], ["monthRevenueFen", t("本月净收款 CNY", "Net payments this month (CNY)")]].map(([key, label]) => <Metric key={key} label={label} value={(key === "monthRevenueFen" || key === "totalRevenueFen" || key === "revenue7dFen") ? `¥${(Number(data.metrics[key] || 0) / 100).toFixed(2)}` : String(data.metrics[key] ?? "—")} />)}</div><p className="mt-3 text-sm text-muted-foreground">{t("活跃用户：当前持有未过期官网或插件会话的去重用户数。", "Active users: distinct users with a currently valid website or extension session.")}</p><div className="mt-6 grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>{t("最近订单", "Recent orders")}</CardTitle></CardHeader><CardContent>{data.orders.slice(0, 5).map(order => <div key={order.id} className="border-b py-3 text-sm last:border-0"><p className="font-medium">{order.email} · {order.package_name}</p><p className="text-muted-foreground">{date(order.created_at, language)} · {statusText(order.payment_status || order.status, language)} · {order.amount_fen == null ? dollars(order.amount_cents) : `¥${(order.amount_fen / 100).toFixed(2)}`}</p><p className="break-all text-xs text-muted-foreground">{order.id}</p></div>)}{!data.orders.length && <Empty text={t("暂无订单。", "No orders yet.")} />}</CardContent></Card><Card><CardHeader><CardTitle>{t("最近操作", "Recent admin activity")}</CardTitle></CardHeader><CardContent>{audits.slice(0, 5).map(item => <div key={item.id} className="border-b py-3 text-sm last:border-0"><p className="font-medium">{item.action} · {item.target_id || "—"}</p><p>{item.reason || "—"}</p><p className="text-xs text-muted-foreground">{date(item.created_at, language)}</p></div>)}{!audits.length && <Empty text={t("暂无管理操作。", "No admin activity yet.")} />}</CardContent></Card></div></TabsContent>
      <TabsContent value="users" className="space-y-5"><Card><CardHeader><CardTitle>{t("用户管理", "Users")}</CardTitle></CardHeader><CardContent><form className="mb-5 flex flex-wrap gap-2" onSubmit={event => void searchUsers(event)}><Input aria-label={t("搜索 ID、用户名或邮箱", "Search ID, username or email")} placeholder={t("搜索 ID、用户名或邮箱", "Search ID, username or email")} value={search} onChange={event => setSearch(event.target.value)} /><Button variant="outline" disabled={busy}><Search size={15} />{t("搜索", "Search")}</Button></form><div className="mb-4 grid gap-3 sm:grid-cols-4"><Field label="付费状态"><select className="h-9 rounded border px-2" value={paidFilter} onChange={e=>setPaidFilter(e.target.value)}><option value="all">全部</option><option value="paid">已付费</option><option value="unpaid">未付费</option></select></Field><Field label="注册日期从"><Input type="date" value={registeredFrom} onChange={e=>setRegisteredFrom(e.target.value)}/></Field><Field label="注册日期至"><Input type="date" value={registeredTo} onChange={e=>setRegisteredTo(e.target.value)}/></Field><Field label="最近活跃起始日期"><Input type="date" value={activeSince} onChange={e=>setActiveSince(e.target.value)}/></Field></div><p className="mb-3 text-xs text-muted-foreground">设置筛选后点击搜索。活跃以会话创建、AI 请求或支付成功时间计算。</p><div className="mb-4 flex flex-wrap gap-2"><Button disabled={busy||!selected.length} variant="outline" onClick={()=>void run(()=>exportCsv("users",selected))}>导出所选用户 CSV</Button><Button disabled={busy || !selected.length} variant="outline" onClick={() => setConfirm({title: t("批量冻结", "Freeze selected"), description: selected.join(", "), action: async () => { await write("/v1/admin/users/bulk-status", {userIds: selected, status: "frozen"}); setSelected([]); await refresh(); }})}>{t("批量冻结", "Freeze selected")}</Button><Button disabled={busy || !selected.length} variant="outline" onClick={() => setConfirm({title: t("批量恢复", "Restore selected"), description: selected.join(", "), action: async () => { await write("/v1/admin/users/bulk-status", {userIds: selected, status: "active"}); setSelected([]); await refresh(); }})}>{t("批量恢复", "Restore selected")}</Button></div><div className="data-table-wrap admin-list-scroll"><Table><TableHeader><TableRow>{[t("用户", "User"), t("状态", "Status"), t("免费", "Free"), t("付费", "Paid"), t("已生成", "Generated"), t("操作", "Action")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.users.map(user => <TableRow key={user.id}><TableCell><input aria-label={`Select ${user.email}`} type="checkbox" checked={selected.includes(user.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, user.id] : ids.filter(id => id !== user.id))} /> <strong>{user.username || t("旧账户", "Legacy user")}</strong><div className="text-xs text-muted-foreground">{user.email}</div><div className="text-xs text-muted-foreground">ID {user.id}{user.is_test_account ? t(" · 测试账户", " · Test account") : ""}{user.archived_at ? t(" · 已归档", " · Archived") : ""}</div></TableCell><TableCell><Badge variant={user.status === "active" ? "secondary" : "destructive"}>{statusText(user.status, language)}</Badge></TableCell><TableCell>{user.free_balance}</TableCell><TableCell>{user.paid_balance}</TableCell><TableCell>{user.generations}<div className="mt-1 text-xs text-muted-foreground">{t("注册日期", "Registered")}: {user.created_at?date(user.created_at,language):"—"}</div><div className="text-xs text-muted-foreground">{t("最近活动", "Last active")}: {user.last_active_at?date(user.last_active_at,language):"—"}</div></TableCell><TableCell><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => setDetail(await read<UserDetail>(`/v1/admin/users/${encodeURIComponent(user.id)}`)))}>{t("详情", "Details")}</Button> <Button size="sm" variant="outline" disabled={busy} onClick={() => freeze(user)}>{user.status === "frozen" ? t("解冻", "Unfreeze") : t("冻结", "Freeze")}</Button></TableCell></TableRow>)}</TableBody></Table></div>{!data.users.length && <Empty text={t("没有匹配账户。", "No matching users.")} />}</CardContent></Card><Card><CardHeader><CardTitle>{t("额度调整", "Adjust credits")}</CardTitle></CardHeader><CardContent><form className="grid grid-cols-2 gap-4 lg:grid-cols-4" onSubmit={adjust}><Field label={t("用户 ID", "User ID")}><Input required value={adjustUser} onChange={event => setAdjustUser(event.target.value)} /></Field><Field label={t("额度类型", "Credit type")}><select className="h-9 rounded-md border border-input bg-white px-3 text-sm" value={adjustKind} onChange={event => setAdjustKind(event.target.value)}><option value="free">{t("免费", "Free")}</option><option value="paid">{t("付费", "Paid")}</option></select></Field><Field label={t("调整次数，可填负数", "Amount, negative allowed")}><Input type="number" required min={-10000} max={10000} value={adjustDelta} onChange={event => setAdjustDelta(event.target.value)} /></Field><Field label={t("原因，至少 8 字", "Reason, at least 8 characters")}><Input required minLength={8} maxLength={500} value={adjustReason} onChange={event => setAdjustReason(event.target.value)} /></Field><Button className="col-span-2 lg:col-span-4 w-fit" disabled={busy}>{t("预览并确认调整", "Review adjustment")}</Button></form></CardContent></Card></TabsContent>
      <TabsContent value="ledger"><Card><CardHeader><CardTitle>{t("最近额度流水", "Recent credit ledger")}</CardTitle></CardHeader><CardContent><div className="data-table-wrap admin-list-scroll"><Table><TableHeader><TableRow>{[t("时间", "Time"), t("用户", "User"), t("类型", "Type"), t("免费变化", "Free delta"), t("付费变化", "Paid delta"), t("原因", "Reason")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.ledger.map(item => <TableRow key={item.id}><TableCell>{date(item.created_at, language)}</TableCell><TableCell>{item.email}</TableCell><TableCell>{ledgerText(item.kind, language)}</TableCell><TableCell>{item.free_delta}</TableCell><TableCell>{item.paid_delta}</TableCell><TableCell>{item.reason || "—"}</TableCell></TableRow>)}</TableBody></Table></div>{!data.ledger.length && <Empty text={t("暂无流水。", "No activity yet.")} />}</CardContent></Card></TabsContent>
      <TabsContent value="orders"><Card><CardHeader><CardTitle>{t("充值订单", "Top-up orders")}</CardTitle></CardHeader><CardContent><form className="mb-4 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void run(async()=>{const result=await read<{orders:Order[]}>(`/v1/admin/orders?${new URLSearchParams({q:orderSearch,status:orderStatus})}`);setData(previous=>previous&&({...previous,orders:result.orders}));});}}><Input aria-label="搜索订单号或邮箱" placeholder="搜索订单号或邮箱" value={orderSearch} onChange={e=>setOrderSearch(e.target.value)}/><select aria-label="订单状态" className="h-9 rounded border px-2" value={orderStatus} onChange={e=>setOrderStatus(e.target.value)}>{[["","全部状态"],["paid","支付成功"],["pending","待支付"],["failed","失败"],["unknown","待确认"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><Button variant="outline" disabled={busy}>查询订单</Button><Button type="button" variant="outline" disabled={busy||!selectedOrders.length} onClick={()=>void run(()=>exportCsv("orders",selectedOrders))}>导出所选订单 CSV</Button></form><p className="mb-4 text-sm text-muted-foreground">{t("订单状态来自服务端支付记录；只有验证通过的支付结果才会发放额度。", "Order state comes from server-verified payment records; only verified payments grant credits.")}</p><div className="data-table-wrap admin-list-scroll"><Table><TableHeader><TableRow>{[t("订单号", "Order ID"), t("用户", "User"), t("套餐", "Package"), t("美元参考价", "USD reference"), t("实际人民币", "CNY amount"), t("渠道", "Provider"), t("支付状态", "Payment status"), t("额度", "Credits")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.orders.map(order => <TableRow key={order.id}><TableCell className="max-w-44 break-all text-xs"><input aria-label={`选择订单 ${order.id}`} type="checkbox" checked={selectedOrders.includes(order.id)} onChange={e=>setSelectedOrders(ids=>e.target.checked?[...ids,order.id]:ids.filter(id=>id!==order.id))}/><Button variant="link" size="sm" className="h-auto break-all whitespace-normal text-left" disabled={busy} onClick={()=>void run(async()=>setOrderDetail(await read(`/v1/admin/orders/${encodeURIComponent(order.id)}`)))}>{order.id}</Button></TableCell><TableCell>{order.email}</TableCell><TableCell>{order.package_name} · {order.credits}</TableCell><TableCell>{dollars(order.amount_cents)}</TableCell><TableCell>{order.amount_fen == null ? "—" : `¥${(order.amount_fen / 100).toFixed(2)} ${order.payment_currency||"CNY"}`}</TableCell><TableCell>{order.provider === "local_mock" ? t("本地模拟", "Local mock") : order.provider === "xiaodou" ? t("小豆", "Xiaodou") : "—"}</TableCell><TableCell><Badge variant="secondary">{statusText(order.payment_status || order.status, language)}</Badge></TableCell><TableCell>{order.credited_at ? t("已发放", "Granted") : t("未发放", "Not granted")}</TableCell></TableRow>)}</TableBody></Table></div>{!data.orders.length && <Empty text={t("暂无订单。", "No orders yet.")} />}</CardContent></Card></TabsContent>
      <TabsContent value="packages"><Card><CardHeader><CardTitle>{t("套餐管理", "Packages")}</CardTitle><Button className="w-fit" onClick={() => { setCreating(true); setEditing({id: "", name_zh: "", name_en: "", credits: 100, price_cents: 100, promo_price_cents: null, price_cny_fen: 700, sort_order: 0, active: 0}); }}>{t("新增套餐", "New package")}</Button></CardHeader><CardContent><div className="data-table-wrap"><Table><TableHeader><TableRow>{[t("套餐", "Package"), t("次数", "Credits"), t("美元参考价", "USD reference"), t("实际人民币", "CNY price"), t("状态", "Status"), t("操作", "Action")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.packages.map(item => <TableRow key={item.id}><TableCell>{item.name_zh}<div className="text-xs text-muted-foreground">{item.id}</div></TableCell><TableCell>{item.credits}</TableCell><TableCell>{dollars(item.price_cents)}</TableCell><TableCell>{item.price_cny_fen == null ? "—" : `¥${(item.price_cny_fen / 100).toFixed(2)}`}</TableCell><TableCell>{item.active ? t("上架", "Active") : t("下架", "Inactive")}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => { setCreating(false); setEditing(item); }}>{t("编辑", "Edit")}</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="cost"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-semibold">{t("AI 成本", "AI cost")}</h2><Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />{t("刷新", "Refresh")}</Button></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label={t("AI 服务", "AI service")} value={data.metrics.aiService?.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")} />
        <Metric label={t("Provider / 模型", "Provider / model")} value={`${data.metrics.aiService?.provider || "—"} / ${data.metrics.aiService?.model || "—"}`} />
        <Metric label={t("服务端密钥", "Server secret")} value={data.metrics.aiService?.keyConfigured ? t("已配置", "Configured") : t("未配置", "Not configured")} />
        <Metric label={t("今日输入 Token", "Input tokens today")} value={String(data.metrics.todayCost?.inputTokens ?? "—")} />
        <Metric label={t("今日输出 Token", "Output tokens today")} value={String(data.metrics.todayCost?.outputTokens ?? "—")} />
        <Metric label={t("本月输入 Token", "Input tokens this month")} value={String(data.metrics.cost?.inputTokens ?? "—")} />
        <Metric label={t("本月输出 Token", "Output tokens this month")} value={String(data.metrics.cost?.outputTokens ?? "—")} />
        <Metric label={t("本月估算成本", "Estimated cost this month")} value={microDollars(data.metrics.cost?.costMicroUsd)} />
        <Metric label={t("今日已结算成本", "Settled today")} value={microDollars(data.metrics.dailyCostMicroUsd)} />
        <Metric label={t("生成中预算预留", "In-flight reservation")} value={microDollars(data.metrics.reservedCostMicroUsd)} />
        <Metric label={t("每日预算上限（UTC）", "Daily budget (UTC)")} value={microDollars(data.metrics.budgetLimitMicroUsd)} />
        <Metric label={t("剩余可用成本预算", "Remaining cost budget")} value={microDollars(data.metrics.remainingBudgetMicroUsd)} />
        <Metric label={t("预算已占用", "Budget committed")} value={data.metrics.budgetUsedPercent == null ? "—" : `${data.metrics.budgetUsedPercent}%`} />
        <Metric label={t("今日失败请求", "Failed requests today")} value={String(data.metrics.abnormalRequests ?? "—")} />
      </div><Alert className="mt-4"><AlertDescription>{data.metrics.circuitOpen ? t("预算熔断已触发。", "Budget circuit breaker is active.") : data.metrics.costWarning ? t("已接近预算上限。", "Approaching the budget limit.") : t("预算状态正常。", "Budget is healthy.")}</AlertDescription></Alert><p className="mt-3 text-sm text-muted-foreground">{t("预算由系统设置即时生效，按 UTC 日统计，已扣除生成中的预留；成本为保守估算值。", "Budget settings apply immediately on UTC days, including in-flight reservations. Costs are conservative estimates.")}</p><p className="mt-2 text-sm text-muted-foreground">{t("Token 与成本汇总包含所有模型；管理员模型测试也计入每日预算，预留费用尚未计入模型已结算明细。", "Token and cost totals cover all models. Admin model tests also count toward the daily budget; reservations are not yet included in settled model details.")}</p><AiCostBreakdown rows={data.metrics.costByModel || []} language={language} /></TabsContent>
      <TabsContent value="creator"><CreatorFeaturesPanel language={language} active={tab==="creator"} busy={busy} read={read} write={write} confirm={(title,description,action)=>setConfirm({title,description,action})}/></TabsContent>
      <TabsContent value="ai-models"><AIModelManagementPanel language={language} busy={busy} read={read} write={write} refresh={refresh} confirm={(title,description,action)=>setConfirm({title,description,action})}/></TabsContent>
      <TabsContent value="settings"><Card><CardHeader><CardTitle>{t("系统设置", "System settings")}</CardTitle></CardHeader><CardContent className="space-y-4">{data.settings.filter(item => item.key !== "announcement").map(item => <SettingRow key={item.key} setting={item} language={language} onSave={value => saveSetting(item, value)} />)}</CardContent></Card></TabsContent>
      <TabsContent value="campaigns"><CampaignPanel busy={busy} write={write} selected={selected} run={run} confirm={(title,description,action)=>setConfirm({title,description,action})}/></TabsContent>
      <TabsContent value="security"><SecurityPaymentPanel language={language} busy={busy} read={read} write={securityWrite}/></TabsContent>
      <TabsContent value="content"><SiteEditor content={content} pending={busy} language={language} loadHistory={()=>read("/v1/admin/content/history")} onSave={next=>setConfirm({title:"保存网站装修",description:"公开文案与导航保存后立即生效。",action:async()=>{await write("/v1/admin/content",{content:next});await refresh();}})} onRestore={versionId=>setConfirm({title:"恢复网站版本",description:"将选中的内容保存为一个新版本，历史记录继续保留。",action:async()=>{await write("/v1/admin/content/restore",{versionId});await refresh();}})}/></TabsContent>
      <TabsContent value="audits"><Card><CardHeader><CardTitle>{t("操作审计", "Operation audit")}</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow>{[t("时间", "Time"), t("操作", "Action"), t("对象", "Target"), t("原因", "Reason"), t("操作编号", "Operation ID")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{audits.map(a => <TableRow key={a.id}><TableCell>{date(a.created_at, language)}</TableCell><TableCell>{a.action}</TableCell><TableCell>{a.target_id || "—"}</TableCell><TableCell>{a.reason}</TableCell><TableCell className="break-all">{a.operation_id || a.id}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
    </Tabs>}
    <AlertDialog open={Boolean(confirm)} onOpenChange={open => { if (!open) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription className="break-all">{confirm?.description}</AlertDialogDescription></AlertDialogHeader><Field label={t("操作原因（至少 8 字）", "Reason (at least 8 characters)")}><Input value={reason} minLength={8} maxLength={500} onChange={e => setReason(e.target.value)} /></Field><AlertDialogFooter><AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy || reason.trim().length < 8} onClick={event => { event.preventDefault(); const action = confirm?.action; reasonRef.current = reason.trim(); setConfirm(null); if (action) void run(action); }}>{t("确认操作", "Confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}>{editing && <PackageEditor creating={creating} item={editing} language={language} pending={busy} onCancel={() => setEditing(null)} onSave={body => { const item = editing; setEditing(null); setConfirm({ title: t("确认修改套餐", "Confirm package update"), description: `${item.id} · ${t("已有订单价格不会变化。", "Existing order prices will not change.")}`, action: async () => { await write(creating ? "/v1/admin/packages" : `/v1/admin/packages/${encodeURIComponent(item.id)}`, body); await refresh(); } }); }} />}</Dialog>
    <Dialog open={reauthOpen} onOpenChange={open => { if (!open) {setReauthOpen(false); setPassword(""); setReauthError(""); reauthResolver.current?.(false); reauthResolver.current = null;} }}><DialogContent><DialogHeader><DialogTitle>{t("验证管理员密码", "Verify admin password")}</DialogTitle><DialogDescription>{t("敏感操作需要重新验证密码。", "Verify your password to continue this operation.")}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={async e => {e.preventDefault(); if (reauthBusy.current) return; reauthBusy.current = true; const resolve = reauthResolver.current; setReauthPending(true); setReauthError(""); try {await api("/v1/admin/reauth", {method: "POST", body: JSON.stringify({password})}); if (reauthResolver.current === resolve) {setPassword(""); setReauthOpen(false); resolve?.(true); reauthResolver.current = null;}} catch (cause) {if (reauthResolver.current === resolve) setReauthError(readableError(cause, language));} finally {reauthBusy.current = false; setReauthPending(false);} }}><Input autoFocus type="password" autoComplete="current-password" aria-label={t("管理员密码", "Admin password")} value={password} onChange={e => setPassword(e.target.value)} required /><Button disabled={reauthPending}>{t("验证并继续", "Verify and continue")}</Button><Button type="button" variant="outline" onClick={() => {setReauthOpen(false); setPassword(""); reauthResolver.current?.(false); reauthResolver.current = null;}}>{t("取消", "Cancel")}</Button>{reauthError && <Alert variant="destructive"><AlertDescription>{reauthError}</AlertDescription></Alert>}</form></DialogContent></Dialog>
    <Dialog open={Boolean(orderDetail)} onOpenChange={open=>{if(!open)setOrderDetail(null);}}><DialogContent className="max-w-3xl max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle>订单与支付通知</DialogTitle><DialogDescription>{orderDetail?.order?.id}</DialogDescription></DialogHeader>{orderDetail&&<div className="space-y-4"><p>{orderDetail.order.email} · {orderDetail.order.package_name}</p><p>支付状态：{statusText(orderDetail.order.payment_status||orderDetail.order.status,language)} · 额度：{orderDetail.order.credited_at?"已发放":"未发放"}</p><p>创建：{date(orderDetail.order.created_at,language)} · 到账：{orderDetail.order.credited_at?date(orderDetail.order.credited_at,language):"—"}</p><p className="text-sm text-muted-foreground">仅可信支付状态可作为补发依据。支付查证请通过平台后台与客服核实。</p><h3 className="font-semibold">支付通知及处理结果</h3>{(orderDetail.events||[]).map((event:any,index:number)=><div className="rounded border p-3 text-sm" key={event.id||index}><p>{event.event_type||event.type||"支付通知"} · {event.status||event.outcome||event.result||"已记录"}</p><p>{event.error_code||event.error||"—"}</p><p>{event.created_at?date(event.created_at,language):"—"}</p></div>)}{!orderDetail.events?.length&&<p>暂无支付通知</p>}<h3 className="font-semibold">支付尝试与错误</h3>{(orderDetail.attempts||[]).map((attempt:any,index:number)=><div className="rounded border p-3 text-sm" key={attempt.id||index}><p>{attempt.status?statusText(attempt.status,language):"已记录"} · {attempt.error_code||attempt.failure_code||"无错误码"}</p><p>{attempt.created_at?date(attempt.created_at,language):"—"}</p></div>)}{!orderDetail.attempts?.length&&<p>暂无支付尝试记录</p>}</div>}</DialogContent></Dialog>
    <Dialog open={Boolean(detail)} onOpenChange={open => { if (!open) setDetail(null); }}>
      <DialogContent
        className="flex h-[min(90dvh,860px)] w-[calc(100vw-2rem)] !max-w-[1040px] min-w-0 flex-col gap-0 overflow-hidden p-0"
        closeLabel={t("关闭用户详情", "Close user details")}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:pl-6 sm:pr-14">
          <DialogTitle className="!text-lg !leading-7 !tracking-normal">{t("用户详情", "User details")}</DialogTitle>
          <DialogDescription className="min-w-0 space-y-1 text-left">
            <span className="block min-w-0 break-all font-medium text-foreground">{detail?.user.email}</span>
            <span className="block min-w-0 break-all text-xs">{t("用户 ID", "User ID")}: {detail?.user.id}</span>
          </DialogDescription>
        </DialogHeader>
        {detail && (
          <div
            data-testid="user-detail-body-scroll"
            role="region"
            aria-label={t("用户详情内容", "User detail content")}
            tabIndex={0}
            className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 sm:px-6"
          >
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => {
                const user = detail.user;
                setDetail(null);
                setConfirm({
                  title: t("标记测试账户", "Mark test account"),
                  description: user.email,
                  action: async () => {
                    await write(`/v1/admin/users/${encodeURIComponent(user.id)}/test-account`, { isTestAccount: true });
                    await refresh();
                  },
                });
              }}>{t("标记测试账户", "Mark test account")}</Button>
              <Button variant="outline" disabled={busy} onClick={() => {
                const user = detail.user;
                setDetail(null);
                setConfirm({
                  title: t("归档账户", "Archive account"),
                  description: t("先标记测试账户。仅无订单账户可以归档；在用户列表解冻可恢复归档账户。", "Mark as test first. Only accounts without orders can be archived; unfreeze in the user list to restore."),
                  action: async () => {
                    await write(`/v1/admin/users/${encodeURIComponent(user.id)}/archive`, {});
                    await refresh();
                  },
                });
              }}>{t("归档账户", "Archive account")}</Button>
            </div>
            <section className="min-w-0 space-y-3 rounded-lg border bg-card p-3 sm:p-4" aria-label={t("管理员内部备注", "Internal admin note")}>
              <Field label={t("管理员内部备注", "Internal admin note")}>
                <textarea
                  className="block min-h-24 w-full min-w-0 max-w-full resize-y rounded-md border p-3 text-sm"
                  maxLength={2000}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
              </Field>
              <Button disabled={busy} variant="outline" onClick={() => setConfirm({
                title: "保存内部备注",
                description: detail.user.email,
                action: async () => {
                  await write(`/v1/admin/users/${encodeURIComponent(detail.user.id)}/note`, { note });
                  say("备注已保存");
                },
              })}>{t("保存备注", "Save note")}</Button>
            </section>
            <UserDetailHistory detail={detail} language={language} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  </div>;
}

function UserDetailHistory({ detail, language }: { detail: UserDetail; language: Language }) {
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const quota = detail.quota && typeof detail.quota === "object" && !Array.isArray(detail.quota) ? detail.quota as Record<string, unknown> : {};
  const usage = Array.isArray(detail.usage) ? detail.usage.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
  const usageLabels: Record<string, [string, string]> = { succeeded: ["生成成功", "Succeeded"], completed: ["已完成", "Completed"], reserved: ["已预留额度", "Credits reserved"], processing: ["生成中", "Processing"], upstream_failed: ["生成失败", "Generation failed"], failed: ["失败", "Failed"], uncertain: ["结果待确认", "Awaiting confirmation"], refunded: ["已退还额度", "Credits refunded"] };
  return <div className="min-w-0 space-y-4">
    <div className="grid grid-cols-1 gap-1 text-sm text-muted-foreground sm:grid-cols-2">
      <p className="min-w-0 break-words">{t("注册日期", "Registered")}: {detail.user.created_at ? date(detail.user.created_at, language) : "—"}</p>
      <p className="min-w-0 break-words">{t("最近活动", "Last active")}: {detail.user.last_active_at ? date(detail.user.last_active_at, language) : "—"}</p>
    </div>
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
      {[
        ["freeRemaining", t("可用免费额度", "Free credits available")],
        ["paidRemaining", t("可用付费额度", "Paid credits available")],
        ["totalRemaining", t("可用总额度", "Total credits available")],
      ].map(([key, label]) => (
        <div key={key} className="min-w-0 rounded-lg border bg-card p-3 sm:p-4">
          <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
          <strong className="mt-1 block text-xl font-semibold tabular-nums sm:text-2xl">
            {typeof quota[key] === "number" ? String(quota[key]) : "—"}
          </strong>
        </div>
      ))}
    </div>
    <section className="min-w-0 space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 !text-base !leading-6 !tracking-normal font-semibold">{t("最近订单", "Recent orders")}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{detail.orders.length} {t("条", "records")}</span>
      </div>
      {detail.orders.length ? (
        <div data-testid="user-detail-orders-scroll" role="region" aria-label={t("最近订单记录", "Recent order records")} tabIndex={0}
          className="max-h-56 min-w-0 overflow-auto overscroll-contain rounded-md border [&_[data-slot=table-container]]:overflow-visible">
          <Table className="min-w-[540px]">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>{[t("套餐", "Package"), t("额度", "Credits"), t("状态", "Status"), t("时间", "Time")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>{detail.orders.map(order => <TableRow key={order.id}>
              <TableCell className="max-w-52 whitespace-normal break-words">{order.package_name}</TableCell>
              <TableCell className="tabular-nums">{order.credits}</TableCell>
              <TableCell>{statusText(order.status, language)}</TableCell>
              <TableCell>{date(order.created_at, language)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      ) : <Empty text={t("暂无订单。", "No orders yet.")} />}
    </section>
    <section className="min-w-0 space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 !text-base !leading-6 !tracking-normal font-semibold">{t("最近额度流水", "Recent credit activity")}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{detail.ledger.length} {t("条", "records")}</span>
      </div>
      {detail.ledger.length ? (
        <div data-testid="user-detail-ledger-scroll" role="region" aria-label={t("最近额度流水记录", "Recent credit activity records")} tabIndex={0}
          className="max-h-64 min-w-0 overflow-auto overscroll-contain rounded-md border [&_[data-slot=table-container]]:overflow-visible">
          <Table className="min-w-[720px]">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>{[t("类型", "Type"), t("免费变化", "Free change"), t("付费变化", "Paid change"), t("原因", "Reason"), t("时间", "Time")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>{detail.ledger.map(entry => <TableRow key={entry.id}>
              <TableCell>{ledgerText(entry.kind, language)}</TableCell>
              <TableCell className="tabular-nums">{entry.free_delta > 0 ? "+" : ""}{entry.free_delta}</TableCell>
              <TableCell className="tabular-nums">{entry.paid_delta > 0 ? "+" : ""}{entry.paid_delta}</TableCell>
              <TableCell className="max-w-64 whitespace-normal break-words">{entry.reason || "—"}</TableCell>
              <TableCell>{date(entry.created_at, language)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      ) : <Empty text={t("暂无额度流水。", "No credit activity yet.")} />}
    </section>
    <section className="min-w-0 space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 !text-base !leading-6 !tracking-normal font-semibold">{t("最近 AI 使用", "Recent AI usage")}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{usage.length} {t("条", "records")}</span>
      </div>
      {usage.length ? (
        <div data-testid="user-detail-usage-scroll" role="region" aria-label={t("最近 AI 使用记录", "Recent AI usage records")} tabIndex={0}
          className="max-h-52 min-w-0 overflow-y-auto overscroll-contain rounded-md border px-3">
          <ul className="divide-y">{usage.map((entry, index) => <li key={typeof entry.id === "string" ? entry.id : index}
            className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2 text-sm">
            <span>{typeof entry.status === "string" ? usageLabels[entry.status] ? t(...usageLabels[entry.status]) : statusText(entry.status, language) : "—"}</span>
            <span className="text-xs text-muted-foreground">{typeof entry.created_at === "number" ? date(entry.created_at, language) : "—"}</span>
          </li>)}</ul>
        </div>
      ) : <Empty text={t("暂无 AI 使用记录。", "No AI usage yet.")} />}
    </section>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <Label className="grid gap-2 text-sm font-medium"><span>{label}</span>{children}</Label>; }
function Metric({ label, value }: { label: string; value: string }) { return <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><strong className="mt-2 block text-2xl font-semibold">{value}</strong></CardContent></Card>; }
function Empty({ text }: { text: string }) { return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>; }
function date(value: number, language: Language) { return new Date(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US"); }
function SettingRow({ setting, language, onSave }: { setting: Setting; language: Language; onSave: (value: string) => void }) { const [value, setValue] = useState(setting.value); useEffect(() => setValue(setting.value), [setting.value]); return <div className="grid grid-cols-[1fr_2fr_auto] items-end gap-3"><Field label={settingText(setting.key, language)}><Input aria-label={setting.key} value={value} onChange={event => setValue(event.target.value)} /></Field><p className="pb-2 text-xs text-muted-foreground">{setting.key === "daily_cost_limit_micro_usd" ? phrase(language, "单位：百万分之一美元", "Unit: micro USD") : ""}</p><Button variant="outline" disabled={value === setting.value} onClick={() => onSave(value)}>{phrase(language, "保存", "Save")}</Button></div>; }
function PackageEditor({ creating, item, language, pending, onCancel, onSave }: { creating: boolean; item: Package; language: Language; pending: boolean; onCancel: () => void; onSave: (body: object) => void }) {
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [nameZh, setNameZh] = useState(item.name_zh), [nameEn, setNameEn] = useState(item.name_en);
  const [credits, setCredits] = useState(String(item.credits)), [price, setPrice] = useState((item.price_cents / 100).toFixed(2));
  const [promo, setPromo] = useState(item.promo_price_cents === null ? "" : (item.promo_price_cents / 100).toFixed(2));
  const [priceCny, setPriceCny] = useState(item.price_cny_fen === null ? "" : (item.price_cny_fen / 100).toFixed(2));
  const [sort, setSort] = useState(String(item.sort_order)), [active, setActive] = useState(Boolean(item.active));
  const [id, setId] = useState(item.id);
  const [descriptionZh, setDescriptionZh] = useState(item.description_zh || ""), [descriptionEn, setDescriptionEn] = useState(item.description_en || "");
  const [settlementMode, setSettlementMode] = useState(item.settlement_mode || "fixed_cny");
  const [exchangeRate, setExchangeRate] = useState(item.exchange_rate_micros ? String(item.exchange_rate_micros / 1000000) : "");
  const [feeRate, setFeeRate] = useState(String(item.fee_rate_bps ?? 150));
  const [recommendedLabelZh,setRecommendedLabelZh]=useState(item.recommended_label_zh || ""), [recommendedLabelEn,setRecommendedLabelEn]=useState(item.recommended_label_en || ""), [featured,setFeatured]=useState(Boolean(item.featured));
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(price) || promo && !/^\d+(\.\d{1,2})?$/.test(promo) || priceCny && !/^\d+(\.\d{1,2})?$/.test(priceCny)) { setError(t("请使用最多两位小数的美元或人民币金额。", "Enter USD or CNY amounts with up to two decimals.")); return; }
    const priceCents = Math.round(Number(price) * 100), promoPriceCents = promo === "" ? null : Math.round(Number(promo) * 100);
    if (promoPriceCents !== null && promoPriceCents > priceCents) { setError(t("促销价不能高于原价。", "Promo price cannot exceed the regular price.")); return; }
    const priceCnyFen = priceCny === "" ? null : Math.round(Number(priceCny) * 100);
    const exchangeRateMicros = exchangeRate === "" ? null : Math.round(Number(exchangeRate) * 1_000_000);
    if (settlementMode === "usd_exchange" && (!exchangeRateMicros || exchangeRateMicros <= 0) || !Number.isInteger(Number(feeRate)) || Number(feeRate) < 0 || Number(feeRate) > 3000) {setError(t("请填写有效汇率和 0–3000 基点手续费。", "Enter a valid exchange rate and fee of 0–3000 basis points.")); return;}
    onSave({ recommendedLabelZh, recommendedLabelEn, featured, ...(creating ? {id} : {}), descriptionZh, descriptionEn, settlementMode, exchangeRateMicros, feeRateBps: Number(feeRate), nameZh, nameEn, credits: Number(credits), priceCents, promoPriceCents, priceCnyFen, sortOrder: Number(sort), active });
  }
  return <DialogContent className="max-w-xl max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle>{t("编辑套餐", "Edit package")} · {item.id}</DialogTitle><DialogDescription>{t("价格由服务端保存；美元为参考展示价，人民币为支付宝实际收款金额。", "Prices are stored server-side. USD is a reference display price; CNY is the Alipay charge amount.")}</DialogDescription></DialogHeader><form className="grid grid-cols-2 gap-4" onSubmit={submit}>{creating && <Field label="ID"><Input required pattern="[a-zA-Z0-9_-]+" value={id} onChange={e => setId(e.target.value)} /></Field>}<Field label={t("中文描述", "Chinese description")}><Input value={descriptionZh} onChange={e => setDescriptionZh(e.target.value)} /></Field><Field label={t("英文描述", "English description")}><Input value={descriptionEn} onChange={e => setDescriptionEn(e.target.value)} /></Field><Field label={t("结算方式", "Settlement mode")}><select className="h-9 rounded border px-2" value={settlementMode} onChange={e => setSettlementMode(e.target.value)}><option value="fixed_cny">{t("固定人民币", "Fixed CNY")}</option><option value="usd_exchange">{t("美元按手动汇率", "USD with manual FX")}</option></select></Field><Field label={t("美元兑人民币汇率", "USD to CNY exchange rate")}><Input type="number" min="0.000001" step="0.000001" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} /></Field><Field label={t("手续费（基点，100=1%）", "Fee (basis points, 100=1%)")}><Input required type="number" min={0} max={3000} step={1} value={feeRate} onChange={e => setFeeRate(e.target.value)} /></Field><Field label={t("中文名称", "Chinese name")}><Input required value={nameZh} onChange={event => setNameZh(event.target.value)} /></Field><Field label={t("英文名称", "English name")}><Input required value={nameEn} onChange={event => setNameEn(event.target.value)} /></Field><Field label={t("生成次数", "Credits")}><Input required type="number" min={1} value={credits} onChange={event => setCredits(event.target.value)} /></Field><Field label={t("排序", "Sort order")}><Input required type="number" value={sort} onChange={event => setSort(event.target.value)} /></Field><Field label={t("美元参考价", "USD reference price")}><Input required inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></Field><Field label={t("美元促销价（可留空）", "USD promo price (optional)")}><Input inputMode="decimal" value={promo} onChange={event => setPromo(event.target.value)} /></Field><Field label={t("支付宝人民币价格", "Alipay price in CNY")}><Input inputMode="decimal" value={priceCny} onChange={event => setPriceCny(event.target.value)} placeholder="9.90" /></Field><Field label="中文推荐标签"><Input maxLength={40} value={recommendedLabelZh} onChange={e=>setRecommendedLabelZh(e.target.value)}/></Field><Field label="英文推荐标签"><Input maxLength={60} value={recommendedLabelEn} onChange={e=>setRecommendedLabelEn(e.target.value)}/></Field><Label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={featured} onChange={e=>setFeatured(e.target.checked)}/>首页突出显示</Label><Label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />{t("上架", "Active")}</Label><div className="col-span-2 rounded border p-4 space-y-2"><p className="text-xs text-muted-foreground">普通用户套餐预览</p><strong>{language==="zh"?nameZh:nameEn}</strong>{featured&&<Badge className="ml-2" variant="secondary">{(language==="zh"?recommendedLabelZh:recommendedLabelEn)||t("推荐","Recommended")}</Badge>}<p>{language==="zh"?descriptionZh:descriptionEn}</p><p>{dollars(Math.round(Number(promo||price||0)*100))} · {credits} {t("次 AI 回复","AI replies")}</p><p className="text-xs text-muted-foreground">{t("服务费率","Service fee rate")} {Number(feeRate)/100}% · {t("最终付款前显示人民币实付金额","Final CNY total shown before payment")}</p></div>{error && <Alert variant="destructive" className="col-span-2"><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter className="col-span-2"><Button variant="outline" type="button" onClick={onCancel}>{t("取消", "Cancel")}</Button><Button disabled={pending}>{t("预览并保存", "Review and save")}</Button></DialogFooter></form></DialogContent>;
}
