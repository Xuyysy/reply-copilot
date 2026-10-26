export type CampaignStats = {total:number;succeeded:number;failed:number;remaining:number};
export function runCampaignBatches(options:{initialStats:CampaignStats;sendBatch:()=>Promise<{stats:CampaignStats}>;onProgress:(stats:CampaignStats)=>void;shouldStop:()=>boolean;maxBatches?:number}):Promise<{reason:string;stats:CampaignStats;batches:number;error?:unknown}>;
