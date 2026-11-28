#!/usr/bin/env python3
"""Resume only the already uploaded pinned Staging Worker; no upload, secrets, or D1 SQL."""
import os, json, urllib.request, urllib.error, pathlib, hashlib, uuid, time, sys, base64
ACCOUNT='cb5fc919a9f05dcf39b3ca29c9538a1f'
SCRIPT='reply-copilot-api-staging'
OLD='aa66d608-9a0c-43b5-92dc-df34b28b509b'
OLD_DEP='d7c21e15-7393-4a69-a701-9ba850fdc2ce'
SOURCE='58ab69a5d907003d006401290b391f9fd3c52da2'
NEW='ab576a6a-ba95-44a4-8bf5-327d65b84599'
OLD_ETAG='677be7e9db86760742b6fb0ea236fdae2784fe8b489255009bd8cdc8309690e7'
NEW_ETAG='93b9a153182aa945f6da486687cfaa83fcee060fd7a53daa99874a2480a4ccfd'
DB='cd44bb44-b525-42c4-b286-2cc84dae7fdb'
mode=os.environ.get('RELEASE_MODE')
confirmation=os.environ.get('RELEASE_CONFIRMATION')
schema=os.environ.get('SCHEMA_READINESS')
assert (mode,confirmation,schema) in (
    ('check','CHECK_ONLY','false'),
    ('deploy','ACTIVATE_UPLOADED_PARTNERS_V2_STAGING_WORKER','true')
), 'INVALID_RELEASE_APPROVAL'
key_name='PARTNER_PAYOUT_ENCRYPTION_KEY'
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
def details(v): return api('GET','/versions/'+v)
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
# The earlier approved upload completed before PREDEPLOY_DRIFT. The script
# settings API reflects the latest uploaded bindings even before activation.
# Pin immutable version IDs, code ETags, annotations and the active old deployment.
assert active()==(OLD,OLD_DEP) and latest()==NEW,'UNEXPECTED_VERSION_OR_DEPLOYMENT'
old=details(OLD);new=details(NEW)
assert old['id']==OLD and new['id']==NEW,'VERSION_ID_MISMATCH'
assert old['number']==148 and new['number']==149,'VERSION_NUMBER_MISMATCH'
assert old['resources']['script']['etag']==OLD_ETAG and new['resources']['script']['etag']==NEW_ETAG,'CODE_ETAG_MISMATCH'
assert new['annotations'].get('workers/message')=='Approved staging partners '+SOURCE,'SOURCE_ANNOTATION_MISMATCH'
assert new['annotations'].get('workers/triggered_by')=='version_upload','NOT_UPLOADED_VERSION'
old=old['resources'];new=new['resources']
oldbind=bindings(old['bindings']);newbind=bindings(new['bindings'])
assert key_name not in oldbind and newbind=={**oldbind,key_name:{'type':'secret_text'}},'BINDING_DELTA_MISMATCH'
assert oldbind['DB']=={'type':'d1','id':DB}
assert oldbind['ENVIRONMENT']=={'type':'plain_text','text':'staging'}
assert oldbind['API_ORIGIN']=={'type':'plain_text','text':'https://api-staging.x-reply-helper.top'}
assert oldbind['WEB_ORIGIN']=={'type':'plain_text','text':'https://staging.x-reply-helper.top'}
assert not any(k in oldbind for k in ('CF_FREE_ZERO_WRITE_ASSERTIONS','PASSWORD_VERIFY_DO','PASSWORD_VERIFY_DO_ENABLED'))
assert new['script_runtime']==old['script_runtime']=={'compatibility_date':'2026-10-14','usage_model':'standard'},'RUNTIME_MISMATCH'
assert set(new['script']['handlers'])==set(old['script']['handlers'])=={'fetch','scheduled'},'HANDLER_MISMATCH'
before=settings()
assert before['bindings']==newbind,'LATEST_SETTINGS_MISMATCH'
assert before['compatibility_date']=='2026-10-14' and before.get('compatibility_flags',[])==[]
assert before['usage_model']=='standard' and cron()==['0 3 * * *']
health()
print('RESUME_PRECHECK_OK',NEW,len(newbind),flush=True)
if mode=='check':
    print('CHECK_ONLY: no upload, no activation, no D1 SQL',flush=True)
    sys.exit(0)
assert active()==(OLD,OLD_DEP) and latest()==NEW and settings()==before and cron()==['0 3 * * *'],'PREACTIVATION_DRIFT'
try:
    deploy(NEW,'Approved Staging Worker '+SOURCE)
    waitactive(NEW)
    assert latest()==NEW and settings()==before and cron()==['0 3 * * *'],'POSTFLIGHT_CONFIG_DRIFT'
    health()
    print('XRH_STAGING_DEPLOY_SUCCESS '+json.dumps({'sourceSha':SOURCE,'version':NEW,'previousVersion':OLD,'deployment':active()[1],'bindingCount':len(newbind),'codeEtag':NEW_ETAG,'health':200,'cronUnchanged':True,'resumedUpload':True}),flush=True)
except Exception:
    if active()[0]==NEW:
        deploy(OLD,'Rollback approved Staging partner V2 activation: failed postflight')
        waitactive(OLD)
        # Settings may continue to expose latest uploaded bindings on rollback.
        # Compare all other settings; the old active version is pinned above.
        after=settings()
        assert after['bindings'] in (oldbind,newbind) and {k:v for k,v in after.items() if k!='bindings'}=={k:v for k,v in before.items() if k!='bindings'} and cron()==['0 3 * * *'],'ROLLBACK_CONFIG_DRIFT'
        health()
        print('XRH_STAGING_ROLLED_BACK',OLD,flush=True)
    raise
