// Pure policy. Counts refer to ACK-confirmed generations, never sent X posts.
// Product copy baseline: https://app.notion.com/p/412c089052a381459bf6c57d594cea8b
// Do not change active server-managed policy merely by changing this fallback.
// Verify external data feeds / model training before promoting claims to public Production.
export const DEFAULT_MOMENTUM_CONFIG=Object.freeze({
 version:'default-v1',enabled:false,ranges:[[500,650],[850,1100],[1350,1700]],maxReminders:3,cooldownMinutes:90,
 overviewZh:"我认为，原创帖的传播机会，并不只取决于发布的那一刻。\n\n持续参与高质量讨论，可能让账号逐渐建立话题关联、受众连接与行为信号，形成潜在的传播势能。\n\n我将这种互动积累过程中，可能出现传播条件非线性变化的关键节点，定义为「互动势能临界值」。\n\n互动势能分析引擎融合 X 推荐机制研究、互动时序建模、传播趋势分析及中文区创作者X榜单，构建多维势能评估体系。",
 overviewEn:"I believe an original post's distribution opportunity is shaped by more than the moment it is published.\n\nSustained participation in meaningful conversations may help an account build topic relevance, audience connections, and behavioral signals that contribute to potential distribution momentum.\n\nI call the point at which accumulated engagement may correspond to a nonlinear shift in distribution conditions the “Creator Momentum Threshold.”\n\nThe Creator Momentum Analysis Engine brings together research on X's recommendation mechanisms, engagement time-series modeling, distribution trends, and Chinese-language creator rankings to develop a multidimensional momentum assessment framework.",
 researchZh:"通过每日动态数据更新、历史样本数据库积累与持续模型训练分析，不断优化行为信号权重与临界策略，探索互动积累和原创内容曝光表现之间的潜在关联。\n\n系统通过分阶段临界识别，辅助捕捉值得尝试原创发布的关键窗口。\n\n互动是蓄势，临界是信号，原创是释放。",
 researchEn:"Through daily data updates, historical sample accumulation, and ongoing model training and analysis, the framework aims to refine behavioral signal weights and threshold strategies, exploring potential relationships between engagement accumulation and original-post impressions.\n\nStaged threshold detection helps identify promising windows to consider publishing original content.\n\nEngagement builds momentum. Thresholds signal opportunity. Original posts release it.",
 titleZh:"互动势能临界值已触发",
 titleEn:"Creator Momentum Threshold Reached",
 bodyZh:"当前互动活跃状态已进入新的临界阶段。\n\n结合行为时序、话题趋势与历史数据模型，持续积累的互动信号可能正在形成更有利的内容传播条件。\n\n现在，建议发布一条原创帖子。\n\n尝试把互动势能转化为原创影响力。",
 bodyEn:"Your engagement activity has entered a new threshold stage.\n\nConsidering behavioral patterns, topic trends, and historical modeling, accumulated interaction signals may indicate more favorable conditions for original content distribution.\n\nNow is a moment to consider publishing an original post.\n\nTurn engagement momentum into an opportunity for original impact.",
});
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
