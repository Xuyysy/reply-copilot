import {runWorkerdCpuExperiment} from './cf-free-workerd-cpu.mjs';
for(const source of ['free','paid','subscription']){
  const report=await runWorkerdCpuExperiment({source,samples:2,warmup:1,profile:true,assertionMode:'select',expiryIndex:'partial'});
  console.log('CF_FREE_OFFLINE_BUSINESS_CPU_PROFILE '+JSON.stringify(report));
}
