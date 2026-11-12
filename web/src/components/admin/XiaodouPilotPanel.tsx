import {useEffect,useState} from 'react';
import {Button} from '../ui/button';
import type {Language} from '../../lib/language';

type PilotStatus={eligible:boolean;blockers:string[];packageId:string;packageName:string|null;
  credits:number|null;amountFen:number|null;limitFen:number;attemptsPer24h:number;activeMerchant:string};
type Checkout={order?:{id?:string;paymentUrl?:string|null;amountFen?:number;status?:string;
  checkout?:{outcome?:string;issue?:string}};requestId?:string;ok?:boolean;message?:string;code?:string};
type Props={language:Language;busy:boolean;read:(path:string)=>Promise<any>;
  write:(path:string,body:Record<string,unknown>)=>Promise<any>};
const reason='管理员小豆生产环境支付宝真实小额验收';
const descriptions:Record<string,string>={
  production_only:'只在 Production 可用',
  pilot_disabled:'独立测试开关尚未开启',
  vendor_approval_unconfirmed:'尚未独立确认小豆批准当前支付宝通道及售卖业务',
  mk99_must_remain_active:'必须先保持 MK99 为全站当前商户',
  global_sales_paused:'生产环境付款总开关已关闭',
  rsa2_unavailable:'小豆 RSA2 配置或支付宝接口未就绪',
  network_or_webhook_unavailable:'小豆来源 IP 接入模式或 Webhook 未确认',
  starter_price_exceeds_limit:'入门包已下架或价格超出 ¥10 限额',
  daily_test_attempt_used:'24 小时内已尝试创建过真实测试订单，禁止重复发起'
};

export default function XiaodouPilotPanel({language,busy,read,write}:Props){
 const zh=language==='zh',t=(a:string,b:string)=>zh?a:b;
 const [state,setState]=useState<PilotStatus|null>(null),[loading,setLoading]=useState(true),
   [working,setWorking]=useState(false),[approved,setApproved]=useState(false),
   [error,setError]=useState(''),[checkout,setCheckout]=useState<Checkout|null>(null),
   [verifiedStatus,setVerifiedStatus]=useState('');
 async function load(){setLoading(true);try{setState(await read('/v1/admin/payments/xiaodou/pilot'));setError('');}
 catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function create(){
   if(!state?.eligible||!approved||working||busy||state.amountFen===null)return;
   setWorking(true);setError('');setCheckout(null);setVerifiedStatus('');
   try{
     const result=await write('/v1/admin/payments/xiaodou/pilot',{
       packageId:'starter',expectedAmountFen:state.amountFen,confirmation:'CREATE_REAL_ALIPAY_TEST_ORDER',reason});
     setCheckout(result);
   }catch(e){setError(e instanceof Error?e.message:String(e));}
   finally{setWorking(false);void load();}
 }
 async function refresh(){
  const id=checkout?.order?.id;if(!id||working||busy)return;
  setWorking(true);setVerifiedStatus('');setError('');
  try{
   const r=await write('/v1/orders/'+encodeURIComponent(id)+'/refresh',{reason:'管理员主动执行小豆验收订单签名查单'});
   setVerifiedStatus(t('已通过平台签名查单，当前状态：','Signed provider lookup completed, current status: ')+String(r.orderStatus??'unknown'));
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setWorking(false);}
 }
 const payUrl=checkout?.order?.paymentUrl;
 const safePayUrl=typeof payUrl==='string'&&/^https:\/\/[^\s<>"']+$/i.test(payUrl)?payUrl:null;
 return <section className="rounded-xl border p-4 space-y-3" aria-label="生产环境小豆真实验收">
   <h3 className="font-semibold">{t('小豆 Production 真实付款验收 · 仅管理员','Xiaodou Production paid pilot · administrator only')}</h3>
   <p className="text-sm text-muted-foreground">{t('独立于全站收款商户。只能购买现有入门包，最高 ¥10，24 小时只能尝试 1 次。仅完成真实支付宝付款后才由可信回调或签名查单结算。','Independent of the live merchant. Existing starter package only, maximum CNY 10, one attempt per 24 hours. Entitlements settle only after a verified payment.')}</p>
   <p className="text-sm font-medium">{t('不会自动扣款；请仅在核实商户已批准支付宝及当前交易经营范围后开启测试。','No automatic charge. Verify merchant approval for Alipay and the declared trade scope before enabling this pilot.')}</p>
   {loading?<p role="status">{t('读取测试门禁…','Checking pilot readiness…')}</p>:state&&<>
     <p className="text-sm">{t('当前商户：','Live merchant: ')}{state.activeMerchant.toUpperCase()} · {t('测试金额：','Test amount: ')}{state.amountFen!==null?'¥'+(state.amountFen/100).toFixed(2):'—'} · {t('额度：','Credits: ')}{state.credits??'—'}</p>
     {!state.eligible&&<p role="status" className="text-sm text-amber-800">{t('尚不能创建真实订单：','Not ready for paid checkout: ')}{state.blockers.map(c=>zh?(descriptions[c]??c):c).join('；')}</p>}
     {state.eligible&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} disabled={busy||working}/><span>{t('我已核实平台交易许可，并确认要创建一笔真实支付宝测试订单，金额按页面所示。','I verified the merchant approval and agree to create a real-money test order at the displayed price.')}</span></label>}
     <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy||working||loading} onClick={()=>void load()}>{t('刷新测试状态','Refresh readiness')}</Button>
      <Button type="button" disabled={!state.eligible||!approved||busy||working} onClick={()=>void create()}>{working?t('正在处理…','Working…'):t('创建真实支付宝测试订单','Create REAL Alipay test order')}</Button>
     </div>
   </>}
   {error&&<p role="alert" className="text-sm text-red-700">{t('操作失败：','Error: ')}{error}</p>}
   {checkout&&<div className="rounded border p-3 space-y-2 text-sm">
     <p role="status">{t('测试订单已提交：','Test checkout submitted: ')}{checkout.order?.id??'—'} · {checkout.order?.checkout?.outcome??checkout.code??'unknown'}</p>
     {safePayUrl?<a className="underline font-medium" href={safePayUrl} target="_blank" rel="noopener noreferrer">{t('手动打开支付宝付款页面（真实扣款）','Open Alipay cashier manually (REAL CHARGE)')}</a>:<p>{checkout.message??t('未得到可信付款地址，请先核对原单，勿重复创建。','No verified cashier URL. Reconcile the original order before trying again.')}</p>}
     {checkout.order?.id&&<Button type="button" variant="outline" disabled={busy||working} onClick={()=>void refresh()}>{t('签名查单并核对到账','Signed payment status check')}</Button>}
     {verifiedStatus&&<p role="status">{verifiedStatus}</p>}
   </div>}
 </section>;
}
