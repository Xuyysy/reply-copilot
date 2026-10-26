import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { phrase, readableError, useLanguage } from "../../lib/language";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

type View = "login" | "register" | "verify" | "reset-request" | "reset-finish";
type Turnstile = { render: (element: HTMLElement, options: { sitekey: string; action: string }) => string; reset: (id?: string) => void; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }

export default function AuthPanel({ localVerification, sitekey }: { localVerification: boolean; sitekey: string }) {
  const language = useLanguage();
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [view, setView] = useState<View>(() => typeof location !== "undefined" && new URL(location.href).searchParams.get("mode") === "register" ? "register" : "login");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [identity, setIdentity] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(localVerification);
  const [resendUntil, setResendUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const turnstileNode = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (view !== "register" || localVerification || !sitekey || !turnstileNode.current) return;
    const timer = window.setInterval(() => {
      if (turnstileNode.current && window.turnstile && !widgetId.current) {
        widgetId.current = window.turnstile.render(turnstileNode.current, { sitekey, action: "register" });
        setTurnstileReady(true);
        window.clearInterval(timer);
      }
    }, 200);
    return () => { window.clearInterval(timer); if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current); widgetId.current = null; setTurnstileReady(false); };
  }, [view, localVerification, sitekey]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const deviceCode = new URL(location.href).searchParams.get("device_code");
    if (deviceCode && /^[A-F0-9]{8}$/.test(deviceCode)) void api("/v1/me").then(() => redirect(), () => {});
  }, []);

  function switchView(next: View) { setView(next); setNotice(null); setCode(""); }
  function redirect() {
    const deviceCode = new URL(location.href).searchParams.get("device_code");
    location.href = deviceCode && /^[A-F0-9]{8}$/.test(deviceCode) ? `/account?device_code=${deviceCode}` : "/account";
  }
  async function request<T>(event: FormEvent, path: string, body: object, success: (result: T) => void) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setNotice(null);
    try { success(await api<T>(path, { method: "POST", body: JSON.stringify(body) })); }
    catch (error) { if (path === "/v1/auth/register" && widgetId.current) window.turnstile?.reset(widgetId.current); setNotice({ text: readableError(error, language), error: true }); }
    finally { setPending(false); }
  }
  function registrationToken() { return localVerification ? "local-test-token" : document.querySelector<HTMLInputElement>("[name=cf-turnstile-response]")?.value || ""; }
  function sendRegistration(event: FormEvent) {
    const turnstileToken = registrationToken();
    if (!turnstileToken) { event.preventDefault(); setNotice({ text: t("请先完成人机验证。", "Complete verification first."), error: true }); return; }
    void request<{ codeLogged?: boolean }>(event, "/v1/auth/register", { username, email, password, turnstileToken }, result => {
      if (localVerification && result.codeLogged === false) { setNotice({ text: t("这次没有生成新验证码。账户可能已存在，或请求过于频繁；请尝试登录或稍后重试。", "No new code was created. The account may exist or requests may be too frequent."), error: true }); return; }
      setView("verify"); setCode(""); setResendUntil(Date.now() + 60_000);
      setNotice({ text: localVerification ? t("验证码已生成，请查看 api/local-worker.log。", "Code created. Check api/local-worker.log.") : t("验证码已发送，请查看邮箱。", "Code sent. Check your inbox.") });
    });
  }

  return <Card className="mx-auto w-full max-w-[540px] border-border shadow-[0_24px_72px_rgb(24_49_75_/_0.08)]">
    <CardHeader><CardTitle>{view === "verify" ? t("验证邮箱", "Verify email") : view.startsWith("reset") ? t("找回密码", "Reset password") : t("欢迎使用 x-Reply-Helper", "Welcome to x-Reply-Helper")}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <Tabs value={view === "verify" ? "register" : view.startsWith("reset") ? "reset" : view} onValueChange={value => switchView(value === "reset" ? "reset-request" : value as View)}><TabsList className="grid w-full grid-cols-3"><TabsTrigger value="login">{t("登录", "Sign in")}</TabsTrigger><TabsTrigger value="register">{t("注册", "Register")}</TabsTrigger><TabsTrigger value="reset">{t("忘记密码", "Reset")}</TabsTrigger></TabsList></Tabs>
      {view === "login" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/login", { identity, password }, redirect)}><Field label={t("用户名或邮箱", "Username or email")}><Input autoFocus autoComplete="username" value={identity} onChange={event => setIdentity(event.target.value)} required /></Field><Field label={t("密码", "Password")}><PasswordInput language={language} value={password} setValue={setPassword} shown={showPassword} setShown={setShowPassword} autoComplete="current-password" /></Field><Submit pending={pending} label={t("登录", "Sign in")} /></form>}
      {view === "register" && <form className="space-y-4" onSubmit={sendRegistration}><Field label={t("用户名", "Username")}><Input autoFocus autoComplete="username" minLength={3} maxLength={24} value={username} onChange={event => setUsername(event.target.value)} required /></Field><Field label={t("邮箱", "Email")}><Input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></Field><Field label={t("密码，至少 12 位", "Password, at least 12 characters")}><PasswordInput language={language} value={password} setValue={setPassword} shown={showPassword} setShown={setShowPassword} autoComplete="new-password" minLength={12} /></Field>{localVerification ? <p className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">{t("本地开发使用模拟人机验证；验证码写入本机 Worker 日志。", "Local development uses mock verification. The code appears in the Worker log.")}</p> : sitekey ? <div ref={turnstileNode} /> : <Alert variant="destructive"><AlertDescription>{t("注册暂不可用：尚未配置人机验证。", "Registration is unavailable until verification is configured.")}</AlertDescription></Alert>}<Submit pending={pending} disabled={!turnstileReady} label={t("发送注册验证码", "Send verification code")} /></form>}
      {view === "verify" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/verify-registration", { email, code }, redirect)}><p className="text-sm text-muted-foreground">{t("验证码发送至", "Code sent to")} <strong className="text-foreground">{email}</strong></p><Field label={t("6 位验证码", "6-digit code")}><Input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} required /></Field><Submit pending={pending} label={t("验证并领取 200 次", "Verify and get 200 credits")} /><div className="flex justify-between gap-4 text-sm"><button type="button" className="text-primary underline" onClick={() => switchView("register")}>{t("修改邮箱", "Edit email")}</button><button type="button" className="text-primary underline disabled:text-muted-foreground" disabled={pending || now < resendUntil} onClick={event => localVerification ? sendRegistration(event as unknown as FormEvent) : switchView("register")}>{now < resendUntil ? t(`${Math.ceil((resendUntil - now) / 1000)} 秒后重发`, `Resend in ${Math.ceil((resendUntil - now) / 1000)}s`) : localVerification ? t("重新发送", "Resend code") : t("重新验证后发送", "Verify and resend")}</button></div></form>}
      {view === "reset-request" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/request-password-reset", { email }, () => { setView("reset-finish"); setCode(""); setNotice({ text: t("如果此邮箱已有账户，验证码已发送。", "If the account exists, a code has been sent.") }); })}><Field label={t("账户邮箱", "Account email")}><Input autoFocus type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></Field><Submit pending={pending} label={t("发送重置验证码", "Send reset code")} /></form>}
      {view === "reset-finish" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/reset-password", { email, code, password }, () => { setView("login"); setPassword(""); setCode(""); setNotice({ text: t("密码已重置，请重新登录。", "Password reset. Please sign in.") }); })}><p className="text-sm text-muted-foreground">{email}</p><Field label={t("6 位验证码", "6-digit code")}><Input autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} required /></Field><Field label={t("新密码，至少 12 位", "New password, at least 12 characters")}><PasswordInput language={language} value={password} setValue={setPassword} shown={showPassword} setShown={setShowPassword} autoComplete="new-password" minLength={12} /></Field><Submit pending={pending} label={t("重置密码", "Reset password")} /><button type="button" className="text-sm text-primary underline" onClick={() => switchView("reset-request")}>{t("修改邮箱", "Edit email")}</button></form>}
      {notice && <Alert variant={notice.error ? "destructive" : "default"} role="status"><AlertDescription>{notice.text}</AlertDescription></Alert>}
    </CardContent>
  </Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <Label className="grid gap-2 text-sm font-medium"><span>{label}</span>{children}</Label>; }
function PasswordInput({ language, value, setValue, shown, setShown, autoComplete, minLength }: { language: "zh" | "en"; value: string; setValue: (value: string) => void; shown: boolean; setShown: (shown: boolean) => void; autoComplete: string; minLength?: number }) { return <span className="relative block"><Input className="pr-12" type={shown ? "text" : "password"} autoComplete={autoComplete} minLength={minLength} value={value} onChange={event => setValue(event.target.value)} required /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-primary" aria-label={shown ? phrase(language, "隐藏密码", "Hide password") : phrase(language, "显示密码", "Show password")} onClick={() => setShown(!shown)}>{shown ? phrase(language, "隐藏", "Hide") : phrase(language, "显示", "Show")}</button></span>; }
function Submit({ pending, label, disabled = false }: { pending: boolean; label: string; disabled?: boolean }) { return <Button type="submit" className="w-full" disabled={pending || disabled}>{pending && <Loader2 className="animate-spin" />}{label}</Button>; }
