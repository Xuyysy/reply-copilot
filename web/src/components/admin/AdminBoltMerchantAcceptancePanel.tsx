import {useEffect,useMemo,useRef,useState} from "react";
import {api} from "../../lib/api";
import {phrase,type Language} from "../../lib/language";
import {Badge} from "../ui/badge";
import {Button} from "../ui/button";

type Network="TRC20"|"POLYGON"|"BEP20"|"ERC20"|"SOLANA";
type ReadinessCheck={id:string;satisfied:boolean};
type NetworkReadiness={
  network:Network;environmentEnabled:boolean;operatorEnabled:boolean;
  acceptingNewOrders:boolean;blockedBy:string[];
};
type MerchantControl={
  environment:string;credentialsConfigured:boolean;schemaReady:boolean;
  creationApproved:boolean;operatorEnabled:boolean;
  readiness:{
    checks:ReadinessCheck[];networks:NetworkReadiness[];missing:string[];
    acceptingNewOrders:boolean;
  };
};
type PingResult={
  kind:"ok"|"unauthorized"|"rate_limited"|"upstream_http"|"network_error";
  httpStatus:number|null;
};
type ObservedPing=PingResult&{checkedAt:number};
const ASSETS:ReadonlyArray<{network:Network;chain:string;contract:string;decimals:number}>=[
  {network:"TRC20",chain:"TRON",contract:"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",decimals:6},
  {network:"POLYGON",chain:"Polygon PoS",contract:"0xc2132D05D31c914a87C6611C10748AEb04B58e8F",decimals:6},
  {network:"BEP20",chain:"BNB Smart Chain",contract:"0x55d398326f99059fF775485246999027B3197955",decimals:18},
  {network:"ERC20",chain:"Ethereum",contract:"0xdAC17F958D2ee523a2206206994597C13D831ec7",decimals:6},
  {network:"SOLANA",chain:"Solana",contract:"Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",decimals:6}
];
const GATE_LABELS:Record<string,[string,string]>={
  schemaDeclared:["D1 schema-ready 配置","D1 schema-ready declaration"],
  schemaVerified:["Production D1 独立确认标记","Production D1 independent acknowledgment"],
  globalEnabled:["Worker USDT 总门禁","Worker USDT global ceiling"],
  productionCreateApproved:["Production 建单授权","Production create approval"],
  apiKeyPresent:["BoltUtil API Key 绑定","BoltUtil API Key binding"],
  webhookSecretPresent:["Webhook Secret 绑定","Webhook Secret binding"],
  providerVerificationAcknowledged:["商户联调批准标记","Provider verification acknowledgment"],
  quoteConfigured:["正式汇率存在","Production rate configured"],
  approvedQuoteMatches:["汇率批准值与报价一致","Approved rate matches quote"],
  operatorMasterEnabled:["后台总开关","Operator master switch"],
  networkEnvironmentDisabled:["Worker 网络门禁关闭","Worker network ceiling OFF"],
  networkOperatorDisabled:["后台网络开关关闭","Operator network switch OFF"]
};
const PING_LABELS:Record<PingResult["kind"],[string,string]>={
  ok:["API Key 连通性通过（仅验证 Key）","API Key connectivity passed (key only)"],
  unauthorized:["Key 未通过认证（401/403）","Key rejected (401/403)"],
  rate_limited:["服务商限流（429）","Provider rate limited (429)"],
  upstream_http:["服务商返回非预期 HTTP 状态","Unexpected provider HTTP status"],
  network_error:["服务商网络不可达","Provider network unavailable"]
};
const tLabel=(key:string,language:Language)=>phrase(language,GATE_LABELS[key]?.[0]||key,GATE_LABELS[key]?.[1]||key);

