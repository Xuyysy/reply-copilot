// Pure policy. Counts refer to ACK-confirmed generations, never sent X posts.
export const DEFAULT_MOMENTUM_CONFIG=Object.freeze({version:'default-v1',enabled:false,ranges:[[500,650],[850,1100],[1350,1700]],maxReminders:3,cooldownMinutes:90,
 overviewZh:'互动势能临界值面向 X 创作者，以本机当日成功生成并完成交付确认的次数为活动信号，辅助考虑原创内容发布时机。V1 使用产品设定的隐藏多阶段阈值；不是实际发送评论数，也不代表 X 官方曝光系数。',
 overviewEn:'Interaction Momentum Threshold uses this installation’s daily ACK-confirmed generations as an activity signal for considering original posts. V1 uses hidden product-defined stages, not sent-comment counts or official X exposure scores.',
 researchZh:'后续研究规划（V1 尚未接入）：X 公开推荐机制、候选召回与排序研究；互动行为密度、节奏及活跃窗口建模；中文区每日互动榜单和曝光趋势研究；经过验证后迭代动态临界策略。当前没有实时排名、曝光回传或外部榜单采集，不承诺流量增长。',
 researchEn:'Planned research, not live in V1: public X recommendation/retrieval/ranking mechanisms; interaction density, rhythm and active-window modeling; daily Chinese-language engagement rankings and exposure trends; validated dynamic threshold strategies. No live rankings, impression feedback or external ranking collection is connected. Exposure is not guaranteed.',
 titleZh:'今日活跃信号',titleEn:'Today’s activity signal',bodyZh:'可以考虑把讨论中的想法整理成一条原创帖。是否发布由你决定。',bodyEn:'Consider turning an idea from your discussions into an original post. You decide whether to publish.'});
const TEXT=['overviewZh','overviewEn','researchZh','researchEn','titleZh','titleEn','bodyZh','bodyEn'];
export function validateMomentumConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','enabled','ranges','maxReminders','cooldownMinutes',...TEXT].includes(k)))throw Error('INVALID_CREATOR_CONFIG');
 if(typeof value.enabled!=='boolean'||typeof value.version!=='string'||value.version.length>100)throw Error('INVALID_CREATOR_CONFIG');
 const ranges=value.ranges;
 if(!Array.isArray(ranges)||ranges.length!==3||ranges.some((r,i)=>!Array.isArray(r)||r.length!==2||r.some(n=>!Number.isSafeInteger(n)||n<1||n>1000000)||r[0]>r[1]||(i&&r[0]<=ranges[i-1][1])))throw Error('INVALID_CREATOR_RANGES');
 if(!Number.isInteger(value.maxReminders)||value.maxReminders<1||value.maxReminders>3||!Number.isInteger(value.cooldownMinutes)||value.cooldownMinutes<90||value.cooldownMinutes>1440)throw Error('INVALID_CREATOR_LIMITS');
 for(const k of TEXT)if(typeof value[k]!=='string'||!value[k].trim()||value[k].length>(k.startsWith('title')?120:6000))throw Error('INVALID_CREATOR_TEXT');
 return {...value,ranges:ranges.map(r=>[...r])};
}
export function localDayKey(at){const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function dailyPolicy(config){return {version:config.version,ranges:config.ranges,maxReminders:config.maxReminders,cooldownMinutes:config.cooldownMinutes};}
export function createMomentumDay(at,config=DEFAULT_MOMENTUM_CONFIG,random=Math.random,day=localDayKey(at)){
 return {day,count:0,version:config.version,thresholds:config.ranges.map(([a,b])=>a+Math.floor(Math.max(0,Math.min(0.999999999,random()))*(b-a+1))),maxReminders:config.maxReminders,cooldownMinutes:config.cooldownMinutes,shownThrough:0,reminderCount:0,lastShownAt:0,dnd:false,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,createdAt:at};
}
export function selectMomentumReminder(day,context,now){
 if(!day||day.day!==localDayKey(now)||!context.eligible||!context.enabled||!context.globalEnabled||day.dnd||day.reminderCount>=day.maxReminders||now<day.lastShownAt||day.lastShownAt&&now-day.lastShownAt<day.cooldownMinutes*60000)return null;
 let stage=null;for(let i=0;i<3;i++)if(day.count>=day.thresholds[i]&&i+1>day.shownThrough)stage=i+1;return stage;
}
export function recordMomentumReminder(day,stage,now){return {...day,shownThrough:Math.max(day.shownThrough,stage),reminderCount:day.reminderCount+1,lastShownAt:now};}
