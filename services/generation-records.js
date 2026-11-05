// Pure, bounded reducers shared by regular writes and the delivery receipt commit.
export function generatedHistory(rows,{requestId,recommendation,createdAt}){
  const history=rows.map(row=>({...row,events:row.events?[...row.events]:undefined}));
  const entry=history.findLast?.(row=>row.requestId===requestId)||[...history].reverse().find(row=>row.requestId===requestId);
  if(entry){entry.events||=[];if(!entry.events.includes('generated'))entry.events.unshift('generated');entry.recommendation??=recommendation;entry.generatedAt??=createdAt;}
  else history.push({id:crypto.randomUUID(),requestId,status:'generated',events:['generated'],recommendation,createdAt,generatedAt:createdAt});
  return history.slice(-100);
}
export function generatedUsage(rows,{requestId,createdAt}){
  if(rows.some(row=>row.requestId===requestId&&row.action==='generated'))return rows;
  return [...rows,{requestId:String(requestId).slice(0,100),style:'',action:'generated',feedback:null,createdAt}].slice(-1000);
}
