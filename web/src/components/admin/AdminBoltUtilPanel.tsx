import {useEffect,useMemo,useState} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Badge} from "../ui/badge";
import {Button} from "../ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "../ui/card";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "../ui/table";

type Network="TRC20"|"POLYGON"|"BEP20"|"ERC20"|"SOLANA";
type BoltOrder={
  id:string;external_order_id:string;network:Network;token_contract:string;token_decimals:number;
  user_id:string;email:string;product_type:"credits"|"subscription";
  credit_order_id:string|null;subscription_order_id:string|null;
  quoted_usdt_micros:number;payable_usdt_micros:number|null;paid_usdt_micros:number|null;
  tx_hash:string|null;status:string;paid_at:number|null;applied_at:number|null;created_at:number;
};
type AdminResponse={orders:BoltOrder[];available:boolean;networks:Network[];currency:"USDT";note:string};
type PublicResponse={available:boolean;networks:Network[];currency:"USDT";independentMerchant:boolean};
type Switches=Record<Network,boolean>;
type AdminControl={
  operatorEnabled:boolean;operatorNetworks:Switches;revision:string;
  environmentReady:boolean;schemaReady:boolean;creationApproved:boolean;
  credentialsConfigured:boolean;rateConfigured:boolean;
  environmentNetworks:Switches;effectiveNetworks:Network[];available:boolean;
  environment:string;
};
const NETWORKS:Array<{code:Network;label:string;chain:string}>=[
  {code:"TRC20",label:"TRON · TRC20",chain:"TRON"},
  {code:"POLYGON",label:"Polygon PoS",chain:"Polygon"},
  {code:"BEP20",label:"BNB Smart Chain · BEP20",chain:"BNB"},
  {code:"ERC20",label:"Ethereum Mainnet · ERC20",chain:"Ethereum"},
  {code:"SOLANA",label:"Solana Mainnet · SPL USDT",chain:"Solana"}
];
function usdt(value:number|null):string{
  if(value===null||!Number.isSafeInteger(value)||value<0)return "—";
  const micros=BigInt(value),fraction=(micros%1000000n).toString().padStart(6,"0").replace(/0+$/,"");
  return (micros/1000000n).toString()+(fraction?"."+fraction:"")+" USDT";
}
function when(value:number|null):string{
  return typeof value==="number"&&Number.isFinite(value)?new Date(value).toLocaleString():"—";
}
export default function AdminBoltUtilPanel({active,language,write}:{active:boolean;language:Language;write:(path:string,body:Record<string,unknown>)=>Promise<any>}){
  const t=(zh:string,en:string)=>phrase(language,zh,en);
  const [data,setData]=useState<AdminResponse|null>(null);
  const [availability,setAvailability]=useState<PublicResponse|null>(null);
  const [control,setControl]=useState<AdminControl|null>(null);
  const [draft,setDraft]=useState<{enabled:boolean;networks:Switches}|null>(null);
  const [reason,setReason]=useState("");
  const [review,setReview]=useState(false);
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
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
      api<AdminControl>("/v1/admin/boltutil/control")
    ]).then(([orders,status,settings])=>{
      if(!live)return;
      setData(orders);setAvailability(status);setControl(settings);
      setDraft({enabled:settings.operatorEnabled,networks:{...settings.operatorNetworks}});
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
  const enabledNetworks=availability?.networks||[];
  const dirty=Boolean(control&&draft&&(control.operatorEnabled!==draft.enabled||
    NETWORKS.some(n=>control.operatorNetworks[n.code]!==draft.networks[n.code])));
  const changeMaster=(value:boolean)=>{setDraft(s=>s?{...s,enabled:value}:s);setReview(false);setNotice("");};
  const changeNetwork=(network:Network,value:boolean)=>{setDraft(s=>s?{...s,networks:{...s.networks,[network]:value}}:s);setReview(false);setNotice("");};
  async function saveControl(){
    if(!draft||!control||!dirty||saving)return;
    setSaving(true);setError("");setNotice("");
    try{
      await write("/v1/admin/boltutil/control",{
        enabled:draft.enabled,networks:draft.networks,expectedRevision:control.revision,
        confirm:true,reason:reason.trim()
      });
      setReview(false);setReason("");
      setNotice(t("USDT 开关已保存；实际可用状态仍受服务端安全门禁约束。",
        "USDT switches saved; Cloudflare safety ceilings still determine live availability."));
      setReload(x=>x+1);
    }catch(cause){
      setError(cause instanceof Error?cause.message:t("保存失败，请刷新后重试。","Unable to save. Refresh and retry."));
    }finally{setSaving(false);}
  }
  const settled=(data?.orders||[]).filter(o=>o.status==="paid"&&o.applied_at!==null).length;
  const manualReviewCount=(data?.orders||[]).filter(o=>o.status==="manual_review"||
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
          {t("BoltUtil 五条 USDT 网络（TRON、Polygon、BNB Smart Chain、Ethereum、Solana）独立于 MK99／小豆人民币收款。",
             "BoltUtil supports five independent USDT networks: TRON, Polygon, BNB Smart Chain, Ethereum and Solana; separate from MK99/Xiaodou fiat payments.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-4 rounded-xl border p-4" aria-label={t("USDT 收款开关","USDT payment switches")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold">{t("USDT 收款总开关","USDT new-order master switch")}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{t("只影响新的 USDT 支付订单，历史付款、签名通知、查单及权益核验继续运行；不影响人民币收款。","Only blocks new USDT orders. Existing payments, signed notifications and reconciliation remain; fiat payments are unaffected.")}</p>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" aria-label={t("开启 USDT 收款","Enable USDT payments")}
                disabled={loading||saving||!draft} checked={draft?.enabled??false}
                onChange={e=>changeMaster(e.target.checked)}/>
              {draft?.enabled?t("拟开启","On"):t("关闭","Off")}
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {NETWORKS.map(n=><label key={n.code} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
              <input type="checkbox" className="mt-0.5"
                aria-label={t("开启 "+n.label,"Enable "+n.label)}
                disabled={loading||saving||!draft} checked={draft?.networks[n.code]??false}
                onChange={e=>changeNetwork(n.code,e.target.checked)}/>
              <span className="min-w-0"><span className="block font-medium">{n.label}</span>
                <span className="text-xs text-muted-foreground">
                  {control?.environmentNetworks[n.code]?
                    t("云端网络门禁已配置","Cloud network ceiling configured"):
                    t("云端网络门禁关闭","Cloud network ceiling disabled")}
                </span>
              </span>
            </label>)}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("环境","Environment")}: {control?.environment??"—"} ·
            {t("安全门禁","Cloud ceiling")}: {control?.environmentReady?t("就绪","Ready"):t("未就绪","Not ready")} ·
            {t("表结构","Schema")}: {control?.schemaReady?t("已标记就绪","Flagged ready"):t("未就绪","Not ready")} ·
            {t("正式汇率","Approved FX")}: {control?.rateConfigured?t("已配置","Configured"):t("未配置","Missing")}
          </p>
          <p className="text-xs text-muted-foreground">{t("开关保存在独立的运营配置中；Production 默认关闭。Worker 环境变量仍是不可绕过的最高级授权。任何启用操作都需要密码二次验证和审计。","Settings are independent operator controls; Production defaults closed. Worker bindings are non-overridable ceilings. Enabling requires password reauthentication and an audit trail.")}</p>
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="boltutil-control-reason">{t("变更原因（至少 8 字）","Reason for change (8+ characters)")}</label>
            <input id="boltutil-control-reason" className="h-10 w-full rounded-md border px-3 text-sm" maxLength={500}
              value={reason} onChange={e=>{setReason(e.target.value);setReview(false);}}
              placeholder={t("例如：暂停 Polygon 网络新订单","e.g. Pause new Polygon orders")}/>
          </div>
          {dirty&&!review&&<Button type="button" variant="outline"
            disabled={saving||loading||reason.trim().length<8}
            onClick={()=>setReview(true)}>{t("复核并保存 USDT 开关","Review USDT switches")}</Button>}
          {review&&draft&&<div className="space-y-2 rounded-lg border p-3" role="alert">
            <p className="text-sm font-medium">{t("确认保存：","Confirm new settings: ")}
              {draft.enabled?t("总开关开启","Master ON"):t("总开关关闭","Master OFF")} ·
              {NETWORKS.filter(n=>draft.networks[n.code]).map(n=>n.code).join(" / ")||t("五链全部关闭","All networks OFF")}
            </p>
            <p className="text-xs text-muted-foreground">{t("云端门禁未完成前，启用总开关将被服务端拒绝。停止新订单不会停止历史订单核验。","The server rejects master activation until cloud gates are ready. Pausing new orders preserves historical settlement.")}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={saving} onClick={()=>void saveControl()}>{saving?t("保存中…","Saving…"):t("确认提交并记录审计","Confirm and audit")}</Button>
              <Button variant="outline" disabled={saving} onClick={()=>setReview(false)}>{t("取消","Cancel")}</Button>
            </div>
          </div>}
          {notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
        </section>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
            :t("USDT 新订单当前不可用。请检查后台运营开关和 Worker 安全门禁；无需切换 MK99 或小豆。",
               "New USDT checkout is unavailable. Check operator switches and Cloudflare ceilings; no fiat merchant switch is needed.")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("下方订单列表只读；上方开关操作需管理员验证并记录审计。密钥仅存 Cloudflare Worker Secrets，不在网页展示或输入。",
             "Orders below are read-only; switch changes require admin verification and audit. Secrets stay in Cloudflare Worker bindings and are never displayed or entered here.")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={loading} onClick={()=>setReload(x=>x+1)}>
            {loading?t("刷新中…","Refreshing…"):t("刷新通道和订单","Refresh network and orders")}
          </Button>
          <a href="/usdt-checkout/" className="text-sm text-blue-700 underline">
            {t("查看用户端五链收银台","Preview five-network cashier")}
          </a>
        </div>
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
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
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t("待人工复核／待发权益","Review / unapplied")}</div><div className="mt-1 font-semibold tabular-nums">{data?manualReviewCount:"—"}</div></div>
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
            {t("暂无匹配的 USDT 收款订单。请调整网络筛选或刷新订单。","No matching USDT orders. Adjust the network filter or refresh.")}
          </p>}
        </div>
      </CardContent>
    </Card>
  </div>;
}
