import {useState} from 'react';
import {api} from '../../lib/api';
import {readableError,phrase} from '../../lib/language';
import type {Language} from '../../lib/language';
import {Button} from '../ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '../ui/card';

type Readiness={
 mode:{creationIterations:number;migrationEnabled:boolean};
 hashes:{passwordAccounts:number;active:number;optimized60k:number;legacy100k:number;legacy210k:number;unsupported:number;nonActiveLegacy:number};
 passwordCpuMigrationComplete:boolean;freePlanCertified:false;note:string;
};

export default function AuthCpuReadinessPanel({language}:{language:Language}){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [data,setData]=useState<Readiness|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const load=async()=>{
  if(loading)return;
  setLoading(true);setError('');
  try{setData(await api<Readiness>('/v1/admin/security/auth-cpu-readiness'));}
  catch(cause){setError(readableError(cause,language));}
  finally{setLoading(false);}
 };
 return <Card data-testid="auth-cpu-readiness">
  <CardHeader><CardTitle>{t('CF Free · 密码 CPU 迁移核验','CF Free · Password CPU migration readiness')}</CardTitle></CardHeader>
  <CardContent className="space-y-3">
   <p className="text-sm text-muted-foreground">
    {t('仅在点击时读取一次账户哈希类型汇总；不返回密码、盐值、用户身份或密钥。该结果不能代替 Worker CPU / D1 的正式验收。',
       'Reads aggregate hash work factors only on request; no passwords, salts, identities, or secrets. This is not a substitute for Worker CPU and D1 acceptance.')}
   </p>
   <Button type="button" variant="outline" disabled={loading} onClick={()=>void load()}>
    {loading?t('正在核验…','Checking…'):t('检查密码 CPU 迁移准备情况','Check password CPU migration readiness')}
   </Button>
   {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
   {data&&<div className="space-y-2 rounded-md border p-3 text-sm" role="status">
    <p>{t('新密码哈希轮数','New password iterations')}: {data.mode.creationIterations.toLocaleString()}</p>
    <p>{t('旧密码自动迁移','Automatic legacy migration')}: {data.mode.migrationEnabled?t('已启用','Enabled'):t('未启用','Disabled')}</p>
    <p>{t('活跃密码账户','Active password accounts')}: {data.hashes.active}</p>
    <p>{t('已使用 6 万次哈希','60k-round hashes')}: {data.hashes.optimized60k}</p>
    <p>{t('仍为 10 万次哈希','100k-round legacy hashes')}: {data.hashes.legacy100k}</p>
    <p>{t('仍为 21 万次哈希','210k-round legacy hashes')}: {data.hashes.legacy210k}</p>
    <p>{t('不支持的哈希格式','Unsupported hash formats')}: {data.hashes.unsupported}</p>
    <p>{t('非活跃账户中的旧哈希','Non-active legacy hashes')}: {data.hashes.nonActiveLegacy}</p>
    <p className="font-medium">{data.passwordCpuMigrationComplete
      ?t('密码哈希迁移项已清零；仍须检查其他 CPU 请求与 D1 配额。','Legacy hash counts cleared; other CPU paths and D1 quotas still need verification.')
      :t('仍存在旧哈希，不能仅凭本项判断适合 Free。','Legacy hashes remain; not sufficient to switch to Free.')}</p>
    <p className="text-muted-foreground">{t('套餐验收状态：尚未认证可切换 Free。','Plan decision: not certified for Free.')}</p>
   </div>}
  </CardContent>
 </Card>;
}
