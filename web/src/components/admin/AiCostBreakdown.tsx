import { phrase, type Language } from "../../lib/language";

type Usage = { requests: number; inputTokens: number; outputTokens: number; costMicroUsd: number };
export type ModelCost = { provider: string; model: string; configurationSource: string; today: Usage; month: Usage };

export default function AiCostBreakdown({ rows, language }: { rows: ModelCost[]; language: Language }) {
  const t = (zh: string, en: string) => phrase(language, zh, en);
  return <div className="mt-6 space-y-5">
    <h3 className="text-lg font-semibold">{t("按厂商与模型统计", "Cost by provider and model")}</h3>
    <p className="text-sm text-muted-foreground">{t("按请求固定的模型版本归类，包含已产生上游费用的失败请求。旧记录标记为 Legacy DeepSeek；切换当前模型不会改写历史。", "Attributed to each request’s pinned model version, including failed requests with upstream costs. Older records are labeled Legacy DeepSeek; model switches preserve history.")}</p>
    {(["today", "month"] as const).map(period => <section key={period} className="space-y-2">
      <h4 className="font-medium">{period === "today" ? t("今日（UTC）", "Today (UTC)") : t("本月（UTC）", "This month (UTC)")}</h4>
      {rows.length ? <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[660px] text-sm">
        <thead className="bg-muted/40 text-left"><tr>{[t("厂商 / 模型", "Provider / model"), t("生成请求数", "Generation requests"), t("输入 Token", "Input tokens"), t("输出 Token", "Output tokens"), t("估算成本（USD）", "Estimated cost (USD)")].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={`${row.configurationSource}:${row.provider}:${row.model}`} className="border-t">
          <td className="px-4 py-3"><div>{row.configurationSource === "legacy" ? "Legacy DeepSeek" : row.configurationSource === "unresolved" ? t("未能关联厂商", "Unresolved provider") : row.provider}</div><div className="break-all text-xs text-muted-foreground">{row.model}</div></td>
          <td className="px-4 py-3 tabular-nums">{row[period].requests}</td>
          <td className="px-4 py-3 tabular-nums">{row[period].inputTokens}</td>
          <td className="px-4 py-3 tabular-nums">{row[period].outputTokens}</td>
          <td className="px-4 py-3 tabular-nums">${(row[period].costMicroUsd / 1_000_000).toFixed(6)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="py-3 text-sm text-muted-foreground">{t("暂无模型成本记录。", "No model cost records yet.")}</p>}
    </section>)}
  </div>;
}
