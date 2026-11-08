// Pure policy. Counts refer to ACK-confirmed generations, never sent X posts.
export const DEFAULT_MOMENTUM_CONFIG=Object.freeze({version:'default-v1',enabled:false,ranges:[[500,650],[850,1100],[1350,1700]],maxReminders:3,cooldownMinutes:90,
 overviewZh:'互动势能临界值面向 X 创作者，以本机当日成功生成并完成交付确认的次数为活动信号，辅助考虑原创内容发布时机。V1 使用产品设定的隐藏多阶段阈值；不是实际发送评论数，也不代表 X 官方曝光系数。',
 overviewEn:'Interaction Momentum Threshold uses this installation’s daily ACK-confirmed generations as an activity signal for considering original posts. V1 uses hidden product-defined stages, not sent-comment counts or official X exposure scores.',
 researchZh:'后续研究规划（尚未接入 V1）：基于 X 公开材料研究推荐系统的候选召回、排序与信号演变；从互动时间、密度、节奏、连续性和活跃窗口建立多维行为模型，探索个性化发布时机；用可核验来源研究中文区创作者每日互动榜单、曝光趋势和热门议题，先验证数据口径；仅在研究验证后迭代个性化动态临界值、提醒时机与冷却策略。V1 未接入实时榜单或曝光数据，不保证流量。',
 researchEn:'Research roadmap (not live in V1): study candidate retrieval, ranking and changing signals using public X materials; model interaction timing, density, rhythm, continuity and active windows to explore personalized posting times; study daily Chinese-language creator engagement rankings, impression trends and trending topics using verifiable sources and validated methodology; refine personalized thresholds, reminder timing and cooldowns only after validation. V1 has no live rankings or impression data and does not guarantee reach.',
 titleZh:'今日活跃信号',titleEn:'Today’s activity signal',bodyZh:'可以考虑把讨论中的想法整理成一条原创帖。是否发布由你决定。',bodyEn:'Consider turning an idea from your discussions into an original post. You decide whether to publish.'});
const TEXT=['overviewZh','overviewEn','researchZh','researchEn','titleZh','titleEn','bodyZh','bodyEn'];
export function validateMomentumConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','enabled','ranges','maxReminders','cooldownMinutes',...TEXT].includes(k)))throw Error('INVALID_CREATOR_CONFIG');
 if(typeof value.enabled!=='boolean'||typeof value.version!=='string'||value.version.length>100)throw Error('INVALID_CREATOR_CONFIG');
 const ranges=value.ranges;
 if(!Array.isArray(ranges)||ranges.length!==3||ranges.some((r,i)=>!Array.isArray(r)||r.length!==2||r.some(n=>!Number.isSafeInteger(n)||n<1||n>1000000)||r[0]>r[1]||(i&&r[0]<=ranges[i-1][1])))throw Error('INVALID_CREATOR_RANGES');
 if(!Number.isInteger(value.maxReminders)||value.maxReminders<1||value.maxReminders>3||
    value.cooldownMinutes!==undefined&&(!Number.isInteger(value.cooldownMinutes)||value.cooldownMinutes<90||value.cooldownMinutes>1440))throw Error('INVALID_CREATOR_LIMITS');
 for(const k of TEXT)if(typeof value[k]!=='string'||!value[k].trim()||value[k].length>(k.startsWith('title')?120:6000))throw Error('INVALID_CREATOR_TEXT');
 return {...value,cooldownMinutes:value.cooldownMinutes??DEFAULT_MOMENTUM_CONFIG.cooldownMinutes,ranges:ranges.map(r=>[...r])};
}
export function localDayKey(at){const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function dailyPolicy(config){return {version:config.version,ranges:config.ranges,maxReminders:config.maxReminders,cooldownMinutes:config.cooldownMinutes};}
export function createMomentumDay(at,config=DEFAULT_MOMENTUM_CONFIG,random=Math.random,day=localDayKey(at)){
 return {day,count:0,version:config.version,thresholds:config.ranges.map(([a,b])=>a+Math.floor(Math.max(0,Math.min(0.999999999,random()))*(b-a+1))),maxReminders:config.maxReminders,cooldownMinutes:config.cooldownMinutes,shownThrough:0,reminderCount:0,lastShownAt:0,dnd:false,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,createdAt:at};
}
export function selectMomentumReminder(day,context,now){
 if(!day||day.day!==localDayKey(now)||!context.eligible||!context.enabled||!context.globalEnabled||day.dnd||day.reminderCount>=day.maxReminders)return null;
 for(let i=0;i<3;i++)if(day.count>=day.thresholds[i]&&i+1>(day.shownThrough??0))return i+1;
 return null;
}
export function recordMomentumReminder(day,stage,now){return {...day,shownThrough:Math.max(day.shownThrough,stage),reminderCount:day.reminderCount+1,lastShownAt:now};}
