import MerchantPaymentSettings from './MerchantPaymentSettings';
import {useEffect,useRef,useState} from 'react';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Label} from '../ui/label';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import type {Language} from '../../lib/language';

type Toggle={enabled:boolean;credentialsConfigured?:boolean;platformReleased?:boolean};
type Availability=Toggle&{available:boolean;reasons:string[]};
type Control={activeMerchant:string;environmentReady:boolean;operatorEnabled:boolean;globalEffectiveEnabled:boolean;effectiveEnabled:boolean;providers:{rsa2:Toggle;epay:Toggle;mk99:any};channels:{mk99:any;rsa2:{alipay:Toggle;wechat:Toggle};epay:{alipay:Toggle};alipay?:Toggle;wechat?:Toggle};availability:{mk99:any;rsa2:{alipay:Availability;wechat:Availability};epay:{alipay:Availability}};methods:Array<{provider:string;channel:string}>};
type Settings={rsa2Enabled:boolean;rsa2WechatEnabled:boolean;rsa2AlipayEnabled:boolean;rsa2WechatReleased:boolean;rsa2AlipayReleased:boolean;epayEnabled:boolean;epayAlipayEnabled:boolean;epayAlipayReleased:boolean};
type Props={language:Language;busy:boolean;read:(path:string)=>Promise<any>;write:(path:string,body:Record<string,unknown>)=>Promise<any>};
const initial:Settings={rsa2Enabled:true,rsa2WechatEnabled:false,rsa2AlipayEnabled:true,rsa2WechatReleased:false,rsa2AlipayReleased:false,epayEnabled:false,epayAlipayEnabled:true,epayAlipayReleased:false};

