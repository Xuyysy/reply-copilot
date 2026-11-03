// Scenario calculator, not a live-traffic forecast. Coefficients are labelled
// synthetic measurements/assumptions; no production SQL or credentials.
export function capacity(input){
 const p={users:23,generations:250,usageRows:7500,confirmedRows:7000,ledgerRows:10000,orders:10,dashboards:20,cacheMisses:20,otherRequests:1000,otherWrites:3000,expiries:5,stageRequests:2000,stageReads:230000,stageWrites:11000,cronReads:100000,cronWrites:5000,...input};
 if(Object.values(p).some(x=>!Number.isSafeInteger(x)||x<0)||p.cacheMisses>p.dashboards)throw Error('Invalid scenario');
 // Managed generate + ACK measured 79–80 reads/42 steady writes; first daily
 // setup writes47. Use80/42 +5/day. Other endpoints/cost groups remain explicit.
 const warmDashboard=2*p.usageRows+p.confirmedRows+3*p.users+128;
 const coldExtra=p.ledgerRows+2*p.users+p.orders+64;
 const reads=p.generations*80+p.otherRequests*5+p.dashboards*warmDashboard+p.cacheMisses*coldExtra+p.expiries*(7*p.users+42)+p.stageReads+p.cronReads;
 const writes=p.generations*42+(p.generations?5:0)+p.otherWrites+p.expiries*15+p.stageWrites+p.cronWrites;
 const requests=2*p.generations+p.otherRequests+p.dashboards+p.stageRequests;
 return {assumptions:p,reads,writes,requests,warmDashboard,coldExtra,withinDailyFreeCounts:reads<=5000000&&writes<=100000&&requests<=100000,cpuCompatible:'not established; current authentication profile blocks certification'};
}
