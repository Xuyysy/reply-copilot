import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { phrase, readableError, useLanguage } from "../../lib/language";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

import { createTurnstileController } from "../../lib/turnstile-controller.mjs";

type View = "login" | "register" | "verify" | "reset-request" | "reset-finish";

export default function AuthPanel({ localVerification, sitekey }: { localVerification: boolean; sitekey: string }) {
  const language = useLanguage();
  const t = (zh: string, en: string) => phrase(language, zh, en);
  const [view, setView] = useState<View>(() => typeof location !== "undefined" && new URL(location.href).searchParams.get("mode") === "register" ? "register" : "login");
  // The referral is bound only during the original verified registration.
  // Neither URL changes after signup nor a login can reassign the attribution.
  const referralCode=typeof location!=="undefined"?(new URL(location.href).searchParams.get("ref")||"").toLowerCase():"";
  const validReferralCode=/^[0-9a-f]{16}$/.test(referralCode)?referralCode:null;
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [identity, setIdentity] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verification, setVerification] = useState<{phase:string;code:string|null;elapsedMs:number}>({phase:"loading",code:null,elapsedMs:0});
  const [uncertainRegistration, setUncertainRegistration] = useState(false);
  const turnstile = useRef<ReturnType<typeof createTurnstileController> | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const [resendUntil, setResendUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const turnstileNode = useRef<HTMLDivElement>(null);


  useEffect(() => { mounted.current=true;return()=>{mounted.current=false;}; }, []);
  useEffect(() => {
    if (view !== "register" || localVerification || !sitekey || !turnstileNode.current) return;
    const controller=createTurnstileController({node:turnstileNode.current,sitekey,onState:setVerification});
    turnstile.current=controller;void controller.start();
    return()=>{controller.dispose();if(turnstile.current===controller)turnstile.current=null;};
  }, [view,localVerification,sitekey]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const deviceCode = new URL(location.href).searchParams.get("device_code");
    if (deviceCode && /^[A-F0-9]{8}$/.test(deviceCode)) void api("/v1/me").then(() => redirect(), () => {});
  }, []);

  function switchView(next: View) { setView(next); setNotice(null); setCode(""); }
  function redirect() {
    const deviceCode = new URL(location.href).searchParams.get("device_code");
    location.href = deviceCode && /^[A-F0-9]{8}$/.test(deviceCode) ? `/account?device_code=${deviceCode}` : new URL(location.href).searchParams.get("next")==="partners" ? "/partners" : "/account";
  }
  async function request<T>(event: FormEvent, path: string, body: object, success: (result: T) => void) {
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current=true;setPending(true); setNotice(null);
    try { const result=await api<T>(path, { method: "POST", body: JSON.stringify(body) });if(mounted.current)success(result); }
    catch (error) {
      if(!mounted.current)return;
      if(path === "/v1/auth/register" && error instanceof ApiError && ["API_NETWORK_ERROR","API_TIMEOUT","INVALID_RESPONSE","MAIL_UNAVAILABLE"].includes(error.code)){
        setUncertainRegistration(true);setResendUntil(Date.now()+60_000);
        setNotice({text:readableError(error,language)+" "+t("未能确认发送结果，验证码邮件可能已经发出。请先检查邮箱；收到后可继续验证。请勿连续重复发送。","The response was not confirmed; the email may already have been sent. Check your inbox and continue with the code if received. Avoid repeated submissions."),error:true});
      }else setNotice({ text: readableError(error, language), error: true });
    }
    finally { pendingRef.current=false;if(mounted.current)setPending(false); }
  }
  function registrationToken() { return localVerification ? "local-test-token" : turnstile.current?.consume() || ""; }
  function sendRegistration(event: FormEvent) {
    if(pendingRef.current||Date.now()<resendUntil){event.preventDefault();return;}
    const turnstileToken = registrationToken();
    if (!turnstileToken) { event.preventDefault(); setNotice({ text: t("请先完成人机验证。", "Complete verification first."), error: true }); return; }
    setUncertainRegistration(false);
    void request<{ codeLogged?: boolean }>(event, "/v1/auth/register", { username, email, password, turnstileToken, ...(validReferralCode?{referralCode:validReferralCode}:{}) }, result => {
      if (localVerification && result.codeLogged === false) { setNotice({ text: t("这次没有生成新验证码。账户可能已存在，或请求过于频繁；请尝试登录或稍后重试。", "No new code was created. The account may exist or requests may be too frequent."), error: true }); return; }
      setUncertainRegistration(false);setView("verify"); setCode(""); setResendUntil(Date.now() + 60_000);
      setNotice({ text: localVerification ? t("验证码已生成，请查看 api/local-worker.log。", "Code created. Check api/local-worker.log.") : t("验证码已发送，请查看邮箱。", "Code sent. Check your inbox.") });
    });
  }

  return <Card className="mx-auto w-full max-w-[540px] border-border shadow-[0_24px_72px_rgb(24_49_75_/_0.08)]">
    <CardHeader><CardTitle>{view === "verify" ? t("验证邮箱", "Verify email") : view.startsWith("reset") ? t("找回密码", "Reset password") : t("欢迎使用 x-Reply-Helper", "Welcome to x-Reply-Helper")}</CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <Tabs value={view === "verify" ? "register" : view.startsWith("reset") ? "reset" : view} onValueChange={value => switchView(value === "reset" ? "reset-request" : value as View)}><TabsList className="grid w-full grid-cols-3"><TabsTrigger disabled={pending} value="login">{t("登录", "Sign in")}</TabsTrigger><TabsTrigger disabled={pending} value="register">{t("注册", "Register")}</TabsTrigger><TabsTrigger disabled={pending} value="reset">{t("忘记密码", "Reset")}</TabsTrigger></TabsList></Tabs>
      {view === "login" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/login", { identity, password }, redirect)}><Field label={t("用户名或邮箱", "Username or email")}><Input autoFocus autoComplete="username" value={identity} onChange={event => setIdentity(event.target.value)} required /></Field><Field label={t("密码", "Password")}><PasswordInput language={language} value={password} setValue={setPassword} shown={showPassword} setShown={setShowPassword} autoComplete="current-password" /></Field><Submit pending={pending} label={t("登录", "Sign in")} /></form>}
      {view === "register" && <form className="space-y-4" onSubmit={sendRegistration}><fieldset disabled={pending} className="contents">{validReferralCode&&<p data-testid="referral-signup-notice" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">{t("好友邀请福利：首次绑定插件领 200 次免费额度，成功收到第一条 AI 回复再送 50 次，合计 250 次。","Friend invite: get 200 free credits when you first connect the extension, plus 50 after your first delivered AI reply—250 in total.")}</p>}{!validReferralCode&&<p className="text-sm text-muted-foreground">{t("验证邮箱完成注册，首次绑定插件可领 200 次免费额度。","Verify your email to register, then get 200 free credits on your first extension connection.")}</p>}<Field label={t("用户名", "Username")}><Input autoFocus autoComplete="username" minLength={3} maxLength={24} value={username} onChange={event => setUsername(event.target.value)} required /></Field><Field label={t("邮箱", "Email")}><Input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></Field><p role="note" data-registration-email-tip className="text-xs text-muted-foreground">{t("验证码发送后若未收到，请检查垃圾邮箱或广告邮件文件夹。","If your verification code doesn't arrive, check your spam or promotions folder.")}</p><Field label={t("密码，至少 12 位", "Password, at least 12 characters")}><PasswordInput language={language} value={password} setValue={setPassword} shown={showPassword} setShown={setShowPassword} autoComplete="new-password" minLength={12} /></Field>{localVerification ? <p className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">{t("本地开发使用模拟人机验证；验证码写入本机 Worker 日志。", "Local development uses mock verification. The code appears in the Worker log.")}</p> : sitekey ? <div className="space-y-2">
        <div ref={turnstileNode} style={{minHeight:70,maxWidth:"100%"}} />
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{verification.phase === "verified" ? t("验证成功，可以发送验证码。","Verification successful. You can send the code.") : verification.phase === "failed" ? t("验证未完成，请重新验证。","Verification did not complete. Try verification again.") : verification.phase === "submitted" ? pending ? t("正在发送验证码，请稍候…","Sending the verification code. Please wait…") : t("再次发送前请重新验证。","Verify again before sending another code.") : verification.phase === "verifying" ? t("请完成人机验证。","Complete the verification.") : t("人机验证加载中，请稍候…","Loading verification. Please wait…")}</p>
        {(verification.phase === "failed" || (verification.phase === "submitted" && !pending)) && <Button type="button" variant="outline" disabled={pending} onClick={()=>void turnstile.current?.retry()}>{t("重新验证","Verify again")}</Button>}
        {verification.code && <details className="text-xs text-muted-foreground"><summary>{t("验证诊断","Verification details")}</summary><code>{JSON.stringify({stage:verification.phase,code:verification.code,elapsedMs:verification.elapsedMs})}</code></details>}
      </div> : <Alert variant="destructive"><AlertDescription>{t("注册暂不可用：尚未配置人机验证。", "Registration is unavailable until verification is configured.")}</AlertDescription></Alert>}<Submit pending={pending} disabled={(!localVerification && verification.phase!=="verified") || now<resendUntil} label={now<resendUntil?t(`${Math.ceil((resendUntil-now)/1000)} 秒后可重新发送`,`Resend in ${Math.ceil((resendUntil-now)/1000)}s`):t("发送注册验证码", "Send verification code")} /></fieldset></form>}
      {view === "verify" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/verify-registration", { email, code }, redirect)}><p className="text-sm text-muted-foreground">{t("验证码发送至", "Code sent to")} <strong className="text-foreground">{email}</strong></p><p role="note" data-email-delivery-tip className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm leading-relaxed text-blue-900">{t("没收到验证码？请检查垃圾邮箱或广告邮件文件夹；若仍未收到，请在倒计时结束后重新发送。","Can’t find the code? Check your spam or promotions folder. If it’s still missing, resend when the countdown ends.")}</p><Field label={t("6 位验证码", "6-digit code")}><Input autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} required /></Field><Submit pending={pending} label={t("验证邮箱", "Verify email")} /><div className="flex justify-between gap-4 text-sm"><button type="button" className="text-primary underline" onClick={() => switchView("register")}>{t("修改邮箱", "Edit email")}</button><button type="button" className="text-primary underline disabled:text-muted-foreground" disabled={pending || now < resendUntil} onClick={event => localVerification ? sendRegistration(event as unknown as FormEvent) : switchView("register")}>{now < resendUntil ? t(`${Math.ceil((resendUntil - now) / 1000)} 秒后重发`, `Resend in ${Math.ceil((resendUntil - now) / 1000)}s`) : localVerification ? t("重新发送", "Resend code") : t("重新验证后发送", "Verify and resend")}</button></div></form>}
      {view === "reset-request" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/request-password-reset", { email }, () => { setView("reset-finish"); setCode(""); setNotice({ text: t("如果此邮箱已有账户，验证码已发送。", "If the account exists, a code has been sent.") }); })}><Field label={t("账户邮箱", "Account email")}><Input autoFocus type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></Field><Submit pending={pending} label={t("发送重置验证码", "Send reset code")} /></form>}
      {view === "reset-finish" && <form className="space-y-4" onSubmit={event => void request(event, "/v1/auth/reset-password", { email, code, password }, () => { setView("login"); setPassword(""); setCode(""); setNotice({ text: t("密码已重置，请重新登录。", "Password reset. Please sign in.") }); })}><p className="text-sm text-muted-foreground">{email}</p><p role="note" data-email-delivery-tip className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm leading-relaxed text-blue-900">{t("没收到验证码？请检查垃圾邮箱或广告邮件文件夹；若仍未收到，请在倒计时结束后重新发送。","Can’t find the code? Check your spam or promotions folder. If it’s still missing, resend when the countdown ends.")}</p><Field label={t("6 位验证码", "6-digit code")}><Input autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} required /></Field><Field label={t("新密码，至少 12 位", "New password, at least 12 characters")}><PasswordInput language={language} value={password} setValue={setPassword} shown={showPassword} setShown={setShowPassword} autoComplete="new-password" minLength={12} /></Field><Submit pending={pending} label={t("重置密码", "Reset password")} /><button type="button" className="text-sm text-primary underline" onClick={() => switchView("reset-request")}>{t("修改邮箱", "Edit email")}</button></form>}
      {uncertainRegistration && view==="register" && <Button type="button" variant="outline" disabled={pending} onClick={()=>{setView("verify");setCode("");}}>{t("已收到验证码，继续验证","I received the code — continue")}</Button>}
      {notice && <Alert variant={notice.error ? "destructive" : "default"} role="status"><AlertDescription>{notice.text}</AlertDescription></Alert>}
    </CardContent>
  </Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <Label className="grid gap-2 text-sm font-medium"><span>{label}</span>{children}</Label>; }
function PasswordInput({ language, value, setValue, shown, setShown, autoComplete, minLength }: { language: "zh" | "en"; value: string; setValue: (value: string) => void; shown: boolean; setShown: (shown: boolean) => void; autoComplete: string; minLength?: number }) { return <span className="relative block"><Input className="pr-12" type={shown ? "text" : "password"} autoComplete={autoComplete} minLength={minLength} value={value} onChange={event => setValue(event.target.value)} required /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-primary" aria-label={shown ? phrase(language, "隐藏密码", "Hide password") : phrase(language, "显示密码", "Show password")} onClick={() => setShown(!shown)}>{shown ? phrase(language, "隐藏", "Hide") : phrase(language, "显示", "Show")}</button></span>; }
function Submit({ pending, label, disabled = false }: { pending: boolean; label: string; disabled?: boolean }) { return <Button type="submit" className="w-full" disabled={pending || disabled}>{pending && <Loader2 className="animate-spin" />}{label}</Button>; }
