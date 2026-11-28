import {phrase,type Language} from "../../lib/language";

export default function PartnerPromotionPitch({language,rateBps,guest=false}:{language:Language;rateBps?:number;guest?:boolean}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const approved=rateBps!==undefined;
 const Heading=guest?"h2":"h3";
 return <>
  <Heading className="text-lg font-semibold">{t("让你的每一份流量更有价值","Make more of your audience")}</Heading>
  <p className="text-sm font-semibold">{t("边冲 X 原创者收益，边赚推广佣金。","Earn affiliate commissions while working toward X creator monetization.")}</p>
  <div className="grid grid-cols-2 gap-2">
   <div className="min-w-0 rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{approved?t("你的专属佣金比例","Your commission rate"):t("你的推广佣金","Your commission")}</p><strong data-testid="partner-promotion-rate" className="block text-2xl text-emerald-600">{approved?rateBps/100+"%":"15%+"}</strong><p className="text-xs text-muted-foreground">{t("符合条件的充值及订阅订单","Qualifying credit and subscription purchases")}</p></div>
   <div className="min-w-0 rounded-lg border bg-background p-3"><p className="text-xs text-muted-foreground">{t("粉丝专属福利","Your audience's bonus")}</p><strong className="block text-2xl">{t("250 次","250 replies")}</strong><p className="text-xs text-muted-foreground">{t("完成激活后，比直接注册多 50 次","After activation, 50 more than direct signup")}</p></div>
  </div>
  <p className="text-sm">{t("不必改变你的创作方向，也不用刻意打广告。分享好用的工具、真实的使用心得、X 运营经验或原创文章时，顺手附上你的专属邀请链接即可。","No need to change what you create or turn your feed into an ad. When sharing useful tools, honest reviews, tips for growing on X, or original articles, simply include your referral link.")}</p>
  {!approved&&<p className="text-sm">{t("粉丝获得更多福利，你获得额外收益。让原本就在做的事情，多一种变现方式。","Your audience gets more value, and you gain another way to earn from the content you already create.")}</p>}
  <p className="text-sm font-semibold">{t("同一份内容，多一份收益。","Same content. Another way to earn.")}</p>
 </>;
}
