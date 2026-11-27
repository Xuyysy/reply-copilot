import contextlib
import hashlib
import io
import json
import os
import pathlib
import runpy
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/guarded-partner-staging-worker-20261127.py'
OLD='cc46d1eb-01f9-4e10-be25-b2ae8084f67c'
OLD_DEP='4b039144-8fd1-4ea8-bc40-5eeba298f1c6'
NEW='00000000-0000-4000-8000-000000000001'
SOURCE='0b9a5065e2c199d849c7161792b6faadaceb3af0'
PREFIX='https://api.cloudflare.com/client/v4/accounts/cb5fc919a9f05dcf39b3ca29c9538a1f/workers/scripts/reply-copilot-api-staging'
BINDINGS=[
 {'name':'DB','type':'d1','id':'cd44bb44-b525-42c4-b286-2cc84dae7fdb'},
 {'name':'ENVIRONMENT','type':'plain_text','text':'staging'},
 {'name':'API_ORIGIN','type':'plain_text','text':'https://api-staging.x-reply-helper.top'},
 {'name':'WEB_ORIGIN','type':'plain_text','text':'https://staging.x-reply-helper.top'},
 {'name':'FIXTURE_SECRET','type':'secret_text'},
]

class Fake:
    def __init__(self):
        self.active=OLD;self.latest=OLD;self.deployment=OLD_DEP;self.calls=[]
        self.health_count=0;self.fail_health=None;self.bad_upload=False
    def open(self,req,timeout=None):
        assert req.full_url.startswith(PREFIX),'unexpected network'
        method=req.get_method();path=req.full_url[len(PREFIX):];self.calls.append((method,path))
        if method=='GET':
            if path=='/deployments':
                result={'deployments':[{'id':self.deployment,'versions':[{'version_id':self.active,'percentage':100}]}]}
            elif path=='/versions':result={'items':[{'id':self.latest}]}
            elif path=='/settings':result={'bindings':BINDINGS,'compatibility_date':'2026-10-14','compatibility_flags':[]}
            elif path=='/schedules':result={'schedules':[{'cron':'0 3 * * *'}]}
            elif path in ('/versions/'+OLD,'/versions/'+NEW):
                result={'resources':{'bindings':BINDINGS[:-1] if self.bad_upload and path.endswith(NEW) else BINDINGS,'script_runtime':{'usage_model':'standard'},'script':{'handlers':['fetch','scheduled']}}}
            else:raise AssertionError('unexpected GET '+path)
        elif method=='POST' and path=='/versions':
            assert self.active==OLD and self.latest==OLD
            self.latest=NEW;result={'id':NEW}
        elif method=='POST' and path=='/deployments':
            self.active=json.loads(req.data)['versions'][0]['version_id']
            self.deployment='fixture-deployment-'+self.active;result={}
        else:raise AssertionError('unexpected write '+path)
        return io.BytesIO(json.dumps({'success':True,'result':result}).encode())
    def curl(self,args,**kwargs):
        assert args[-1]=='https://api-staging.x-reply-helper.top/health'
        self.health_count+=1
        pathlib.Path(args[args.index('--dump-header')+1]).write_text('HTTP/2 200\n')
        pathlib.Path(args[args.index('--output')+1]).write_text('{"ok":true,"service":"reply-copilot-api"}')
        return SimpleNamespace(returncode=0,stdout='503' if self.health_count==self.fail_health else '200')

class Guard(unittest.TestCase):
    def invoke(self,fake,mode='check',confirmation='CHECK_ONLY',schema='false',tamper=False):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'worker-artifact';p.mkdir()
            code=b'fixture only';(p/'index.js').write_bytes(code)
            (p/'manifest.json').write_text(json.dumps({'sourceSha':SOURCE,'sha256':hashlib.sha256(code).hexdigest(),'target':'reply-copilot-api-staging'}))
            if tamper:(p/'index.js').write_bytes(b'tampered')
            env={'RUNNER_TEMP':d,'CLOUDFLARE_ACCOUNT_ID':'cb5fc919a9f05dcf39b3ca29c9538a1f','CLOUDFLARE_API_TOKEN':'fixture-only','RELEASE_MODE':mode,'RELEASE_CONFIRMATION':confirmation,'SCHEMA_READINESS':schema}
            with patch.dict(os.environ,env,clear=True),patch('urllib.request.urlopen',fake.open),patch('subprocess.run',fake.curl),patch('time.sleep'),contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(SCRIPT),run_name='__main__')
    def writes(self,f):return [x for x in f.calls if x[0]!='GET']
    def test_read_only_check(self):
        f=Fake()
        with self.assertRaises(SystemExit) as cm:self.invoke(f)
        self.assertEqual(cm.exception.code,0)
        self.assertTrue(f.calls);self.assertEqual(self.writes(f),[])
    def test_approval_rejected_before_network(self):
        for mode,confirmation,schema in [('deploy','CHECK_ONLY','true'),('deploy','DEPLOY_PARTNERS_STAGING_WORKER','false'),('check','CHECK_ONLY','true')]:
            f=Fake()
            with self.assertRaises(AssertionError):self.invoke(f,mode,confirmation,schema)
            self.assertEqual(f.calls,[])
    def test_stale_or_tampered_fails_closed(self):
        f=Fake();f.latest=NEW
        with self.assertRaises(AssertionError):self.invoke(f)
        self.assertEqual(self.writes(f),[])
        f=Fake()
        with self.assertRaises(AssertionError):self.invoke(f,tamper=True)
        self.assertEqual(f.calls,[])
    def test_successful_activation_mock(self):
        f=Fake();self.invoke(f,'deploy','DEPLOY_PARTNERS_STAGING_WORKER','true')
        self.assertEqual(self.writes(f),[('POST','/versions'),('POST','/deployments')])
        self.assertEqual(f.active,NEW)
    def test_upload_mismatch_never_activates(self):
        f=Fake();f.bad_upload=True
        with self.assertRaises(AssertionError):self.invoke(f,'deploy','DEPLOY_PARTNERS_STAGING_WORKER','true')
        self.assertEqual(self.writes(f),[('POST','/versions')]);self.assertEqual(f.active,OLD)
    def test_failed_health_rollback_mock(self):
        f=Fake();f.fail_health=2
        with self.assertRaises(RuntimeError):self.invoke(f,'deploy','DEPLOY_PARTNERS_STAGING_WORKER','true')
        self.assertEqual(self.writes(f),[('POST','/versions'),('POST','/deployments'),('POST','/deployments')])
        self.assertEqual(f.active,OLD)

if __name__=='__main__':unittest.main()
