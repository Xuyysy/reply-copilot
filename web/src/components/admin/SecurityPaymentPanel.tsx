import {useEffect,useRef,useState} from 'react';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {Label} from '../ui/label';
import {Card,CardHeader,CardTitle,CardContent} from '../ui/card';
import type {Language} from '../../lib/language';

type Toggle={enabled:boolean;credentialsConfigured?:boolean;platformReleased?:boolean};
type Availability=Toggle&{available:boolean;reasons:string[]};
type Control={environmentReady:boolean;operatorEnabled:boolean;globalEffectiveEnabled:boolean;effectiveEnabled:boolean;providers:{rsa2:Toggle;epay:Toggle};channels:{rsa2:{alipay:Toggle;wechat:Toggle};epay:{alipay:Toggle};alipay?:Toggle;wechat?:Toggle};availability:{rsa2:{alipay:Availability;wechat:Availability};epay:{alipay:Availability}};methods:Array<{provider:string;channel:string}>};
type Settings={rsa2Enabled:boolean;rsa2WechatEnabled:boolean;rsa2AlipayEnabled:boolean;rsa2WechatReleased:boolean;rsa2AlipayReleased:boolean;epayEnabled:boolean;epayAlipayEnabled:boolean;epayAlipayReleased:boolean};
type Props={language:Language;busy:boolean;read:(path:string)=>Promise<any>;write:(path:string,body:Record<string,unknown>)=>Promise<any>};
const initial:Settings={rsa2Enabled:true,rsa2WechatEnabled:false,rsa2AlipayEnabled:true,rsa2WechatReleased:false,rsa2AlipayReleased:false,epayEnabled:false,epayAlipayEnabled:true,epayAlipayReleased:false};

