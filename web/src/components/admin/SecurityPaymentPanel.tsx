import {useEffect,useRef,useState} from 'react';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Label} from '../ui/label';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import type {Language} from '../../lib/language';

type Toggle={enabled:boolean;credentialsConfigured?:boolean;platformReleased?:boolean};
type Control={environmentReady:boolean;operatorEnabled:boolean;globalEffectiveEnabled:boolean;effectiveEnabled:boolean;providers:{rsa2:Toggle;epay:Toggle};channels:{alipay:Toggle;wechat:Toggle};methods:Array<{provider:string;channel:string}>};
type Settings={rsa2Enabled:boolean;epayEnabled:boolean;alipayEnabled:boolean;wechatEnabled:boolean;alipayReleased:boolean;wechatReleased:boolean};
type Props={language:Language;busy:boolean;read:(path:string)=>Promise<any>;write:(path:string,body:Record<string,unknown>)=>Promise<any>};
const initial:Settings={rsa2Enabled:true,epayEnabled:false,alipayEnabled:true,wechatEnabled:false,alipayReleased:false,wechatReleased:false};

export default function SecurityPaymentPanel({language,busy,read,write}:Props){
 const zh=language==='zh',t=(a:string,b:string)=>zh?a:b;
 const [control,setControl]=useState<Control|null>(null),[settings,setSettings]=useState<Settings>(initial),[error,setError]=useState(''),[oldPassword,setOld]=useState(''),[newPassword,setNew]=useState(''),[confirmPassword,setConfirm]=useState(''),[reason,setReason]=useState('');
 const [platformCheck,setPlatformCheck]=useState<any>(null);
 const load=()=>read('/v1/admin/payment-control').then((data:Control)=>{setControl(data);setSettings({rsa2Enabled:data.providers.rsa2.enabled,epayEnabled:data.providers.epay.enabled,alipayEnabled:data.channels.alipay.enabled,wechatEnabled:data.channels.wechat.enabled,alipayReleased:data.channels.alipay.platformReleased,wechatReleased:data.channels.wechat.platformReleased});}).catch((e:unknown)=>setError(e instanceof Error?e.message:String(e)));
 useEffect(()=>{void load();},[]);
 const mutationGuard=useRef(false),[pending,setPending]=useState(false),[notice,setNotice]=useState(''),[confirmEnable,setConfirmEnable]=useState(false);
 const locked=busy||pending;
 const status=(enabled:boolean)=>enabled?t('已开启','Enabled'):t('已关闭','Disabled');
 async function mutate(action:()=>Promise<void>){if(busy||mutationGuard.current)return;mutationGuard.current=true;setPending(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{mutationGuard.current=false;setPending(false);}}
 async function saveSettings(){await mutate(async()=>{await write('/v1/admin/payment-control',{settings,reason});await load();setNotice(t('支付接口和通道设置已保存。平台开通确认是独立条件，未确认的通道不会显示给用户。','Payment provider and channel settings saved. Platform release is a separate gate; unconfirmed channels stay hidden.'));});}
 async function togglePurchase(enabled:boolean){await mutate(async()=>{await write('/v1/admin/payment-control',{enabled,reason});setConfirmEnable(false);await load();setNotice(enabled?t('全站购买开关已开启；实际可用方式仍取决于配置和平台放行。','Purchase switch enabled; available methods still depend on credentials and platform release.'):t('新订单购买已关闭，已有订单的回调与核对仍可处理。','New purchases are disabled; existing order callbacks and reconciliation remain available.'));});}
 async function checkPlatform(){await mutate(async()=>{const result=await write('/v1/admin/payment-platform-check',{});setPlatformCheck(result);setNotice(result.ok?t('RSA2 只读接口响应已验签；这不代表具体支付通道已获准。','The RSA2 read-only response signature verified. This does not confirm any payment channel is released.'):t('RSA2 只读检查未通过；请查看安全错误码。','RSA2 read-only check did not pass. Review the safe error code.'));});}
 async function changePassword(){await mutate(async()=>{await write('/v1/admin/security/password',{oldPassword,newPassword,confirmPassword,reason});setOld('');setNew('');setConfirm('');setNotice(t('密码已修改，其他会话已退出。下次敏感操作需要重新验证。','Password changed. Other sessions are signed out; verify again for the next sensitive action.'));});}
 async function revoke(){await mutate(async()=>{await write('/v1/admin/security/sessions/revoke-others',{reason});setNotice(t('其他所有会话已退出，当前会话保留。','All other sessions are signed out. This session stays active.'));});}
 const check=(key:keyof Settings,label:string,help?:string)=><label className="flex items-start gap-3 rounded-md border p-3"><input type="checkbox" disabled={locked} checked={settings[key]} onChange={e=>setSettings(current=>({...current,[key]:e.target.checked}))}/><span><strong>{label}</strong>{help&&<small className="block text-muted-foreground">{help}</small>}</span></label>;
 return <div className="space-y-6">
  <Label htmlFor="admin-security-reason">{t('操作原因（至少8字）','Reason for this action (8+ characters)')}</Label><Input id="admin-security-reason" value={reason} onChange={e=>setReason(e.target.value)}/>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <Card><CardHeader><CardTitle>{t('支付运营配置','Payment operations')}</CardTitle></CardHeader><CardContent className="space-y-4">
   {control&&<>
    <p>{t('环境紧急保护','Environment safety ceiling')}: {status(control.environmentReady)} · {t('数据库运营开关','Database purchase switch')}: {status(control.operatorEnabled)} · {t('当前存在可购买方式','At least one payment method available')}: {status(control.effectiveEnabled)}</p>
    <p>{t('RSA2凭证','RSA2 credentials')}: {status(control.providers.rsa2.credentialsConfigured===true)} · {t('易支付凭证','Epay credentials')}: {status(control.providers.epay.credentialsConfigured===true)}</p>
    <div className="space-y-2">
     {check('rsa2Enabled',t('允许 RSA2 Open API 新订单','Allow new RSA2 Open API orders'))}
     {check('epayEnabled',t('允许旧易支付创建新订单','Allow legacy Epay for new orders'),'只影响新单；旧易支付订单回调仍由原 MD5 验签逻辑处理。')}
     {check('alipayEnabled',t('允许展示支付宝','Allow Alipay'))}
     {check('alipayReleased',t('我已在小豆商户端确认支付宝通道及当前交易形态已开通','I confirmed Alipay and this trade scope are enabled in Xiaodou merchant settings'),'小豆没有通道能力查询接口；仅打开通道开关不会绕过此确认条件。')}
     {check('wechatEnabled',t('允许展示微信支付','Allow WeChat Pay'))}
     {check('wechatReleased',t('我已在小豆商户端确认微信通道及当前交易形态已开通','I confirmed WeChat Pay and this trade scope are enabled in Xiaodou merchant settings'),'微信 H5 的支付形态受浏览器限制；普通浏览器不会假装是微信 JSAPI。')}
    </div>
    <p>{t('实际生效方式','Effective payment methods')}: {control.methods.length?control.methods.map(x=>`${x.provider} / ${x.channel}`).join('、'):'无'}</p>
    <Button disabled={locked||reason.trim().length<8} onClick={()=>void saveSettings()}>{t('保存接口与通道设置','Save provider and channel settings')}</Button>
    <div><Button variant="outline" disabled={locked||!control.providers.rsa2.credentialsConfigured} onClick={()=>void checkPlatform()}>{t('RSA2 只读连通性检查','RSA2 read-only connectivity check')}</Button>{platformCheck&&<p role="status">{platformCheck.ok?t(`响应验签通过 · requestId ${platformCheck.requestId}`,'Response signature verified · requestId '+platformCheck.requestId):t(`未通过：${platformCheck.errorCode} · HTTP ${platformCheck.upstreamHttpStatus??'无响应'} · requestId ${platformCheck.requestId}`,`Not verified: ${platformCheck.errorCode} · HTTP ${platformCheck.upstreamHttpStatus??'no response'} · requestId ${platformCheck.requestId}`)}</p>}</div>
    <div className="space-y-2 border-t pt-4"><p>{t('全站购买总开关','Global purchase switch')}</p><Button disabled={locked||reason.trim().length<8||(!control.operatorEnabled&& !control.environmentReady)} onClick={()=>control.operatorEnabled?void togglePurchase(false):setConfirmEnable(true)}>{control.operatorEnabled?t('关闭新购买','Disable new purchases'):t('开启新购买','Enable new purchases')}</Button>
     {confirmEnable&&!control.operatorEnabled&&<div role="alert" className="space-y-2"><p>{t('确认开启新购买？只会显示具备凭证和平台开通条件的支付方式。','Enable new purchases? Only methods with credentials and confirmed platform release will be shown.')}</p><Button disabled={locked||reason.trim().length<8} onClick={()=>void togglePurchase(true)}>{t('确认开启','Confirm')}</Button><Button variant="outline" disabled={locked} onClick={()=>setConfirmEnable(false)}>{t('取消','Cancel')}</Button></div>}
    </div>
   </>}
  </CardContent></Card>
  <Card><CardHeader><CardTitle>{t('账户安全','Account security')}</CardTitle></CardHeader><CardContent className="space-y-3"><p>{t('修改密码后其他网页登录和扩展会话将退出，当前会话保留；敏感操作需重新验证。','Changing your password signs out other web and extension sessions. This session stays active and sensitive actions require re-verification.')}</p>
   <Label htmlFor="admin-old-password">{t('原密码','Current password')}</Label><Input id="admin-old-password" type="password" autoComplete="current-password" disabled={locked} value={oldPassword} onChange={e=>setOld(e.target.value)}/>
   <Label htmlFor="admin-new-password">{t('新密码（至少12位，字母、数字、符号中至少两类）','New password (12+ characters, two character types)')}</Label><Input id="admin-new-password" type="password" autoComplete="new-password" disabled={locked} value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
   <Label htmlFor="admin-confirm-password">{t('确认新密码','Confirm new password')}</Label><Input id="admin-confirm-password" type="password" autoComplete="new-password" disabled={locked} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/>
   <Button disabled={locked||reason.trim().length<8||!oldPassword||newPassword.length<12||newPassword!==confirmPassword} onClick={()=>void changePassword()}>{t('修改密码','Change password')}</Button><Button variant="outline" disabled={locked||reason.trim().length<8} onClick={()=>void revoke()}>{t('退出其他所有会话','Sign out all other sessions')}</Button>
  </CardContent></Card>
 </div>;
}
