import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../src/components/auth/AuthPanel.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../../api/src/index.ts',import.meta.url),'utf8');
const handler=readFileSync(new URL('../../api/src/email-login.ts',import.meta.url),'utf8');
test('email OTP interface is build-gated and default password login stays intact',()=>{
 assert.match(src,/import\.meta\.env\.PUBLIC_EMAIL_OTP_LOGIN_ENABLED === "1"/);
 assert.match(src,/emailOtpAvailable && <Button/);
 assert.match(src,/\/"\/v1\/auth\/login"/);
 assert.match(src,/\/v1\/auth\/login/);
 assert.match(src,/emailOtpAvailable && <form/);
 assert.match(src,/\/v1\/auth\/email-login\/request/);
 assert.match(src,/\/v1\/auth\/email-login\/verify/);
 assert.match(src,/pattern="\[0-9\]\{8\}"/);
 assert.match(src,/Back to password sign-in/);
});
test('web sign-in cannot enable OTP without backend flag and approved schema',()=>{
 assert.match(handler,/if\(env\.EMAIL_OTP_LOGIN_ENABLED!=="1"\)/);
 assert.match(handler,/role='user'/);
 assert.match(api,/path === "\/v1\/auth\/email-login\/request"/);
 assert.match(api,/path === "\/v1\/auth\/email-login\/verify"/);
 assert.doesNotMatch(src,/localStorage\.setItem\([^)]*(?:password|code)/);
});
