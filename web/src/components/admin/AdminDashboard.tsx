import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { api, ApiError } from "../../lib/api";
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

type User = { id: string; username: string | null; email: string; status: string; free_balance: number; paid_balance: number; generations: number; role: string };
type Package = { id: string; name_zh: string; name_en: string; credits: number; price_cents: number; promo_price_cents: number | null; sort_order: number; active: number };
type Order = { id: string; email: string; package_name: string; credits: number; amount_cents: number; fee_cents: number | null; status: string; credited_at: number | null; created_at: number };
type Ledger = { id: string; email: string; kind: string; free_delta: number; paid_delta: number; reason: string | null; created_at: number };
type Setting = { key: string; value: string };
type Metrics = Record<string, unknown> & { cost?: { inputTokens: number; outputTokens: number; costMicroUsd: number } };
type Dashboard = { metrics: Metrics; users: User[]; packages: Package[]; orders: Order[]; settings: Setting[]; ledger: Ledger[] };
type Confirm = { title: string; description: string; action: () => Promise<void> } | null;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const microDollars = (value: unknown) => `$${(Number(value || 0) / 1_000_000).toFixed(4)}`;
const statusText = (value: string, language: Language) => ({ active: phrase(language, "正常", "Active"), frozen: phrase(language, "已冻结", "Frozen"), pending: phrase(language, "待付款", "Pending"), paid: phrase(language, "已付款", "Paid") } as Record<string, string>)[value] || value;
const ledgerText = (value: string, language: Language) => ({ signup_grant: phrase(language, "注册赠送", "Welcome credits"), generation_debit: phrase(language, "AI 生成", "AI generation"), generation_refund: phrase(language, "失败返还", "Refund"), purchase_grant: phrase(language, "充值到账", "Top-up"), admin_adjustment: phrase(language, "人工调整", "Manual adjustment") } as Record<string, string>)[value] || value;
const settingText = (value: string, language: Language) => ({ signup_grant: phrase(language, "注册赠送次数", "Signup credits"), registration_enabled: phrase(language, "开放注册", "Registration enabled"), ai_enabled: phrase(language, "开放 AI 生成", "AI generation enabled"), daily_cost_limit_micro_usd: phrase(language, "每日 AI 成本上限", "Daily AI cost limit"), announcement: phrase(language, "公告", "Announcement") } as Record<string, string>)[value] || value;