export default function SecurityPaymentPanel({language,busy,read,write}:Props){
 const zh=language==='zh',t=(a:string,b:string)=>zh?a:b;
 const [control,setControl]=useState<Control|null>(null),[settings,setSettings]=useState<Settings>(initial),[error,setError]=useState(''),[oldPassword,setOld]=useState(''),[newPassword,setNew]=useState(''),[confirmPassword,setConfirm]=useState(''),[reason,setReason]=useState('');
 const [platformCheck,setPlatformCheck]=useState<any>(null),[pendingRelease,setPendingRelease]=useState<{channel:'wechat'|'rsa2Alipay'|'epayAlipay';provider:'rsa2'|'epay'}|null>(null);
 const load=()=>read('/v1/admin/payment-control').then((data:Control)=>{setControl(data);setSettings({rsa2Enabled:data.providers.rsa2.enabled,epayEnabled:data.providers.epay.enabled,rsa2AlipayEnabled:data.channels.rsa2.alipay.enabled,rsa2WechatEnabled:data.channels.rsa2.wechat.enabled,rsa2AlipayReleased:data.channels.rsa2.alipay.platformReleased,rsa2WechatReleased:data.channels.rsa2.wechat.platformReleased,epayAlipayEnabled:data.channels.epay.alipay.enabled,epayAlipayReleased:data.channels.epay.alipay.platformReleased});}).catch((e:unknown)=>setError(e instanceof Error?e.message:String(e)));
 useEffect(()=>{void load();},[]);
 const mutationGuard=useRef(false),[pending,setPending]=useState(false),[notice,setNotice]=useState(''),[confirmEnable,setConfirmEnable]=useState(false);
 const locked=busy||pending;
 const status=(enabled:boolean)=>enabled?t('已开启','Enabled'):t('已关闭','Disabled');
 const unavailableReason=(reason:string)=>({environment_protection:t('环境保护开关关闭','Environment safety switch is off'),purchase_paused:t('全站收款已暂停','Global purchases are paused'),interface_disabled:t('支付接口未启用','Payment interface is disabled'),credentials_missing:t('支付凭证未配置或格式无效','Payment credentials are missing or invalid'),channel_disabled:t('该接口下的支付渠道未启用','This interface channel is disabled'),platform_release_unconfirmed:t('尚未确认小豆已放行该通道和交易形态','Xiaodou release for this channel and trade scope is unconfirmed'),channel_not_supported:t('该接口不支持此支付渠道','This interface does not support this channel')} as Record<string,string>)[reason]??reason;
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
 async function checkPlatform(){await mutate(async()=>{const result=await write('/v1/admin/payment-platform-check',{});setPlatformCheck(result);setNotice(result.ok?t('RSA2 只读接口响应已验签；这不代表具体支付通道已获准。','The RSA2 read-only response signature verified. This does not confirm any payment channel is released.'):t('RSA2 只读检查未通过；请查看安全错误码。','RSA2 read-only check did not pass. Review the safe error code.'));});}
 async function changePassword(){await mutate(async()=>{await write('/v1/admin/security/password',{oldPassword,newPassword,confirmPassword,reason});setOld('');setNew('');setConfirm('');setNotice(t('密码已修改，其他会话已退出。下次敏感操作需要重新验证。','Password changed. Other sessions are signed out; verify again for the next sensitive action.'));});}
 async function revoke(){await mutate(async()=>{await write('/v1/admin/security/sessions/revoke-others',{reason});setNotice(t('其他所有会话已退出，当前会话保留。','All other sessions are signed out. This session stays active.'));});}
 const switchRow=(key:'rsa2Enabled'|'epayEnabled'|'rsa2WechatEnabled'|'rsa2AlipayEnabled'|'epayAlipayEnabled',label:string,availability?:Availability,provider?:'rsa2'|'epay',channel?:'wechat'|'rsa2Alipay'|'epayAlipay')=><label className="flex items-start gap-3 rounded-md border p-3"><input type="checkbox" disabled={locked} checked={settings[key]} onChange={e=>provider&&channel?setChannel(channel,provider,e.target.checked):setSettings(current=>({...current,[key]:e.target.checked}))}/><span className="min-w-0 flex-1"><strong>{label}</strong>{availability&&<small className="block text-muted-foreground">{availabilityText(availability)}</small>}</span></label>;
 return <div className="space-y-6">
  <Label htmlFor="admin-security-reason">{t('操作原因（至少8字）','Reason for this action (8+ characters)')}</Label><Input id="admin-security-reason" value={reason} onChange={e=>setReason(e.target.value)}/>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <Card><CardHeader><CardTitle>{t('支付管理','Payment management')}</CardTitle></CardHeader><CardContent className="space-y-4">
   {control&&<>
    <div role="status" className="rounded-lg border p-4">
     <strong>{!control.environmentReady?t('暂不可收款：环境保护未就绪','Unavailable: environment safety is not ready'):!control.operatorEnabled?t('已暂停收款：全站购买开关关闭','Sales paused: global purchase switch is off'):control.effectiveEnabled?t('可以正常收款','Ready to accept payments'):t('暂不可收款','Not ready to accept payments')}</strong>
     {!control.effectiveEnabled&&control.operatorEnabled&&control.environmentReady&&<p className="mt-1">{t('原因：','Reason: ')}{[
      ...(!control.providers.rsa2.credentialsConfigured&&!control.providers.epay.credentialsConfigured?[t('支付凭证未配置','Payment credentials are not ready')]:[]),
      ...(!settings.rsa2WechatReleased?[t('RSA2 微信通道放行尚未确认','RSA2 WeChat release is unconfirmed')]:[]),
      ...(!settings.rsa2AlipayReleased?[t('RSA2 支付宝通道放行尚未确认','RSA2 Alipay release is unconfirmed')]:[]),
      ...(!settings.epayAlipayReleased?[t('易支付支付宝放行尚未确认','Epay Alipay release is unconfirmed')]:[]),
     ].join('；')}</p>}
    </div>
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
     {switchRow('epayEnabled',t('启用易支付新订单','Enable Epay for new orders'))}
     {switchRow('epayAlipayEnabled',t('支付宝','Alipay'),control.availability.epay.alipay,'epay','epayAlipay')}
     <p className="pl-8 text-sm">{t('平台放行','Platform release')}: {status(settings.epayAlipayReleased)}{settings.epayAlipayReleased&&<Button className="ml-2" variant="outline" size="sm" disabled={locked} onClick={()=>revokePlatformRelease('epayAlipayReleased')}>{t('撤销确认','Revoke confirmation')}</Button>}</p>
     <p className="text-xs text-muted-foreground">{t('易支付目前只支持支付宝新订单；历史通知仍按原协议验签。','Epay supports Alipay only for new orders. Historical notifications continue using their original verification protocol.')}</p>
    </section>
    {pendingRelease&&<div role="alert" className="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4">
     <p>{t('请先确认你已在小豆商户后台核实该支付接口、通道和当前申报交易形态已获准。此勾选只记录人工确认，不会查询或改变小豆权限。','Confirm that the provider, channel, and declared trade scope are approved in Xiaodou merchant settings. This records your confirmation only; it does not query or change Xiaodou permissions.')}</p>
     <Button disabled={locked} onClick={confirmChannelRelease}>{t('我已核实，确认并启用通道','Verified — confirm and enable')}</Button><Button variant="outline" disabled={locked} onClick={()=>setPendingRelease(null)}>{t('取消','Cancel')}</Button>
    </div>}
    <p>{t('当前实际可用的付款方式','Currently available payment methods')}: {control.methods.length?control.methods.map(x=>`${x.provider==='xiaodou'?'RSA2':'Epay'} / ${x.channel}`).join('、'):'无'}</p>
    <Button disabled={locked||reason.trim().length<8} onClick={()=>void saveSettings()}>{t('保存支付接口设置','Save payment settings')}</Button>
    <div className="space-y-2 border-t pt-4"><p>{t('全站收款总开关','Global purchase switch')}</p><Button disabled={locked||reason.trim().length<8||(!control.operatorEnabled&&!control.environmentReady)} onClick={()=>control.operatorEnabled?void togglePurchase(false):setConfirmEnable(true)}>{control.operatorEnabled?t('暂停全站收款','Pause all sales'):t('开启全站收款','Enable all sales')}</Button>
     {confirmEnable&&!control.operatorEnabled&&<div role="alert" className="space-y-2"><p>{t('确认开启全站收款？只有接口、凭证、通道及平台放行条件全部满足的付款方式才会展示。','Enable global sales? Only methods passing interface, credentials, channel, and platform release gates will be shown.')}</p><Button disabled={locked||reason.trim().length<8} onClick={()=>void togglePurchase(true)}>{t('确认开启','Confirm')}</Button><Button variant="outline" disabled={locked} onClick={()=>setConfirmEnable(false)}>{t('取消','Cancel')}</Button></div>}
    </div>
    <details className="border-t pt-3">
     <summary className="cursor-pointer font-medium">{t('高级设置','Advanced settings')}</summary>
     <div className="space-y-3 pt-3"><p>{t('环境支付保护','Environment safety ceiling')}: {status(control.environmentReady)} · {t('数据库购买设置','Database purchase setting')}: {status(control.operatorEnabled)}</p>
      <Button variant="outline" disabled={locked||!control.providers.rsa2.credentialsConfigured} onClick={()=>void checkPlatform()}>{t('RSA2 只读连通性检查','RSA2 read-only connectivity check')}</Button>
      {platformCheck&&<p role="status">{platformCheck.ok?t(`响应验签通过 · requestId ${platformCheck.requestId}`,'Response signature verified · requestId '+platformCheck.requestId):t(`未通过：${platformCheck.errorCode} · HTTP ${platformCheck.upstreamHttpStatus??'无响应'} · requestId ${platformCheck.requestId}`,`Not verified: ${platformCheck.errorCode} · HTTP ${platformCheck.upstreamHttpStatus??'no response'} · requestId ${platformCheck.requestId}`)}</p>}
     </div>
    </details>
    <p className="text-xs text-muted-foreground">{t('平台放行状态按支付接口分别保存；关闭新单开关不影响历史订单通知与查询。','Platform release is stored separately per provider. Disabling new sales does not stop historical order notifications or queries.')}</p>
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
