import {useEffect,useMemo,useState} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Badge} from "../ui/badge";
import {Button} from "../ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "../ui/table";

type Network="TRC20"|"POLYGON"|"BEP20";
type BoltOrder={
  id:string;external_order_id:string;network:Network;token_contract:string;token_decimals:number;
  user_id:string;email:string;product_type:"credits"|"subscription";
  credit_order_id:string|null;subscription_order_id:string|null;
  quoted_usdt_micros:number;payable_usdt_micros:number|null;paid_usdt_micros:number|null;
  tx_hash:string|null;status:string;paid_at:number|null;applied_at:number|null;created_at:number;
};
type AdminResponse={orders:BoltOrder[];available:boolean;networks:Network[];currency:"USDT";note:string};
type PublicResponse={available:boolean;networks:Network[];currency:"USDT";independentMerchant:boolean};
type MainnetProbe={id:string;externalOrderId:string;network:Network;requestedAmount:string;amount:string|null;
 address:string|null;checkoutUrl:string|null;expiresAt:number|null;status:string;providerStatus:string|null;
 txHash:string|null;paidAt:number|null;createdAt:number;noEntitlement:true;mainnet:true};
type MainnetProbes={enabled:boolean;orders:MainnetProbe[];amount:string;mainnet:true};
type AdminWrite=<T,>(path:string,body:object)=>Promise<T>;
const NETWORKS:Array<{code:Network;label:string;chain:string}>=[
  {code:"TRC20",label:"TRON · TRC20",chain:"TRON"},
  {code:"POLYGON",label:"Polygon PoS",chain:"Polygon"},
  {code:"BEP20",label:"BNB Smart Chain · BEP20",chain:"BNB"}
];
function usdt(value:number|null):string{
  if(value===null||!Number.isSafeInteger(value)||value<0)return "—";
  const micros=BigInt(value),fraction=(micros%1000000n).toString().padStart(6,"0").replace(/0+$/,"");
  return (micros/1000000n).toString()+(fraction?"."+fraction:"")+" USDT";
}
function when(value:number|null):string{
  return typeof value==="number"&&Number.isFinite(value)?new Date(value).toLocaleString():"—";
}
export default function AdminBoltUtilPanel({active,language,write}:{active:boolean;language:Language;write:AdminWrite}){
  const t=(zh:string,en:string)=>phrase(language,zh,en);
  const [data,setData]=useState<AdminResponse|null>(null);
  const [probes,setProbes]=useState<MainnetProbes|null>(null);
  const [testNetwork,setTestNetwork]=useState<Network>("TRC20");
  const [testBusy,setTestBusy]=useState(false);
  const [testError,setTestError]=useState("");
  const [testNotice,setTestNotice]=useState("");
  const [testDiagnostic,setTestDiagnostic]=useState("");
  const [availability,setAvailability]=useState<PublicResponse|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [reload,setReload]=useState(0);
  const [query,setQuery]=useState("");
  const [network,setNetwork]=useState<"all"|Network>("all");
  useEffect(()=>{
    if(!active)return;
    let live=true;
    setLoading(true);setError("");
    void Promise.all([
      api<AdminResponse>("/v1/admin/boltutil/orders"),
      api<PublicResponse>("/v1/boltutil/availability"),
      api<MainnetProbes>("/v1/admin/boltutil/test-orders")
    ]).then(([orders,status,tests])=>{
      if(!live)return;
      setData(orders);setAvailability(status);setProbes(tests);
    }).catch((cause:unknown)=>{
      if(live)setError(cause instanceof Error?cause.message:t("读取 USDT 收款状态失败。","Unable to load USDT payment status."));
    }).finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[active,reload]);
  const items=useMemo(()=>{
    const word=query.trim().toLowerCase();
    return (data?.orders||[]).filter(o=>(network==="all"||o.network===network)&&
      (!word||[o.external_order_id,o.id,o.email,o.user_id,o.tx_hash||"",o.status].some(v=>v.toLowerCase().includes(word))));
  },[data,query,network]);
  async function createMainnetTest(){
    if(testBusy||!probes?.enabled)return;
    const message=t("这是真实主网支付：将为 "+testNetwork+" 创建一笔约 1 USDT 的收银台订单。实际金额以 BoltUtil 返回为准；不会发放用户额度。确认继续？",
      "REAL MAINNET: Create a ~1 USDT invoice on "+testNetwork+". Pay the exact returned amount. No customer entitlements will be granted. Continue?");
    if(!window.confirm(message))return;
    setTestBusy(true);setTestError("");setTestNotice("");
    try{
      const result=await write<{order:MainnetProbe}>("/v1/admin/boltutil/test-orders",{
        network:testNetwork,confirm:"I_ACCEPT_REAL_1_USDT_MAINNET",
        reason:"Staging 专用 USDT 小额实付测试 "+testNetwork
      });
      setTestNotice(result.order.status==="pending"
        ?t("真实测试订单已创建。请确认收款链、地址与实际金额后再转账。","Real invoice created. Verify network, address and exact amount before paying.")
        :t("平台创建结果不明确，请先核对原订单，勿重复创建。","Creation outcome uncertain. Check the original order; do not duplicate."));
      setReload(x=>x+1);
    }catch(e){setTestError(e instanceof Error?e.message:String(e));}
    finally{setTestBusy(false);}
  }
  async function diagnoseMainnetTest(id:string){
    if(testBusy)return;
    setTestBusy(true);setTestError("");setTestDiagnostic("");
    try{
      const r=await write<{readOnly:true;ping:{kind:string;httpStatus:number|null;providerCode:string|null};
        status:null|{kind:string;httpStatus:number|null;providerCode:string|null;orderStatus:string|null};
        localStatus:string;nextStep:string}>("/v1/admin/boltutil/test-orders/"+id+"/diagnose",{
        reason:"仅诊断原有 Staging USDT 测试订单商户连接，不创建新订单"
      });
      const describe=(v:{kind:string;httpStatus:number|null;providerCode:string|null})=>
        v.kind+" (HTTP "+(v.httpStatus??"network")+" / code "+(v.providerCode??"none")+")";
      setTestDiagnostic("BoltUtil API Key: "+describe(r.ping)+
        "；原订单查询："+(r.status?describe(r.status)+(r.status.orderStatus?" / "+r.status.orderStatus:""):"跳过")+
        "；建议："+r.nextStep);
    }catch(e){setTestError(e instanceof Error?e.message:String(e));}
    finally{setTestBusy(false);}
  }
  async function refreshMainnetTest(id:string){
    if(testBusy)return;setTestBusy(true);setTestError("");setTestNotice("");
    try{
      const result=await write<{order:MainnetProbe}>("/v1/admin/boltutil/test-orders/"+id+"/refresh",{
        reason:"Staging USDT 实付订单可信平台状态查询"
      });
      setTestNotice(t("平台已返回：","Provider status: ")+(result.order.providerStatus||result.order.status));
      setReload(x=>x+1);
    }catch(e){setTestError(e instanceof Error?e.message:String(e));}finally{setTestBusy(false);}
  }
  const enabledNetworks=availability?.networks||[];
  const settled=(data?.orders||[]).filter(o=>o.status==="paid"&&o.applied_at!==null).length;
  const review=(data?.orders||[]).filter(o=>o.status==="manual_review"||
    (o.status==="paid"&&o.applied_at===null)).length;
  return <div className="space-y-4" data-testid="admin-boltutil-usdt">
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("USDT 收款 · 独立通道","USDT payments · Independent rail")}</CardTitle>
          <Badge variant={availability?.available?"secondary":"outline"}>
            {availability?.available?t("已开放收款","Accepting payments"):t("收款尚未开放","Payments disabled")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("BoltUtil 的 TRON、Polygon、BNB Smart Chain 与 MK99／小豆的商户选择完全独立。",
             "BoltUtil on TRON, Polygon and BNB Smart Chain is independent of the MK99/Xiaodou merchant selector.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {NETWORKS.map(n=><div className="rounded-lg border p-3" key={n.code}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">{n.label}</strong>
              <Badge variant={enabledNetworks.includes(n.code)?"secondary":"outline"}>
                {enabledNetworks.includes(n.code)?t("已启用","Enabled"):t("未开放","Disabled")}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">USDT · {n.code}</p>
          </div>)}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {availability?.available
            ?t("已启用网络以独立开关为准。请确认 BoltUtil 钱包和定价配置，才能进行真实付款验收。",
               "Networks use independent switches. Verify merchant wallet and quote configuration before live payment acceptance.")
            :t("Staging 的 USDT 页面和后端已部署，但收款密钥／报价／独立开关尚未配置，因此全部网络保持关闭。无需切换 MK99 或小豆。",
               "Staging UI and API are deployed, but payment secrets, price quote and independent switches are not configured. All networks remain disabled regardless of MK99/Xiaodou.")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("此页只读，不会创建订单、改变商户、修改密钥或发放权益。密钥仅通过 Cloudflare Worker Secrets 配置，不在网页中展示或输入。",
             "Read-only: no invoice creation, merchant changes, secret updates or entitlement grants. API keys belong in Cloudflare Worker Secrets, never in this page.")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={loading} onClick={()=>setReload(x=>x+1)}>
            {loading?t("刷新中…","Refreshing…"):t("刷新通道和订单","Refresh network and orders")}
          </Button>
          <a href="/usdt-checkout/" className="text-sm text-blue-700 underline">
            {t("查看用户端三链预览","Preview customer checkout")}
          </a>
        </div>
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
    <Card data-testid="admin-boltutil-mainnet-test">
      <CardHeader>
        <CardTitle>{t("管理员专用 · 三链 1 USDT 实付测试","Admin only · 1 USDT mainnet payment tests")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("只有 Staging 管理员可创建，要求重新验证管理员密码。每条链单独验收；最多 24 小时 3 笔。不会给任何用户发放额度或订阅。",
        "Staging admin and fresh password verification only. Test each chain separately, at most 3 invoices per 24 hours. No credits or subscriptions are granted.")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Badge variant={probes?.enabled?"secondary":"outline"}>{probes?.enabled?t("专用测试已启用","Test enabled"):t("专用测试未启用","Test disabled")}</Badge>
        <div className="flex flex-wrap gap-3 items-center">
          <select className="h-10 rounded-md border px-3" aria-label={t("选择小额测试网络","Small-payment test network")}
            value={testNetwork} onChange={e=>setTestNetwork(e.target.value as Network)}>
            {NETWORKS.map(n=><option key={n.code} value={n.code}>{n.label}</option>)}
          </select>
          <Button disabled={!probes?.enabled||testBusy} onClick={()=>void createMainnetTest()}>
            {testBusy?t("正在处理…","Working…"):t("确认创建约 1 USDT 主网测试单","Create ~1 USDT MAINNET invoice")}
          </Button>
        </div>
        <p className="text-sm text-amber-800">{t("付款使用真实主网 USDT 和链上手续费。不要向代币合约地址转账，不要取整 BoltUtil 实际应付金额。公共 USDT 收款仍保持关闭。",
          "REAL MAINNET funds and network fees. Do not transfer to token contract; never round the exact payable. Public USDT checkout remains disabled.")}</p>
        {testNotice&&<p role="status" className="text-sm text-green-700">{testNotice}</p>}
        {testDiagnostic&&<p role="status" className="text-sm break-words rounded border p-3">{testDiagnostic}</p>}
        {testError&&<p role="alert" className="text-sm text-red-700">{testError}</p>}
        {(probes?.orders||[]).map(o=><div key={o.id} className="rounded-lg border p-3 space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{o.network} · {o.amount||"—"} USDT</strong><Badge variant="outline">{o.providerStatus||o.status}</Badge></div>
          <p className="break-all text-xs text-muted-foreground">{o.externalOrderId}</p>
          {!o.checkoutUrl&&o.status==="unknown"&&<p className="text-sm text-red-700">{t("平台尚未确认创建成功，没有支付链接。请先点击只读诊断，不要再次创建或转账。","Merchant has not confirmed the invoice. Diagnose before another attempt; do not transfer funds.")}</p>}
          {o.providerStatus?.startsWith("CREATE_")&&<p role="status" className="rounded border px-3 py-2 text-sm">
             {t("平台创建诊断码：","Provider create diagnostic code: ")}<code>{o.providerStatus}</code>
             <span className="block text-xs text-muted-foreground">{t("只含阶段、HTTP 状态与平台业务码，不包含任何密钥或钱包信息。","Only stage, HTTP status and provider business code; no secrets or wallet details.")}</span>
          </p>
          {o.address&&<p className="break-all">{t("收款地址：","Receiving address: ")}{o.address}</p>}
          {o.txHash&&<p className="break-all">{t("交易哈希：","Transaction hash: ")}{o.txHash}</p>}
          {o.expiresAt&&<p>{t("截止：","Expires: ")}{new Date(o.expiresAt).toLocaleString()}</p>}
          <div className="flex gap-2 flex-wrap">
            {o.checkoutUrl&&<a href={o.checkoutUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md border px-3 py-2 text-blue-700">{t("打开 BoltUtil 收银台","Open BoltUtil checkout")}</a>}
            <Button variant="outline" disabled={testBusy} onClick={()=>void refreshMainnetTest(o.id)}>{t("核验平台支付状态","Verify provider status")}</Button>
            <Button variant="outline" disabled={testBusy} onClick={()=>void diagnoseMainnetTest(o.id)}>{t("只读诊断：为何没有收银台","Diagnose missing checkout (read-only)")}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("独立测试订单 · 不会触发商品权益发放。","Independent diagnostic invoice · never grants product entitlements.")}</p>
        </div>)}
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle>{t("USDT 独立订单与异常记录","USDT orders and review queue")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("USDT 收入以币种单独记录，不计入人民币营业收入。下表最多展示最近 100 笔。",
             "USDT receipts are recorded separately and are never added to CNY revenue. Showing up to 100 recent orders.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t("订单数","Orders")}</div><div className="mt-1 font-semibold tabular-nums">{data?.orders.length??"—"}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t("付款并已发权益","Paid and applied")}</div><div className="mt-1 font-semibold tabular-nums">{data?settled:"—"}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t("待人工复核／待发权益","Review / unapplied")}</div><div className="mt-1 font-semibold tabular-nums">{data?review:"—"}</div></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm" aria-label={t("搜索订单、用户或交易哈希","Search orders, users or transaction hashes")}
            placeholder={t("订单号、邮箱、用户 ID、交易哈希","Order, email, user ID, tx hash")}
            value={query} onChange={e=>setQuery(e.target.value)}/>
          <select aria-label={t("筛选网络","Filter by network")} className="h-10 rounded-md border px-3 text-sm"
            value={network} onChange={e=>setNetwork(e.target.value as "all"|Network)}>
            <option value="all">{t("全部网络","All networks")}</option>
            {NETWORKS.map(n=><option value={n.code} key={n.code}>{n.label}</option>)}
          </select>
        </div>
        <div className="data-table-wrap admin-list-scroll" role="region" tabIndex={0} aria-label={t("USDT 收款订单","USDT payment orders")}>
          <Table>
            <TableHeader><TableRow>
              {[t("时间","Time"),t("订单／用户","Order / user"),t("链","Network"),t("商品","Product"),
                t("应付","Payable"),t("已付","Paid"),t("状态","Status"),t("权益","Entitlement")].map(v=><TableHead key={v}>{v}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {items.map(o=><TableRow key={o.id}>
                <TableCell className="whitespace-nowrap text-xs">{when(o.created_at)}</TableCell>
                <TableCell className="max-w-52 break-all text-xs">
                  <span className="font-semibold">{o.external_order_id}</span>
                  <div className="text-muted-foreground">{o.email}</div>
                  {o.tx_hash&&<div title={o.tx_hash} className="text-muted-foreground">{o.tx_hash.slice(0,12)}…</div>}
                </TableCell>
                <TableCell className="text-xs">{o.network}</TableCell>
                <TableCell className="text-xs">{o.product_type==="credits"?t("永久额度","Credits"):t("订阅","Subscription")}</TableCell>
                <TableCell className="whitespace-nowrap text-xs tabular-nums">{usdt(o.payable_usdt_micros)}</TableCell>
                <TableCell className="whitespace-nowrap text-xs tabular-nums">{usdt(o.paid_usdt_micros)}</TableCell>
                <TableCell className="text-xs">{o.status==="manual_review"?t("人工复核","Manual review"):o.status==="paid"?t("已确认付款","Confirmed"):o.status}</TableCell>
                <TableCell className="text-xs">{o.applied_at!==null?t("已到账","Applied"):t("未发放","Not applied")}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
          {!loading&&data&&items.length===0&&<p className="px-3 py-5 text-sm text-muted-foreground">
            {t("暂无匹配的 USDT 订单。当前未开放收款时这里为空是正常的。","No matching USDT orders. This is expected while payments are disabled.")}
          </p>}
        </div>
      </CardContent>
    </Card>
  </div>;
}
