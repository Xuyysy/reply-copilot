import type {Env} from './types';
import {ApiFailure} from './types';
import {sessionFor} from './auth';
import {creatorFeature} from './creator-momentum';
import {response} from './http';
import {shanghaiDay,nowMs} from './security';
import {momentumInsightsModel} from '../../domain/creator-momentum-intelligence.js';

// A paid-only, read-only presentation of account-scoped, ACK-proven events.
// This is a research index; the Chrome extension owns true daily frozen thresholds,
// pending reminder leases, shown state, and next-reply gate.
export async function creatorMomentumInsights(request:Request,env:Env):Promise<Response>{
  const {session}=await sessionFor(request,env);
  const feature=await creatorFeature(env,session.user_id);
  if(!feature.eligible)throw new ApiFailure(403,'PAID_FEATURE_REQUIRED','互动势能分析终端仅对具有有效付费权益的账户开放。');
  const policy=feature.policy;
  if(!policy.enabled)return response({eligible:true,available:false,policyVersion:policy.version},200,env,request);
  const now=nowMs();
  const day=shanghaiDay(now);
  const start=Date.parse(day+'T00:00:00+08:00');
  const end=start+24*3600_000;
  const statement=env.DB.prepare(`SELECT CAST((delivery_confirmed_at-?)/3600000 AS INTEGER) AS hour,
      COUNT(*) AS total
    FROM ai_requests
    WHERE user_id=? AND status='succeeded' AND consumed=1
      AND delivery_confirmation_id IS NOT NULL AND delivery_confirmation_id<>''
      AND delivery_confirmed_at>=? AND delivery_confirmed_at<?
    GROUP BY CAST((delivery_confirmed_at-?)/3600000 AS INTEGER)
    ORDER BY hour`);
  const rows=await statement.bind(start,session.user_id,start,Math.min(end,now+1),start).all<{hour:number;total:number}>();
  const hourly=Array(24).fill(0) as number[];
  for(const row of rows.results??[]){
    const h=Number(row.hour);
    if(Number.isInteger(h)&&h>=0&&h<24)hourly[h]=Math.max(0,Number(row.total)||0);
  }
  const count=hourly.reduce((sum,n)=>sum+n,0);
  const analysis=momentumInsightsModel(count,hourly,policy.ranges);
  return response({
    eligible:true,available:true,day,timezone:'Asia/Shanghai',
    policyVersion:policy.version,modelVersion:'CMI-v1.0',
    eventSource:'server_confirmed_ai_delivery',
    totalConfirmed:count,
    score:analysis.score,normalized:analysis.normalized,
    cycle:analysis.cycle,curve:analysis.curve,
    observedHours:Math.min(24,Math.max(1,new Date(now+8*3600_000).getUTCHours()+1)),
    // This gives users current policy context but never substitutes for frozen local thresholds.
    policyUpdatedOnRefresh:true,extensionReminderState:'device_local',
  },200,env,request);
}
