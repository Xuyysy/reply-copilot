#!/usr/bin/env python3
"""Pinned partner Staging-only preflight or separately approved code update. No D1 SQL, existing secret value reads, or other deployment."""
import os, json, urllib.request, urllib.error, pathlib, hashlib, uuid, time, sys, base64
ACCOUNT='cb5fc919a9f05dcf39b3ca29c9538a1f'
SCRIPT='reply-copilot-api-staging'
OLD='aa66d608-9a0c-43b5-92dc-df34b28b509b'
OLD_DEP='d7c21e15-7393-4a69-a701-9ba850fdc2ce'
SOURCE='58ab69a5d907003d006401290b391f9fd3c52da2'
DB='cd44bb44-b525-42c4-b286-2cc84dae7fdb'
mode=os.environ.get('RELEASE_MODE')
confirmation=os.environ.get('RELEASE_CONFIRMATION')
schema=os.environ.get('SCHEMA_READINESS')
assert (mode,confirmation,schema) in (
    ('check','CHECK_ONLY','false'),
    ('deploy','DEPLOY_PARTNERS_V2_STAGING_WORKER','true')
), 'INVALID_RELEASE_APPROVAL'
key_name='PARTNER_PAYOUT_ENCRYPTION_KEY'
key=os.environ.get(key_name,'')
if mode=='deploy':
    try: assert len(base64.b64decode(key,validate=True))==32 and base64.b64encode(base64.b64decode(key,validate=True)).decode()==key
    except Exception: raise AssertionError('INVALID_OR_MISSING_PAYOUT_KEY') from None
