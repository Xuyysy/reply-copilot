import json, subprocess, tempfile, pathlib
base='https://api-staging.x-reply-helper.top'
web='https://staging.x-reply-helper.top'
ext='chrome-extension://kaaehkpihjenlhjjfjcopkjhegmfmchk'
# No credentials. Every protected route rejects before session database lookup.
# Never send a valid-looking token, access a DB-backed public route, or call
# an external provider. Only public health, CORS, and unauthenticated guards.
cases=[
 ('health','GET','/health',None,200,None),
 ('health-web-cors','GET','/health',web,200,None),
 ('extension-preflight','OPTIONS','/v1/extension/bootstrap',ext,204,None),
 ('web-preflight','OPTIONS','/v1/ai/generate',web,204,None),
 ('invalid-origin-preflight','OPTIONS','/v1/ai/generate','https://example.invalid',403,None),
 ('unknown-route','GET','/xrh-staging-release-probe-not-found',None,404,'NOT_FOUND'),
 ('me-unauthenticated','GET','/v1/me',web,401,'AUTH_REQUIRED'),
 ('usage-unauthenticated','GET','/v1/usage',ext,401,'AUTH_REQUIRED'),
 ('entitlements-unauthenticated','GET','/v1/entitlements',ext,401,'AUTH_REQUIRED'),
 ('bootstrap-unauthenticated','GET','/v1/extension/bootstrap',ext,401,'AUTH_REQUIRED'),
 ('generate-unauthenticated','POST','/v1/ai/generate',ext,401,'AUTH_REQUIRED'),
 ('csrf-unauthenticated','GET','/v1/auth/csrf',web,401,'AUTH_REQUIRED'),
]
results=[]
for name,method,path,origin,expected,code in cases:
 with tempfile.TemporaryDirectory() as d:
  p=pathlib.Path(d);body=p/'body';head=p/'headers'
  args=['curl','--silent','--show-error','--max-time','20','--request',method,'--dump-header',str(head),'--output',str(body),'--write-out','%{http_code}',base+path]
  if origin:args+=['-H','Origin: '+origin]
  if method=='OPTIONS':args+=['-H','Access-Control-Request-Method: POST','-H','Access-Control-Request-Headers: content-type,authorization']
  if method=='POST':args+=['-H','Content-Type: application/json','--data','{}']
  r=subprocess.run(args,capture_output=True,text=True)
  h={}
  for line in head.read_text(errors='replace').splitlines() if head.exists() else []:
   if ':' in line:
    k,v=line.split(':',1);h[k.lower()]=v.strip()
  assert r.returncode==0 and r.stdout==str(expected),f'{name}: HTTP={r.stdout}; challenge={h.get("cf-mitigated")=="challenge"}'
  if name.startswith('health'):assert json.loads(body.read_bytes())=={'ok':True,'service':'reply-copilot-api'}
  if code:assert json.loads(body.read_bytes())['code']==code,name
  if origin in (web,ext):assert h.get('access-control-allow-origin')==origin and h.get('access-control-allow-credentials')=='true',name
  if name=='invalid-origin-preflight':assert 'access-control-allow-origin' not in h,name
  results.append({'case':name,'status':expected})
  print('PASS',name,expected,flush=True)
print('XRH_STAGING_SAFE_SMOKE '+json.dumps({'passed':len(results),'cases':results,'scope':'NO_AUTH_NO_REMOTE_SQL_NO_PROVIDER_CALLS'}),flush=True)