/** The status is intentionally ephemeral: no browser storage or durable operator attestation. */
export default function AdminBoltMerchantAcceptancePanel({
  active,language,control
}:{active:boolean;language:Language;control:MerchantControl|null}){
  const t=(zh:string,en:string)=>phrase(language,zh,en);
  const generation=useRef(0);
  const [checking,setChecking]=useState(false);
  const [probe,setProbe]=useState<ObservedPing|null>(null);
  const [error,setError]=useState("");
  const [copyStatus,setCopyStatus]=useState("");
  useEffect(()=>{
    if(active&&control?.environment==="production")return;
    generation.current++;
    setChecking(false);setProbe(null);setError("");setCopyStatus("");
  },[active,control?.environment]);

  async function checkKey(){
    if(!active||checking||control?.environment!=="production"||!control.credentialsConfigured)return;
    const current=++generation.current;
    setChecking(true);setProbe(null);setError("");setCopyStatus("");
    try{
      const result=await api<PingResult>("/v1/admin/boltutil/provider-ping");
      if(current!==generation.current)return;
      if(!["ok","unauthorized","rate_limited","upstream_http","network_error"].includes(result.kind)||
        (result.httpStatus!==null&&(!Number.isInteger(result.httpStatus)||result.httpStatus<100||result.httpStatus>599)))
        throw new Error(t("商户诊断结果格式异常。","Unexpected merchant check response."));
      setProbe({kind:result.kind,httpStatus:result.httpStatus,checkedAt:Date.now()});
    }catch(cause){
      if(current===generation.current)setError(cause instanceof Error?cause.message:t("验证失败。","Verification failed."));
    }finally{
      if(current===generation.current)setChecking(false);
    }
  }
  const passed=probe?.kind==="ok";
  const report=useMemo(()=>{
    const lines=[
      "Reply Copilot / Production USDT merchant acceptance — read-only operator handoff",
      "Environment: "+(control?.environment??"UNKNOWN"),
      "Current invoice creation: "+(control?.readiness.acceptingNewOrders?"DECLARED ENABLED":"BLOCKED"),
      "Merchant API key connectivity: "+(probe?.kind??"NOT_CHECKED"),
      "Merchant ping HTTP: "+(probe?.httpStatus??"N/A"),
      "Merchant ping observed: "+(probe?new Date(probe.checkedAt).toISOString():"N/A"),
      "Wallet identity and enabled merchant routes: NOT VERIFIED",
      "Signed webhook end-to-end delivery: NOT VERIFIED",
      "On-chain settlement and exactly-once entitlement: NOT VERIFIED",
      "Cloudflare schema-ready binding: "+(control?.schemaReady?"DECLARED":"NOT DECLARED"),
      "Operator master switch: "+(control?.operatorEnabled?"ON":"OFF"),
      "Global blockers (runtime declarations): "+(control?.readiness.missing.join(", ")||"none declared"),
      ...ASSETS.map(asset=>{
        const row=control?.readiness.networks.find(x=>x.network===asset.network);
        return asset.network+": "+
          (row?.acceptingNewOrders?"CREATE ALLOWED BY RUNTIME":"CREATE BLOCKED")+
          " / cloud="+(row?.environmentEnabled?"ON":"OFF")+
          " / operator="+(row?.operatorEnabled?"ON":"OFF")+
          " / blockers="+(row?.blockedBy.join(", ")||"none declared");
      }),
      "Do not treat this report as approval to activate a payment rail.",
      "No API secrets, wallet addresses, customer records or provider raw response included."
    ];
    return lines.join("\n");
  },[control,probe]);

  async function copyReport(){
    setCopyStatus("");
    try{
      await navigator.clipboard.writeText(report);
      setCopyStatus(t("不含密钥的状态摘要已复制。","Sanitized status summary copied."));
    }catch{
      setCopyStatus(t("复制失败，请检查浏览器剪贴板权限。","Copy failed; check clipboard permissions."));
    }
  }
  const isProduction=control?.environment==="production";
  return <section className="space-y-4 rounded-xl border p-4"
    aria-label={t("USDT 正式商户验收中心","Production USDT merchant acceptance center")}
    data-testid="boltutil-merchant-acceptance">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">{t("正式商户验收工作台","Production merchant acceptance workbench")}</h4>
      <Badge variant="outline">{t("只读 · 不创建支付订单","Read-only · no invoice creation")}</Badge>
    </div>
    <p className="text-xs text-muted-foreground">
      {t("此工作台只显示运行门禁声明和一次手动商户 Key 连通性测试。不会查询真实收款钱包、验证 Webhook 投递或自动开启支付。",
        "This workbench displays runtime gate declarations and an opt-in API Key connectivity check. It does not verify recipient wallets, webhook delivery or enable payments.")}
    </p>
    <div className="space-y-2 rounded-lg border p-3" data-testid="boltutil-merchant-key-probe">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{t("第一关 · BoltUtil 正式 API Key","Gate 1 · Production BoltUtil API Key")}</strong>
        <Badge variant={passed?"secondary":"outline"}>
          {passed?t("仅 Key 连通","Key reachable only"):t("尚未通过","Not verified")}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("由后端使用现有 Secret 请求 BoltUtil GET /api/v1/ping。只返回脱敏状态码；不发起建单、查询订单或读取商户钱包。",
          "The backend calls BoltUtil GET /api/v1/ping with the existing Secret. Only a sanitized status is returned; no invoice, order lookup or wallet data is involved.")}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={()=>void checkKey()}
          disabled={!isProduction||!active||checking||!control?.credentialsConfigured}>
          {checking?t("正在验证 Key…","Checking API Key…"):t("手动运行只读连通性验证","Run read-only API Key check")}
        </Button>
        <a className="text-xs text-blue-700 underline" href="https://boltutil.com/developer-docs?s=auth"
          target="_blank" rel="noopener noreferrer">{t("BoltUtil 官方认证说明","Official authentication guide")}</a>
      </div>
      {!isProduction&&<p role="status" className="text-sm text-muted-foreground">
        {t("此项仅在 Production 环境可用。","Available only in Production.")}
      </p>}
      {isProduction&&!control?.credentialsConfigured&&<p role="status" className="text-sm text-muted-foreground">
        {t("所需 Secret 绑定不完整，不能运行检查。","Required Secret bindings are incomplete.")}
      </p>}
      {probe&&<div role="status" className="rounded-md border p-3 text-sm">
        <strong>{t(PING_LABELS[probe.kind][0],PING_LABELS[probe.kind][1])}</strong>
        <p className="mt-1 text-xs text-muted-foreground">
          HTTP {probe.httpStatus??"—"} · {new Date(probe.checkedAt).toLocaleString()}
        </p>
        {passed&&<p className="mt-1 text-xs text-muted-foreground">
          {t("此成功不能证明收款钱包、链路、Webhook 或真实支付已通过验收。",
            "This does not prove wallet, network, webhook or real-payment acceptance.")}
        </p>}
      </div>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
    <div className="space-y-2" data-testid="boltutil-runtime-gates">
      <h5 className="text-sm font-semibold">{t("第二关 · 正式环境独立审批与门禁","Gate 2 · Production declarations and approval ceilings")}</h5>
      <div className="grid gap-2 md:grid-cols-2">
        {(control?.readiness.checks||[]).map(check=><div key={check.id}
          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
          <span>{tLabel(check.id,language)}</span>
          <Badge variant={check.satisfied?"secondary":"outline"}>
            {check.satisfied?t("已声明","Declared"):t("阻断","Blocked")}
          </Badge>
        </div>)}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("“已声明”仅表示 Worker 变量／运营配置，不能替代独立数据库、商户与财务验收。",
          "Declared means Worker/operator configuration, not independent database, merchant or finance verification.")}
      </p>
    </div>
    <div className="space-y-2" data-testid="boltutil-five-network-evidence">
      <h5 className="text-sm font-semibold">{t("第三关 · 五链资产与收款准入","Gate 3 · Five-network assets and readiness")}</h5>
      <p className="text-xs text-muted-foreground">
        {t("以下是应用代码中的 USDT 代币合约／Mint，不是实际收款地址。每条网络的钱包、网络和资产开通情况都须在 BoltUtil 商户后台单独人工核实。",
          "These are the app's USDT token contracts/mint, NOT receiving wallet addresses. Verify each merchant wallet and enabled route independently in BoltUtil.")}
      </p>
      <div className="space-y-2">
        {ASSETS.map(asset=>{
          const row=control?.readiness.networks.find(item=>item.network===asset.network);
          return <div key={asset.network} className="rounded-lg border p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">{asset.chain} · {asset.network}</strong>
              <Badge variant={row?.acceptingNewOrders?"secondary":"outline"}>
                {row?.acceptingNewOrders?t("运行门禁允许","Runtime allows create"):t("新订单阻断","Creation blocked")}
              </Badge>
            </div>
            <p className="mt-2 break-all text-muted-foreground">
              {t("代币合约／Mint","Token contract / mint")}: {asset.contract} · {asset.decimals} decimals
            </p>
            <p className="mt-1 text-muted-foreground">
              {t("云端","Worker")}: {row?.environmentEnabled?"ON":"OFF"} ·
              {t("运营","Operator")}: {row?.operatorEnabled?"ON":"OFF"} ·
              {t("商户钱包","Merchant wallet")}: {t("待独立确认","Not verified")}
            </p>
            {row&&row.blockedBy.length>0&&<p className="mt-1 text-muted-foreground">
              {t("阻断原因","Blockers")}: {row.blockedBy.map(item=>tLabel(item,language)).join(" · ")}
            </p>}
          </div>;
        })}
      </div>
    </div>
    <div className="space-y-2 rounded-lg border p-3" data-testid="boltutil-acceptance-handoff">
      <h5 className="text-sm font-semibold">{t("第四关 · 尚需人工证据","Gate 4 · Independent evidence required")}</h5>
      <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
        <li>{t("五链正式收款钱包及启用网络／资产，需要商户后台逐项核对。",
          "Verify receiving wallets, network and asset activation for all five chains.")}</li>
        <li>{t("Webhook Secret、签名时间窗、回调可达性与幂等交付，需要真实联调证据。",
          "Validate webhook secret, signature window, delivery and idempotency with separate evidence.")}</li>
        <li>{t("正式 CNY/USDT 汇率和订单金额，需要独立财务审批；不能复用 Staging 模拟汇率。",
          "Obtain independent FX and amount approval; never reuse synthetic Staging FX.")}</li>
        <li>{t("单链真实付款、链上确认及权益恰好一次发放，需要单独授权的实付验收。",
          "A single-chain real payment, confirmation and exactly-once fulfillment need separate approval.")}</li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={()=>void copyReport()} disabled={!control}>
          {t("复制脱敏验收状态摘要","Copy sanitized acceptance handoff")}
        </Button>
        {copyStatus&&<span role="status" className="text-xs text-muted-foreground">{copyStatus}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("摘要不含 API Key、Webhook Secret、钱包地址或用户订单；临时验证结果不会持久保存，也不是上线批准。",
          "The handoff excludes keys, secrets, wallet addresses and customer orders. Probe results are ephemeral and never constitute go-live approval.")}
      </p>
    </div>
  </section>;
}