assert os.environ.get('CLOUDFLARE_ACCOUNT_ID')==ACCOUNT, 'STAGING_ACCOUNT_MISMATCH'
token=os.environ.get('CLOUDFLARE_API_TOKEN')
assert token,'STAGING_TOKEN_MISSING'
base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+SCRIPT
def api(method,path,body=None,ctype='application/json'):
    if body is not None and not isinstance(body,bytes): body=json.dumps(body).encode()
    req=urllib.request.Request(base+path,data=body,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':ctype})
    try:
        with urllib.request.urlopen(req,timeout=60) as r: result=json.load(r)
    except urllib.error.HTTPError as e:
        try: codes=[x.get('code') for x in json.load(e).get('errors',[])]
        except Exception: codes=[]
        raise RuntimeError(f'CF_{method}_{path}_{e.code}_CODES_{codes}') from None
    if not result.get('success'): raise RuntimeError('CF_UNSUCCESSFUL_'+method+'_'+path)
    return result['result']
def active():
    d=api('GET','/deployments')['deployments'][0]
    assert len(d['versions'])==1 and d['versions'][0]['percentage']==100,'NOT_SINGLE_VERSION'
    return d['versions'][0]['version_id'],d['id']
def latest(): return api('GET','/versions')['items'][0]['id']
def details(v): return api('GET','/versions/'+v)['resources']
def bindings(items):
    out={}
    for b in items:
        name,t=b['name'],b['type']
        assert name not in out and t in ('plain_text','secret_text','d1'),'UNKNOWN_BINDING'
        out[name]={'type':t,**({'text':b['text']} if t=='plain_text' else {'id':b.get('database_id') or b.get('id')} if t=='d1' else {})}
    return out
def settings():
    s=api('GET','/settings')
    # Annotations change by design; all non-annotation settings are compared.
    s.pop('annotations',None)
    s['bindings']=bindings(s['bindings'])
    return s
def cron(): return sorted(x['cron'] for x in api('GET','/schedules')['schedules'])
def health():
    # Same ordinary curl HTTP client used by the repository's existing Staging
    # release workflows. No WAF bypass, browser impersonation, auth, or alternate host.
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as d:
        body=pathlib.Path(d)/'body'
        headers=pathlib.Path(d)/'headers'
        result=subprocess.run(['curl','--silent','--show-error','--max-time','20',
            '--dump-header',str(headers),'--output',str(body),'--write-out','%{http_code}',
            'https://api-staging.x-reply-helper.top/health'],capture_output=True,text=True)
        status=result.stdout.strip()
        h={}
        for line in headers.read_text(errors='replace').splitlines() if headers.exists() else []:
            if ':' in line:
                k,v=line.split(':',1);h[k.lower()]=v.strip()
        ray=h.get('cf-ray','')
        if not __import__('re').fullmatch(r'[a-fA-F0-9]{8,32}-[A-Z]{3}',ray):ray='unavailable'
        if result.returncode or status!='200':
            content=body.read_text(errors='replace')[:20000].lower() if body.exists() else ''
            kind='cloudflare_challenge' if h.get('cf-mitigated')=='challenge' else 'cloudflare_block_page' if 'cloudflare' in content and ('attention required' in content or 'error 1010' in content or 'you have been blocked' in content or 'error 1020' in content) else 'other'
            raise RuntimeError(f'HEALTH_FAILED HTTP={status} curl={result.returncode} ray={ray} category={kind}')
        assert json.loads(body.read_bytes())=={'ok':True,'service':'reply-copilot-api'},'HEALTH_BODY_MISMATCH'
        print('HEALTH_OK HTTP=200',flush=True)
def deploy(v,msg):
    return api('POST','/deployments',{'strategy':'percentage','versions':[{'version_id':v,'percentage':100}],'annotations':{'workers/message':msg}})
def waitactive(v):
    for _ in range(15):
        if active()[0]==v:return
        time.sleep(3)
    raise RuntimeError('VERSION_NOT_ACTIVE')
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'worker-artifact'
manifest=json.loads((root/'manifest.json').read_text())
code=(root/'index.js').read_bytes()
assert manifest=={'sourceSha':SOURCE,'sha256':hashlib.sha256(code).hexdigest(),'target':SCRIPT},'ARTIFACT_MISMATCH'
assert active()==(OLD,OLD_DEP) and latest()==OLD,'STALE_APPROVAL_OR_UNDEPLOYED_VERSION'
before=settings();old=details(OLD);oldbind=bindings(old['bindings'])
assert oldbind==before['bindings'],'ACTIVE_SETTINGS_VERSION_MISMATCH'
assert key_name not in oldbind,'PAYOUT_KEY_ALREADY_BOUND_REVIEW_REQUIRED'
expected_bindings={**oldbind,key_name:{'type':'secret_text'}}
expected_settings={**before,'bindings':expected_bindings}
assert oldbind['DB']=={'type':'d1','id':DB}
assert oldbind['ENVIRONMENT']=={'type':'plain_text','text':'staging'}
assert oldbind['API_ORIGIN']=={'type':'plain_text','text':'https://api-staging.x-reply-helper.top'}
assert oldbind['WEB_ORIGIN']=={'type':'plain_text','text':'https://staging.x-reply-helper.top'}
assert not any(k in oldbind for k in ('CF_FREE_ZERO_WRITE_ASSERTIONS','PASSWORD_VERIFY_DO','PASSWORD_VERIFY_DO_ENABLED'))
assert before['compatibility_date']=='2026-10-14' and before.get('compatibility_flags',[])==[]
assert cron()==['0 3 * * *']
health()
print('PRECHECK_OK',len(oldbind),flush=True)
if mode=='check':
    print('CHECK_ONLY: no upload, no activation, no D1 SQL',flush=True)
    sys.exit(0)
# API script version upload inherits from latest; latest must equal approved active
# version immediately before upload. Existing secrets are inherited; only the new owner-provisioned secret is supplied over TLS, never logged.
metadata={'main_module':'index.js','compatibility_date':'2026-10-14','compatibility_flags':[],
          'usage_model':old['script_runtime']['usage_model'],
          'bindings':[{'name':name,'type':'inherit','version_id':'latest'} for name in sorted(oldbind)]+[{'name':key_name,'type':'secret_text','text':key}],
          'annotations':{'workers/message':'Approved staging partners '+SOURCE}}
boundary='xrh-'+uuid.uuid4().hex
payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()+json.dumps(metadata).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode()+code+f'\r\n--{boundary}--\r\n'.encode())
assert active()==(OLD,OLD_DEP) and latest()==OLD and settings()==before and cron()==['0 3 * * *'],'PREUPLOAD_DRIFT'
new=api('POST','/versions',payload,'multipart/form-data; boundary='+boundary)['id']
print('VERSION_UPLOADED_NOT_DEPLOYED',new,flush=True)
v=details(new)
assert bindings(v['bindings'])==expected_bindings,'UPLOADED_BINDINGS_DIFFER'
assert v['script_runtime']==old['script_runtime'],'UPLOADED_RUNTIME_DIFFERS'
assert set(v['script']['handlers'])==set(old['script']['handlers'])=={'fetch','scheduled'},'HANDLER_MISMATCH'
assert active()==(OLD,OLD_DEP) and latest()==new and settings()==before and cron()==['0 3 * * *'],'PREDEPLOY_DRIFT'
print('VERSION_VALIDATED',new,flush=True)
try:
    deploy(new,'Approved Staging Worker '+SOURCE)
    waitactive(new)
    assert settings()==expected_settings and cron()==['0 3 * * *'],'POSTFLIGHT_CONFIG_DRIFT'
    health()
    print('XRH_STAGING_DEPLOY_SUCCESS '+json.dumps({'sourceSha':SOURCE,'version':new,'previousVersion':OLD,'deployment':active()[1],'bindingCount':len(expected_bindings),'workerSha256':manifest['sha256'],'health':200,'cronUnchanged':True}),flush=True)
except Exception:
    # Revert only our own activation; never overwrite another operator's deploy.
    if active()[0]==new:
        deploy(OLD,'Rollback approved staging partners candidate: failed postflight')
        waitactive(OLD)
        assert settings()==before and cron()==['0 3 * * *'],'ROLLBACK_CONFIG_DRIFT'
        health()
        print('XRH_STAGING_ROLLED_BACK',OLD,flush=True)
    raise
