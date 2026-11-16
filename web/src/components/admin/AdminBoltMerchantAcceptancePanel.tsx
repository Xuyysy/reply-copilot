import {useEffect,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Badge} from "../ui/badge";
import {Button} from "../ui/button";

type Network="TRC20"|"POLYGON"|"BEP20"|"ERC20"|"SOLANA";
type MerchantControl={
  environment:string;
  credentialsConfigured:boolean;
  readiness:{
    acceptingNewOrders:boolean;
    networks:{network:Network;acceptingNewOrders:boolean;blockedBy:string[]}[];
  };
};
type PingResult={
  kind:"ok"|"unauthorized"|"rate_limited"|"upstream_http"|"network_error";
  httpStatus:number|null;
};
const NETWORKS:Network[]=["TRC20","POLYGON","BEP20","ERC20","SOLANA"];
const labels:Record<PingResult["kind"],[string,string]>={
  ok:["API Key 连通","API Key reachable"],
  unauthorized:["API Key 无效","API Key rejected"],
  rate_limited:["服务商限流","Provider rate limited"],
  upstream_http:["商户接口异常","Provider HTTP issue"],
  network_error:["网络错误","Network error"]
};

/** Compact production checkout gate, not a provider certification or finance approval. */
export default function AdminBoltMerchantAcceptancePanel({
  active,language,control
}:{active:boolean;language:Language;control:MerchantControl|null}){
  const t=(zh:string,en:string)=>phrase(language,zh,en);
  const generation=useRef(0);
  const [checking,setChecking]=useState(false);
  const [probe,setProbe]=useState<PingResult|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    if(active&&control?.environment==="production")return;
    generation.current++;setChecking(false);setProbe(null);setError("");
  },[active,control?.environment]);
  async function checkKey(){
    if(!active||checking||control?.environment!=="production"||!control.credentialsConfigured)return;
    const current=++generation.current;
    setChecking(true);setProbe(null);setError("");
    try{
      const result=await api<PingResult>("/v1/admin/boltutil/provider-ping");
      if(current!==generation.current)return;
      if(!["ok","unauthorized","rate_limited","upstream_http","network_error"].includes(result.kind)||
        (result.httpStatus!==null&&(!Number.isInteger(result.httpStatus)||result.httpStatus<100||result.httpStatus>599)))
        throw Error(t("连通性结果异常。","Unexpected connectivity response."));
      setProbe(result);
    }catch(cause){
      if(current===generation.current)setError(cause instanceof Error?cause.message:t("验证失败。","Check failed."));
    }finally{
      if(current===generation.current)setChecking(false);
    }
  }
  const available=control?.readiness.acceptingNewOrders===true;
  return <section className="space-y-3 rounded-xl border p-4"
    data-testid="boltutil-merchant-acceptance"
    aria-label={t("Production 实付款测试","Production real-payment test")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">{t("Production 单链实付测试","Production single-chain payment test")}</h4>
      <Badge variant="outline">{available?t("已允许建单","Orders enabled"):t("暂不可建单","Orders blocked")}</Badge>
    </div>
    <div className="flex flex-wrap items-center gap-3" data-testid="boltutil-merchant-key-probe">
      <span className="text-sm">{t("商户 Key","Merchant key")}:
        {" "}{probe?t(labels[probe.kind][0],labels[probe.kind][1]):t("等待本次验证","Not checked this session")}
        {probe?.httpStatus!==null&&probe?.httpStatus!==undefined?" · HTTP "+probe.httpStatus:""}
      </span>
      <Button type="button" variant="outline" disabled={!active||control?.environment!=="production"||
        !control?.credentialsConfigured||checking} onClick={()=>void checkKey()}>
        {checking?t("验证中…","Checking…"):t("重新验证 Key","Recheck key")}
      </Button>
    </div>
    {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2" data-testid="boltutil-five-network-evidence">
      {NETWORKS.map(network=>{
        const chain=control?.readiness.networks.find(item=>item.network===network);
        return <Badge key={network} variant={chain?.acceptingNewOrders?"secondary":"outline"}>
          {network} · {chain?.acceptingNewOrders?"ON":"OFF"}
        </Badge>;
      })}
    </div>
    <p className="text-xs text-muted-foreground">
      {t("Production API Key 已通过的截图无需重复测试；此处状态只表示本次浏览器会话。真实付款还需正确的收款钱包、商户 Webhook 和正式汇率。",
        "A previous key screenshot need not be repeated; this status is per session only. Real payment still requires the merchant wallet, webhook and approved FX.")}
    </p>
    <a href="/usdt-checkout/" className="inline-block text-sm font-medium text-blue-700 underline">
      {t("前往真实收银台（受云端建单门禁控制）","Open real checkout (subject to backend gate)")}
    </a>
    <details className="rounded-lg border p-3" data-testid="boltutil-runtime-gates">
      <summary className="cursor-pointer text-xs font-medium">{t("查看阻断原因（高级）","Show blockers (advanced)")}</summary>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {(control?.readiness.networks||[]).map(row=><p key={row.network}>
          {row.network}: {row.blockedBy.length?row.blockedBy.join(", "):"—"}
        </p>)}
      </div>
    </details>
    <p className="text-xs text-muted-foreground">
      {t("支付完成以后在下方历史订单与异常对账中核对链上确认及权益到账。不能仅凭回跳成功判断付款。",
        "After payment, verify confirmed status and fulfillment in history/reconciliation. A return redirect is not payment proof.")}
    </p>
  </section>;
}
