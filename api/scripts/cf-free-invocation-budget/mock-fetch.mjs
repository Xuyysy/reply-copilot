// Only bundled in the isolated acceptance build. No real network escape.
const mails=new Map();
let calls=0;
export function resetMockCalls(){calls=0;}
export function mockCalls(){return calls;}
export function consumeMail(email){const code=mails.get(email);mails.delete(email);return code;}
export async function fetch(input,init){
 calls++;
 const r=new Request(input,init),u=new URL(r.url);
 if(u.origin==='https://api.resend.com'&&u.pathname==='/emails'&&r.method==='POST'){
  const b=await r.json(),email=b.to?.[0],code=String(b.text||'').match(/验证码：(\d{6})/)?.[1];
  if(!/^synthetic-[a-z0-9-]+@example\.test$/.test(email)||!code||r.headers.get('authorization')!=='Bearer synthetic-mail-key')throw Error('SYNTHETIC_MAIL_REJECTED');
  mails.set(email,code);return Response.json({id:'synthetic-mail'});
 }
 if(u.origin==='https://challenges.cloudflare.com'&&u.pathname==='/turnstile/v0/siteverify'&&r.method==='POST'){
  const b=new URLSearchParams(await r.text());if(b.get('secret')!=='synthetic-turnstile-only'||b.get('response')!=='synthetic-turnstile-token')throw Error('SYNTHETIC_TURNSTILE_REJECTED');
  return Response.json({success:true,hostname:'isolated-web.example.test',action:'register'});
 }
 if(u.origin==='https://cloudflare-dns.com'&&u.pathname==='/dns-query'&&u.searchParams.get('name')==='api.deepseek.com'&&['A','AAAA'].includes(u.searchParams.get('type'))&&r.method==='GET'){
  return Response.json({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
 }
 if(u.origin==='https://api.deepseek.com'&&['/chat/completions','/v1/chat/completions'].includes(u.pathname)&&r.method==='POST'&&r.headers.get('authorization')==='Bearer synthetic-model-key'){
  const b=await r.json();if(!Array.isArray(b.messages)||b.messages.length!==2)throw Error('SYNTHETIC_AI_REJECTED');
  const invalid=b.messages.some(x=>String(x.content).includes('SYNTHETIC_INVALID_OUTPUT'));
  const output={recommendation:'reply',defaultStyle:'natural',language:'zh',reason:'A real detail.',replies:invalid?{natural:'same',light_humor:'same',thoughtful:'different'}:{natural:'确实如此',light_humor:'这下有点意思了',thoughtful:'这个项目的发布时间挺关键'},quoteCandidate:null};
  return Response.json({model:'synthetic-provider',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:40,completion_tokens:30}});
 }
 if(u.origin==='https://mk99.cn'&&r.method==='POST'){
  const b=new URLSearchParams(await r.text()),order=b.get('out_trade_no');
  if(b.get('pid')!=='20881234567890'||!order||!/^[-_a-zA-Z0-9]{1,100}$/.test(order))throw Error('SYNTHETIC_MK99_REJECTED');
  return Response.json({code:1,data:{trade_no:'SYN_'+order,out_trade_no:order,pay_url:'https://cashier.example.test/pay',total_amount:b.get('total_amount')||'10.43',trade_status:'WAIT_BUYER_PAY'}});
 }
 console.log('XRH_SYNTHETIC_OUTBOUND_DENIED');throw Error('SYNTHETIC_OUTBOUND_DENIED');
}
