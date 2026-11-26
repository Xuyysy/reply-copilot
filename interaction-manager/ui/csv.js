const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
export function rankingCsv(people){
  // Prefix user identifiers so spreadsheets cannot round snowflakes or evaluate formulas.
  return ['user_id,handle,count,inbound,outbound,reply,like,repost,quote,mention,unknown_time',...people.map(p=>['id:'+p.userId,p.handle?'handle:'+p.handle:'',p.count,p.inbound,p.outbound,p.byType.reply,p.byType.like,p.byType.repost,p.byType.quote,p.byType.mention,p.unknownTime].map(quote).join(','))].join('\r\n');
}