export default function AdminDashboard() {
  const language = useLanguage();
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [data, setData] = useState<Dashboard | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState("");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState<Package | null>(null);
  const [adjustUser, setAdjustUser] = useState("");
  const [adjustKind, setAdjustKind] = useState("free");
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  useEffect(() => {
    if (!expiresAt || !token) return;
    const timer = window.setTimeout(() => { setToken(""); setExpiresAt(0); setData(null); setNotice(phrase(language, "管理员会话已过期，请重新验证。", "Admin session expired. Verify again.")); }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, token, language]);
  const say = (text: string, failed = false) => { setNotice(text); setError(failed); };
  const headers = (session = token) => ({ "X-Admin-Access": secret, "X-Admin-Session": session });
  const read = <T,>(path: string, session = token) => api<T>(path, { headers: headers(session) });
  const write = <T,>(path: string, body: object) => api<T>(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const challenge = <T,>(path: string, body: object) => api<T>(path, { method: "POST", headers: { "X-Admin-Access": secret }, body: JSON.stringify(body) });

  const load = useCallback(async (existingToken = token, existingExpiry = expiresAt) => {
    if (!secret.trim()) { say(t("请输入管理员安全口令。", "Enter your admin secret."), true); return; }
    setBusy(true); setData(null); say("");
    try {
      let session = existingToken;
      if (!session || Date.now() >= existingExpiry) {
        const elevated = await challenge<{ accessToken: string; expiresAt: number }>("/v1/admin/mfa/elevate", { code: code.trim() });
        session = elevated.accessToken; setToken(session); setExpiresAt(elevated.expiresAt); setCode("");
      }
      const [metrics, users, packages, orders, settings, ledger] = await Promise.all([
        read<Metrics>("/v1/admin/dashboard", session), read<{ users: User[] }>("/v1/admin/users", session), read<{ packages: Package[] }>("/v1/admin/packages", session), read<{ orders: Order[] }>("/v1/admin/orders", session), read<{ settings: Setting[] }>("/v1/admin/settings", session), read<{ ledger: Ledger[] }>("/v1/admin/ledger", session),
      ]);
      setData({ metrics, users: users.users, packages: packages.packages, orders: orders.orders, settings: settings.settings, ledger: ledger.ledger });
      say(t("后台数据已更新。", "Dashboard updated."));
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) { setToken(""); setExpiresAt(0); }
      say(readableError(cause, language), true);
    } finally { setBusy(false); }
  }, [token, expiresAt, secret, code, language]);
  const run = async (action: () => Promise<void>) => { setBusy(true); say(""); try { await action(); } catch (cause) { say(readableError(cause, language), true); } finally { setBusy(false); } };
  async function refresh() { await load(token, expiresAt); }
  async function searchUsers(event: FormEvent) { event.preventDefault(); await run(async () => { const response = await read<{ users: User[] }>(`/v1/admin/users?q=${encodeURIComponent(search)}`); setData(previous => previous && { ...previous, users: response.users }); }); }
  async function beginMfa() { await run(async () => { const result = await challenge<{ secret: string }>("/v1/admin/mfa/start", {}); setEnrollment(result.secret); say(t("请把密钥加入验证器，并在 10 分钟内确认绑定。不要截图或分享。", "Add this key to your authenticator and confirm within 10 minutes. Do not share it.")); }); }
  async function confirmMfa() { await run(async () => { await challenge("/v1/admin/mfa/confirm", { code: code.trim() }); setEnrollment(""); setCode(""); say(t("二次验证已启用。请等待下一组验证码后加载后台。", "MFA enabled. Wait for the next code, then load the dashboard.")); }); }
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

  return <div className="space-y-6">
    <Card className="max-w-3xl"><CardHeader><CardTitle>{t("管理员验证", "Admin verification")}</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-4"><Field label={t("安全口令", "Admin secret")}><Input type="password" autoComplete="off" value={secret} onChange={event => { setSecret(event.target.value); setToken(""); setData(null); }} placeholder={t("仅用于当前页面", "Only used on this page")} /></Field><Field label={t("验证器动态验证码", "Authenticator code")}><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value)} placeholder={t("6 位数字", "6 digits")} /></Field></div><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void load()}>{busy && <Loader2 className="animate-spin" />}{t("验证并加载后台", "Verify and load")}</Button><Button variant="outline" disabled={busy} onClick={() => void beginMfa()}>{t("首次设置二次验证", "Set up MFA")}</Button><Button variant="outline" disabled={busy} onClick={() => void confirmMfa()}>{t("确认绑定验证器", "Confirm authenticator")}</Button></div>{enrollment && <Alert role="status"><AlertDescription className="break-all">{t("验证器密钥（仅此页显示）：", "Authenticator key (shown only here): ")}<strong>{enrollment}</strong></AlertDescription></Alert>}{notice && <Alert variant={error ? "destructive" : "default"} role="status"><AlertDescription>{notice}</AlertDescription></Alert>}</CardContent></Card>
    {data && <Tabs defaultValue="overview" className="space-y-6"><TabsList className="h-auto flex-wrap justify-start">{[["overview", t("概览", "Overview")], ["users", t("用户", "Users")], ["ledger", t("额度流水", "Credit ledger")], ["orders", t("订单", "Orders")], ["packages", t("套餐", "Packages")], ["cost", t("AI 成本", "AI cost")], ["settings", t("设置", "Settings")]].map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList>
      <TabsContent value="overview"><div className="flex items-center justify-between mb-4"><h2 className="text-2xl font-semibold">{t("运营概览", "Operations overview")}</h2><Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />{t("刷新", "Refresh")}</Button></div><div className="grid grid-cols-4 gap-4">{[["users", t("用户总数", "Users")], ["verifiedUsers", t("已验证用户", "Verified")], ["todayUsers", t("今日新增", "New today")], ["todayGenerations", t("今日生成", "Generations today")], ["monthGenerations", t("本月生成", "Generations this month")], ["totalFreeGranted", t("免费额度发放", "Free credits granted")], ["abnormalRequests", t("异常请求", "Abnormal requests")], ["monthRevenueCents", t("本月收入", "Revenue this month")]].map(([key, label]) => <Metric key={key} label={label} value={key === "monthRevenueCents" ? dollars(Number(data.metrics[key] || 0)) : String(data.metrics[key] ?? "—")} />)}</div></TabsContent>
      <TabsContent value="users" className="space-y-5"><Card><CardHeader><CardTitle>{t("用户管理", "Users")}</CardTitle></CardHeader><CardContent><form className="mb-5 flex gap-2" onSubmit={event => void searchUsers(event)}><Input aria-label={t("搜索用户名或邮箱", "Search username or email")} placeholder={t("搜索用户名或邮箱", "Search username or email")} value={search} onChange={event => setSearch(event.target.value)} /><Button variant="outline" disabled={busy}><Search size={15} />{t("搜索", "Search")}</Button></form><div className="data-table-wrap"><Table><TableHeader><TableRow>{[t("用户", "User"), t("状态", "Status"), t("免费", "Free"), t("付费", "Paid"), t("已生成", "Generated"), t("操作", "Action")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.users.map(user => <TableRow key={user.id}><TableCell><strong>{user.username || t("旧账户", "Legacy user")}</strong><div className="text-xs text-muted-foreground">{user.email}</div><div className="text-xs text-muted-foreground">ID {user.id}</div></TableCell><TableCell><Badge variant={user.status === "active" ? "secondary" : "destructive"}>{statusText(user.status, language)}</Badge></TableCell><TableCell>{user.free_balance}</TableCell><TableCell>{user.paid_balance}</TableCell><TableCell>{user.generations}</TableCell><TableCell><Button size="sm" variant="outline" disabled={busy} onClick={() => freeze(user)}>{user.status === "frozen" ? t("解冻", "Unfreeze") : t("冻结", "Freeze")}</Button></TableCell></TableRow>)}</TableBody></Table></div>{!data.users.length && <Empty text={t("没有匹配账户。", "No matching users.")} />}</CardContent></Card><Card><CardHeader><CardTitle>{t("额度调整", "Adjust credits")}</CardTitle></CardHeader><CardContent><form className="grid grid-cols-4 gap-4" onSubmit={adjust}><Field label={t("用户 ID", "User ID")}><Input required value={adjustUser} onChange={event => setAdjustUser(event.target.value)} /></Field><Field label={t("额度类型", "Credit type")}><select className="h-9 rounded-md border border-input bg-white px-3 text-sm" value={adjustKind} onChange={event => setAdjustKind(event.target.value)}><option value="free">{t("免费", "Free")}</option><option value="paid">{t("付费", "Paid")}</option></select></Field><Field label={t("调整次数，可填负数", "Amount, negative allowed")}><Input type="number" required min={-10000} max={10000} value={adjustDelta} onChange={event => setAdjustDelta(event.target.value)} /></Field><Field label={t("原因，至少 8 字", "Reason, at least 8 characters")}><Input required minLength={8} maxLength={500} value={adjustReason} onChange={event => setAdjustReason(event.target.value)} /></Field><Button className="col-span-4 w-fit" disabled={busy}>{t("预览并确认调整", "Review adjustment")}</Button></form></CardContent></Card></TabsContent>
      <TabsContent value="ledger"><Card><CardHeader><CardTitle>{t("最近额度流水", "Recent credit ledger")}</CardTitle></CardHeader><CardContent><div className="data-table-wrap"><Table><TableHeader><TableRow>{[t("时间", "Time"), t("用户", "User"), t("类型", "Type"), t("免费变化", "Free delta"), t("付费变化", "Paid delta"), t("原因", "Reason")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.ledger.map(item => <TableRow key={item.id}><TableCell>{date(item.created_at, language)}</TableCell><TableCell>{item.email}</TableCell><TableCell>{ledgerText(item.kind, language)}</TableCell><TableCell>{item.free_delta}</TableCell><TableCell>{item.paid_delta}</TableCell><TableCell>{item.reason || "—"}</TableCell></TableRow>)}</TableBody></Table></div>{!data.ledger.length && <Empty text={t("暂无流水。", "No activity yet.")} />}</CardContent></Card></TabsContent>
      <TabsContent value="orders"><Card><CardHeader><CardTitle>{t("充值订单", "Top-up orders")}</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">{t("支付尚未开放；此处仅查看订单，不会发放额度。", "Payment is unavailable. Orders are view-only and do not grant credits.")}</p><div className="data-table-wrap"><Table><TableHeader><TableRow>{[t("订单号", "Order ID"), t("用户", "User"), t("套餐", "Package"), t("金额", "Amount"), t("手续费", "Fee"), t("状态", "Status"), t("额度", "Credits")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.orders.map(order => <TableRow key={order.id}><TableCell className="max-w-44 break-all text-xs">{order.id}</TableCell><TableCell>{order.email}</TableCell><TableCell>{order.package_name} · {order.credits}</TableCell><TableCell>{dollars(order.amount_cents)}</TableCell><TableCell>{order.fee_cents === null ? "—" : dollars(order.fee_cents)}</TableCell><TableCell><Badge variant="secondary">{statusText(order.status, language)}</Badge></TableCell><TableCell>{order.credited_at ? t("已发放", "Granted") : t("未发放", "Not granted")}</TableCell></TableRow>)}</TableBody></Table></div>{!data.orders.length && <Empty text={t("暂无订单。", "No orders yet.")} />}</CardContent></Card></TabsContent>
      <TabsContent value="packages"><Card><CardHeader><CardTitle>{t("套餐管理", "Packages")}</CardTitle></CardHeader><CardContent><div className="data-table-wrap"><Table><TableHeader><TableRow>{[t("套餐", "Package"), t("次数", "Credits"), t("价格", "Price"), t("促销价格", "Promo price"), t("状态", "Status"), t("操作", "Action")].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{data.packages.map(item => <TableRow key={item.id}><TableCell>{item.name_zh}<div className="text-xs text-muted-foreground">{item.id}</div></TableCell><TableCell>{item.credits}</TableCell><TableCell>{dollars(item.price_cents)}</TableCell><TableCell>{item.promo_price_cents === null ? "—" : dollars(item.promo_price_cents)}</TableCell><TableCell>{item.active ? t("上架", "Active") : t("下架", "Inactive")}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setEditing(item)}>{t("编辑", "Edit")}</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="cost"><div className="grid grid-cols-3 gap-4"><Metric label={t("本月输入 Token", "Input tokens this month")} value={String(data.metrics.cost?.inputTokens ?? "—")} /><Metric label={t("本月输出 Token", "Output tokens this month")} value={String(data.metrics.cost?.outputTokens ?? "—")} /><Metric label={t("本月估算成本", "Estimated cost this month")} value={microDollars(data.metrics.cost?.costMicroUsd)} /><Metric label={t("今日已结算成本", "Settled today")} value={microDollars(data.metrics.dailyCostMicroUsd)} /><Metric label={t("生成中预算预留", "In-flight reservation")} value={microDollars(data.metrics.reservedCostMicroUsd)} /><Metric label={t("每日预算上限", "Daily budget")} value={microDollars(data.metrics.budgetLimitMicroUsd)} /></div><Alert className="mt-4"><AlertDescription>{data.metrics.circuitOpen ? t("预算熔断已触发。", "Budget circuit breaker is active.") : data.metrics.costWarning ? t("已接近预算上限。", "Approaching the budget limit.") : t("预算状态正常。", "Budget is healthy.")}</AlertDescription></Alert></TabsContent>
      <TabsContent value="settings"><Card><CardHeader><CardTitle>{t("系统设置", "System settings")}</CardTitle></CardHeader><CardContent className="space-y-4">{data.settings.map(item => <SettingRow key={item.key} setting={item} language={language} onSave={value => saveSetting(item, value)} />)}</CardContent></Card></TabsContent>
    </Tabs>}
    <AlertDialog open={Boolean(confirm)} onOpenChange={open => { if (!open) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription className="break-all">{confirm?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); const action = confirm?.action; setConfirm(null); if (action) void run(action); }}>{t("确认操作", "Confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}>{editing && <PackageEditor item={editing} language={language} pending={busy} onCancel={() => setEditing(null)} onSave={body => { const item = editing; setEditing(null); setConfirm({ title: t("确认修改套餐", "Confirm package update"), description: `${item.id} · ${t("已有订单价格不会变化。", "Existing order prices will not change.")}`, action: async () => { await write(`/v1/admin/packages/${item.id}`, body); await refresh(); } }); }} />}</Dialog>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <Label className="grid gap-2 text-sm font-medium"><span>{label}</span>{children}</Label>; }
function Metric({ label, value }: { label: string; value: string }) { return <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><strong className="mt-2 block text-2xl font-semibold">{value}</strong></CardContent></Card>; }
function Empty({ text }: { text: string }) { return <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>; }
function date(value: number, language: Language) { return new Date(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US"); }
function SettingRow({ setting, language, onSave }: { setting: Setting; language: Language; onSave: (value: string) => void }) { const [value, setValue] = useState(setting.value); useEffect(() => setValue(setting.value), [setting.value]); return <div className="grid grid-cols-[1fr_2fr_auto] items-end gap-3"><Field label={settingText(setting.key, language)}><Input aria-label={setting.key} value={value} onChange={event => setValue(event.target.value)} /></Field><p className="pb-2 text-xs text-muted-foreground">{setting.key === "daily_cost_limit_micro_usd" ? phrase(language, "单位：百万分之一美元", "Unit: micro USD") : ""}</p><Button variant="outline" disabled={value === setting.value} onClick={() => onSave(value)}>{phrase(language, "保存", "Save")}</Button></div>; }
function PackageEditor({ item, language, pending, onCancel, onSave }: { item: Package; language: Language; pending: boolean; onCancel: () => void; onSave: (body: object) => void }) {
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [nameZh, setNameZh] = useState(item.name_zh), [nameEn, setNameEn] = useState(item.name_en);
  const [credits, setCredits] = useState(String(item.credits)), [price, setPrice] = useState((item.price_cents / 100).toFixed(2));
  const [promo, setPromo] = useState(item.promo_price_cents === null ? "" : (item.promo_price_cents / 100).toFixed(2));
  const [sort, setSort] = useState(String(item.sort_order)), [active, setActive] = useState(Boolean(item.active));
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(price) || promo && !/^\d+(\.\d{1,2})?$/.test(promo)) { setError(t("价格请使用美元格式，例如 6.99。", "Use USD amounts, for example 6.99.")); return; }
    const priceCents = Math.round(Number(price) * 100), promoPriceCents = promo === "" ? null : Math.round(Number(promo) * 100);
    if (promoPriceCents !== null && promoPriceCents > priceCents) { setError(t("促销价不能高于原价。", "Promo price cannot exceed the regular price.")); return; }
    onSave({ nameZh, nameEn, credits: Number(credits), priceCents, promoPriceCents, sortOrder: Number(sort), active });
  }
  return <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{t("编辑套餐", "Edit package")} · {item.id}</DialogTitle><DialogDescription>{t("价格以美元填写，保存时转换为美分。", "Enter prices in USD; they are converted to cents when saved.")}</DialogDescription></DialogHeader><form className="grid grid-cols-2 gap-4" onSubmit={submit}><Field label={t("中文名称", "Chinese name")}><Input required value={nameZh} onChange={event => setNameZh(event.target.value)} /></Field><Field label={t("英文名称", "English name")}><Input required value={nameEn} onChange={event => setNameEn(event.target.value)} /></Field><Field label={t("生成次数", "Credits")}><Input required type="number" min={1} value={credits} onChange={event => setCredits(event.target.value)} /></Field><Field label={t("排序", "Sort order")}><Input required type="number" value={sort} onChange={event => setSort(event.target.value)} /></Field><Field label={t("美元价格", "Price in USD")}><Input required inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></Field><Field label={t("促销价（可留空）", "Promo price (optional)")}><Input inputMode="decimal" value={promo} onChange={event => setPromo(event.target.value)} /></Field><Label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />{t("上架", "Active")}</Label>{error && <Alert variant="destructive" className="col-span-2"><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter className="col-span-2"><Button variant="outline" type="button" onClick={onCancel}>{t("取消", "Cancel")}</Button><Button disabled={pending}>{t("预览并保存", "Review and save")}</Button></DialogFooter></form></DialogContent>;
}