export default function SecurityPaymentPanel({language,busy,read,write}:Props){
 const zh=language==='zh',t=(a:string,b:string)=>zh?a:b;
 const [control,setControl]=useState<Control|null>(null),[settings,setSettings]=useState<Settings>(initial),[error,setError]=useState(''),[oldPassword,setOld]=useState(''),[newPassword,setNew]=useState(''),[confirmPassword,setConfirm]=useState(''),[reason,setReason]=useState('');
 const [platformCheck,setPlatformCheck]=useState<any>(null),[platformCheckError,setPlatformCheckError]=useState(''),[platformChecking,setPlatformChecking]=useState(false),[pendingRelease,setPendingRelease]=useState<{channel:'wechat'|'rsa2Alipay'|'epayAlipay';provider:'rsa2'|'epay'}|null>(null);
 const load=()=>read('/v1/admin/payment-control').then((data:Control)=>{setControl(data);setSettings({rsa2Enabled:data.providers.rsa2.enabled,epayEnabled:data.providers.epay.enabled,rsa2AlipayEnabled:data.channels.rsa2.alipay.enabled,rsa2WechatEnabled:data.channels.rsa2.wechat.enabled,rsa2AlipayReleased:Boolean(data.channels.rsa2.alipay.platformReleased),rsa2WechatReleased:Boolean(data.channels.rsa2.wechat.platformReleased),epayAlipayEnabled:data.channels.epay.alipay.enabled,epayAlipayReleased:Boolean(data.channels.epay.alipay.platformReleased)});}).catch((e:unknown)=>setError(e instanceof Error?e.message:String(e)));
 useEffect(()=>{void load();},[]);
 const mutationGuard=useRef(false),[pending,setPending]=useState(false),[notice,setNotice]=useState(''),[confirmEnable,setConfirmEnable]=useState(false);
 const locked=busy||pending;
 const status=(enabled:boolean)=>enabled?t('已开启','Enabled'):t('已关闭','Disabled');
 const unavailableReason=(reason:string)=>({environment_protection:t('环境保护开关关闭','Environment safety switch is off'),purchase_paused:t('全站收款已暂停','Global purchases are paused'),interface_disabled:t('支付接口未启用','Payment interface is disabled'),credentials_missing:t('支付凭证未配置或格式无效','Payment credentials are missing or invalid'),channel_disabled:t('该接口下的支付渠道未启用','This interface channel is disabled'),platform_release_unconfirmed:t('尚未确认小豆已放行该通道和交易形态','Xiaodou release for this channel and trade scope is unconfirmed'),channel_not_supported:t('该接口不支持此支付渠道','This interface does not support this channel'),wechat_merchant_not_approved:t('小豆商户微信尚未开通','Xiaodou merchant WeChat is not approved'),legacy_protocol_not_for_new_orders:t('易支付已退出新订单','Epay is disabled for new orders'),xiaodou_merchant_not_ready:t('小豆签名订阅验收、回调或出口 IP 尚未确认','Xiaodou subscription verification, webhook or egress IP is unconfirmed')} as Record<string,string>)[reason]??reason;
 const availabilityText=(availability:Availability)=>availability.available?t('当前可用','Available now'):availability.reasons.map(unavailableReason).join('；');
 const setChannel=(channel:'wechat'|'rsa2Alipay'|'epayAlipay',provider:'rsa2'|'epay',enabled:boolean)=>{
  const enabledKey=channel==='wechat'?'rsa2WechatEnabled':channel==='rsa2Alipay'?'rsa2AlipayEnabled':'epayAlipayEnabled';
  const releasedKey=channel==='wechat'?'rsa2WechatReleased':channel==='rsa2Alipay'?'rsa2AlipayReleased':'epayAlipayReleased';
  if(enabled&&!settings[releasedKey]){setPendingRelease({channel,provider});return;}
  setSettings(current=>({...current,[enabledKey]:enabled}));
 };
 const confirmChannelRelease=()=>{
  if(!pendingRelease)return;
  const channel=pendingRelease.channel,enabledKey=channel==='wechat'?'rsa2WechatEnabled':channel==='rsa2Alipay'?'rsa2AlipayEnabled':'epayAlipayEnabled',releasedKey=channel==='wechat'?'rsa2WechatReleased':channel==='rsa2Alipay'?'rsa2AlipayReleased':'epayAlipayReleased';
  setSettings(current=>({...current,[enabledKey]:true,[releasedKey]:true}));setPendingRelease(null);
 };
 const revokePlatformRelease=(key:'rsa2WechatReleased'|'rsa2AlipayReleased'|'epayAlipayReleased')=>setSettings(current=>({...current,[key]:false}));
 async function mutate(action:()=>Promise<void>){if(busy||mutationGuard.current)return;mutationGuard.current=true;setPending(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{mutationGuard.current=false;setPending(false);}}
 async function saveSettings(){await mutate(async()=>{await write('/v1/admin/payment-control',{settings,reason});await load();setNotice(t('支付接口和通道设置已保存。平台开通确认是独立条件，未确认的通道不会显示给用户。','Payment provider and channel settings saved. Platform release is a separate gate; unconfirmed channels stay hidden.'));});}
 async function togglePurchase(enabled:boolean){await mutate(async()=>{await write('/v1/admin/payment-control',{enabled,reason});setConfirmEnable(false);await load();setNotice(enabled?t('全站购买开关已开启；实际可用方式仍取决于配置和平台放行。','Purchase switch enabled; available methods still depend on credentials and platform release.'):t('新订单购买已关闭，已有订单的回调与核对仍可处理。','New purchases are disabled; existing order callbacks and reconciliation remain available.'));});}
 async function checkPlatform(){
  if(busy||mutationGuard.current)return;
  setPlatformChecking(true);
  try{
   await mutate(async()=>{
    setPlatformCheck(null);setPlatformCheckError('');
    try{
     // The shared admin write adapter requires an audit reason for every POST.
     // This read-only diagnostic has a stable, non-secret reason and still
     // requires the backend's normal admin auth/CSRF/reauth checks.
     const result=await write('/v1/admin/payment-platform-check',{reason:'Xiaodou RSA2 read-only connectivity diagnostic'});
     setPlatformCheck(result);
     setNotice(result.ok?t('RSA2 只读接口响应已验签；这不代表具体支付通道已获准。','The RSA2 read-only response signature verified. This does not confirm any payment channel is released.'):t('RSA2 只读检查未通过；请查看安全错误码。','RSA2 read-only check did not pass. Review the safe error code.'));
    }catch(e){setPlatformCheckError(e instanceof Error?e.message:String(e));}
   });
  }finally{setPlatformChecking(false);}
 }
 async function changePassword(){await mutate(async()=>{await write('/v1/admin/security/password',{oldPassword,newPassword,confirmPassword,reason});setOld('');setNew('');setConfirm('');setNotice(t('密码已修改，其他会话已退出。下次敏感操作需要重新验证。','Password changed. Other sessions are signed out; verify again for the next sensitive action.'));});}
 async function revoke(){await mutate(async()=>{await write('/v1/admin/security/sessions/revoke-others',{reason});setNotice(t('其他所有会话已退出，当前会话保留。','All other sessions are signed out. This session stays active.'));});}
 const switchRow=(key:'rsa2Enabled'|'epayEnabled'|'rsa2WechatEnabled'|'rsa2AlipayEnabled'|'epayAlipayEnabled',label:string,availability?:Availability,provider?:'rsa2'|'epay',channel?:'wechat'|'rsa2Alipay'|'epayAlipay')=><label className="flex items-start gap-3 rounded-md border p-3"><input type="checkbox" disabled={locked} checked={settings[key]} onChange={e=>provider&&channel?setChannel(channel,provider,e.target.checked):setSettings(current=>({...current,[key]:e.target.checked}))}/><span className="min-w-0 flex-1"><strong>{label}</strong>{availability&&<small className="block text-muted-foreground">{availabilityText(availability)}</small>}</span></label>;
 return <div className="space-y-6">
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <Card><CardHeader className="space-y-1"><CardTitle>{t('支付管理','Payment management')}</CardTitle><p className="text-sm text-muted-foreground">{t('当前状态、收款商家和支付方式一目了然。高级参数默认收起。','Current status, merchant and payment methods at a glance. Advanced settings stay collapsed.')}</p></CardHeader><CardContent className="space-y-5">
   {control&&<>
    <section role="status" className="rounded-xl border bg-muted/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs text-muted-foreground">{t('当前收款商家','Current merchant')}</p><p className="text-xl font-semibold">{control.activeMerchant==='mk99'?'MK99':control.activeMerchant==='xiaodou'?t('小豆支付','Xiaodou'):t('未选择','None')}</p></div><span className={control.effectiveEnabled?'rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800':'rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900'}>{!control.environmentReady?t('环境未就绪','Environment not ready'):!control.operatorEnabled?t('暂停新订单','New sales paused'):control.effectiveEnabled?t('收款配置就绪','Checkout configured'):t('通道尚未就绪','Not ready')}</span></div><p className="mt-2 text-xs text-muted-foreground">{t('此状态仅代表配置检查结果，不等于真实支付验收。','This status only reflects configuration, not real payment acceptance.')}</p></section>
    <MerchantPaymentSettings control={control} language={language} locked={locked} reason={reason} onReasonChange={setReason} write={write} reload={load}/>
    <section className="rounded-xl border p-4" aria-label={t('可用付款方式','Available methods')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t('买家当前可选择','Available to buyers')}</h3><span className="text-xs text-muted-foreground">{t('已保存的实际配置','Saved configuration')}</span></div>
    <div className="mt-3 flex flex-wrap gap-2">{control.methods.length?control.methods.map(method=><span key={method.provider+'-'+method.channel} className="rounded-lg border bg-background px-3 py-2 text-sm font-medium">{method.channel==='ALIPAY_H5'?t('支付宝','Alipay'):method.channel==='WECHAT_H5'?t('微信支付','WeChat Pay'):method.channel}<span className="ml-2 text-xs font-normal text-muted-foreground">{method.provider==='mk99'?'MK99':method.provider==='xiaodou'?t('小豆 RSA2','Xiaodou RSA2'):t('历史协议','Legacy')}</span></span>):<p className="text-sm text-amber-800">{t('暂无可用新订单支付方式。旧订单仍由原商家处理。','No new-order payment methods. Old orders remain with their original merchant.')}</p>}</div>
   </section>
    <section className="rounded-xl border p-4"><h3 className="font-semibold">{t('检查小豆 RSA2 连接（只读）','Check Xiaodou RSA2 (read-only)')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('不创建订单，当前使用 MK99 也能检测。无需填写原因，可能需要管理员密码验证。','No payment created. Works while MK99 is active. No typed reason is needed; admin password verification may be required.')}</p>
     <div className="space-y-3 pt-3"><p>{t('环境支付保护','Environment safety ceiling')}: {status(control.environmentReady)} · {t('数据库购买设置','Database purchase setting')}: {status(control.operatorEnabled)}</p>
      <Button variant="outline" disabled={locked} aria-busy={platformChecking} onClick={()=>void checkPlatform()}>{platformChecking?t('正在检查小豆 RSA2…','Checking Xiaodou RSA2…'):t('RSA2 只读连通性检查','RSA2 read-only connectivity check')}</Button>
      {platformChecking&&<p role="status">{t('正在连接小豆接口并验证签名；无需切换当前收款商家。','Connecting to Xiaodou and verifying the signature; no merchant switch is needed.')}</p>}
      {platformCheckError&&<p role="alert" className="text-sm text-red-700">{t('检测失败：','Check failed: ')}{platformCheckError}</p>}
      {platformCheck&&<p role="status">{platformCheck.ok?t(`响应验签通过 · requestId ${platformCheck.requestId}`,'Response signature verified · requestId '+platformCheck.requestId):t(`未通过：${platformCheck.errorCode} · HTTP ${platformCheck.upstreamHttpStatus??'无响应'} · requestId ${platformCheck.requestId}`,`Not verified: ${platformCheck.errorCode} · HTTP ${platformCheck.upstreamHttpStatus??'no response'} · requestId ${platformCheck.requestId}`)}</p>}
     </div>
    </section>
    <details className="rounded-xl border bg-muted/10 p-4"><summary className="cursor-pointer font-medium">{t('高级配置：小豆 RSA2 与历史易支付','Advanced: Xiaodou RSA2 and legacy Epay')}</summary><div className="space-y-4 pt-4">
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="rsa2-settings-title">
     <h3 id="rsa2-settings-title" className="font-semibold">RSA2 Open API</h3>
     <p className="text-sm text-muted-foreground">{t('凭证','Credentials')}: {status(control.providers.rsa2.credentialsConfigured===true)} · {control.providers.rsa2.credentialsConfigured?t('服务端格式与密钥可导入检查通过','Server-side format and key import checks passed'):t('缺失或无效（不显示密钥内容）','Missing or invalid (values hidden)')}</p>
     {switchRow('rsa2Enabled',t('启用 RSA2 新订单','Enable RSA2 for new orders'))}
     {switchRow('rsa2WechatEnabled',t('微信支付 · WECHAT_H5','WeChat Pay · WECHAT_H5'),control.availability.rsa2.wechat,'rsa2','wechat')}
     <p className="pl-8 text-sm">{t('平台放行','Platform release')}: {status(settings.rsa2WechatReleased)}{settings.rsa2WechatReleased&&<Button className="ml-2" variant="outline" size="sm" disabled={locked} onClick={()=>revokePlatformRelease('rsa2WechatReleased')}>{t('撤销确认','Revoke confirmation')}</Button>}</p>
     {switchRow('rsa2AlipayEnabled',t('支付宝 · ALIPAY_H5','Alipay · ALIPAY_H5'),control.availability.rsa2.alipay,'rsa2','rsa2Alipay')}
     <p className="pl-8 text-sm">{t('平台放行','Platform release')}: {status(settings.rsa2AlipayReleased)}{settings.rsa2AlipayReleased&&<Button className="ml-2" variant="outline" size="sm" disabled={locked} onClick={()=>revokePlatformRelease('rsa2AlipayReleased')}>{t('撤销确认','Revoke confirmation')}</Button>}</p>
    </section>
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="epay-settings-title">
     <h3 id="epay-settings-title" className="font-semibold">易支付 Epay</h3>
     <p className="text-sm text-muted-foreground">{t('凭证','Credentials')}: {status(control.providers.epay.credentialsConfigured===true)} · {control.providers.epay.credentialsConfigured?t('已配置','Configured'):t('缺失或无效（不显示密钥内容）','Missing or invalid (values hidden)')}</p>
     <p role="status" className="text-sm">{t('易支付已退出新订单路由，仅保留旧订单的签名通知与历史核对；旧配置不能开启新收款。','Epay is retired for new sales. Historical signed callbacks and reconciliation remain; legacy settings cannot enable sales.')}</p>
     <p className="text-sm">{t('历史支付宝通知仅供原单入账核对；此处不再提供开启易支付新单的开关。','Historical Epay Alipay notifications are retained for original orders. No new Epay checkout switch is offered.')}</p>
     <p className="pl-8 text-sm">{t('平台放行','Platform release')}: {status(settings.epayAlipayReleased)}{settings.epayAlipayReleased&&<Button className="ml-2" variant="outline" size="sm" disabled={locked} onClick={()=>revokePlatformRelease('epayAlipayReleased')}>{t('撤销确认','Revoke confirmation')}</Button>}</p>
     <p className="text-xs text-muted-foreground">{t('新订单只使用小豆 RSA2；易支付历史通知仍按原协议验签。','New Xiaodou orders use RSA2 only. Historical Epay notifications continue to use their original protocol.')}</p>
    </section>
    {pendingRelease&&<div role="alert" className="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4">
     <p>{t('请先确认你已在小豆商户后台核实该支付接口、通道和当前申报交易形态已获准。此勾选只记录人工确认，不会查询或改变小豆权限。','Confirm that the provider, channel, and declared trade scope are approved in Xiaodou merchant settings. This records your confirmation only; it does not query or change Xiaodou permissions.')}</p>
     <Button disabled={locked} onClick={confirmChannelRelease}>{t('我已核实，确认并启用通道','Verified — confirm and enable')}</Button><Button variant="outline" disabled={locked} onClick={()=>setPendingRelease(null)}>{t('取消','Cancel')}</Button>
    </div>}
    </div></details>
    
    {control.activeMerchant==='xiaodou'&&<Button disabled={locked||reason.trim().length<8} onClick={()=>void saveSettings()}>{t('保存支付接口设置','Save payment settings')}</Button>}
    <div className="space-y-2 rounded-xl border border-amber-200/70 bg-amber-50/40 p-4"><p className="font-medium">{t('全站收款总开关 · 紧急操作','Global sales switch · emergency control')}</p><p className="text-xs text-muted-foreground">{t('暂停只阻止新订单，历史回调和查单仍可继续。修改此设置需填写上方的变更原因。','Pausing blocks new orders only; old notifications and queries continue. Changing this setting requires a reason above.')}</p><Button disabled={locked||reason.trim().length<8||(!control.operatorEnabled&&!control.environmentReady)} onClick={()=>control.operatorEnabled?void togglePurchase(false):setConfirmEnable(true)}>{control.operatorEnabled?t('暂停全站收款','Pause all sales'):t('开启全站收款','Enable all sales')}</Button>
     {confirmEnable&&!control.operatorEnabled&&<div role="alert" className="space-y-2"><p>{t('确认开启全站收款？只有接口、凭证、通道及平台放行条件全部满足的付款方式才会展示。','Enable global sales? Only methods passing interface, credentials, channel, and platform release gates will be shown.')}</p><Button disabled={locked||reason.trim().length<8} onClick={()=>void togglePurchase(true)}>{t('确认开启','Confirm')}</Button><Button variant="outline" disabled={locked} onClick={()=>setConfirmEnable(false)}>{t('取消','Cancel')}</Button></div>}
    </div>
    
    <p className="text-xs text-muted-foreground">{t('平台放行状态按支付接口分别保存；关闭新单开关不影响历史订单通知与查询。','Platform release is stored separately per provider. Disabling new sales does not stop historical order notifications or queries.')}</p>
   </>}
  </CardContent></Card>
  <Card><CardHeader><CardTitle>{t('账户安全','Account security')}</CardTitle></CardHeader><CardContent className="space-y-3"><details><summary className="cursor-pointer text-sm font-medium">{t('密码与登录会话管理（展开）','Manage password and sessions (expand)')}</summary><div className="space-y-3 pt-3"><p>{t('修改密码后其他网页登录和扩展会话将退出，当前会话保留；敏感操作需重新验证。','Changing your password signs out other web and extension sessions. This session stays active and sensitive actions require re-verification.')}</p>
   <Label htmlFor="admin-old-password">{t('原密码','Current password')}</Label><Input id="admin-old-password" type="password" autoComplete="current-password" disabled={locked} value={oldPassword} onChange={e=>setOld(e.target.value)}/>
   <Label htmlFor="admin-new-password">{t('新密码（至少12位，字母、数字、符号中至少两类）','New password (12+ characters, two character types)')}</Label><Input id="admin-new-password" type="password" autoComplete="new-password" disabled={locked} value={newPassword} onChange={e=>setNew(e.target.value)}/>
   <Label htmlFor="admin-confirm-password">{t('确认新密码','Confirm new password')}</Label><Input id="admin-confirm-password" type="password" autoComplete="new-password" disabled={locked} value={confirmPassword} onChange={e=>setConfirm(e.target.value)}/>
   <Button disabled={locked||reason.trim().length<8||!oldPassword||newPassword.length<12||newPassword!==confirmPassword} onClick={()=>void changePassword()}>{t('修改密码','Change password')}</Button><Button variant="outline" disabled={locked||reason.trim().length<8} onClick={()=>void revoke()}>{t('退出其他所有会话','Sign out all other sessions')}</Button>
  </div></details></CardContent></Card>
 </div>;
}
