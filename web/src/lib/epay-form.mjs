// Only submit on an explicit customer click. Build DOM nodes rather than HTML
// strings, so product names and signed fields cannot become executable markup.
export function submitEpayForm(payment, document = globalThis.document) {
  const allowed=new Set(['pid','type','out_trade_no','notify_url','return_url','name','money','sign','sign_type']);
  const target=new URL(payment?.action);
  const fields=payment?.fields;
  if(payment?.method!=='POST'||target.protocol!=='https:'||target.username||target.password||target.port||target.search||target.hash||target.pathname!=='/submit.php'
    ||!fields||typeof fields!=='object'||Array.isArray(fields)
    ||Object.entries(fields).some(([key,value])=>!allowed.has(key)||typeof value!=='string')
    ||!['pid','out_trade_no','notify_url','name','money','sign'].every(key=>fields[key])
    ||fields.type!=='alipay'||fields.sign_type!=='MD5'||!/^[a-f0-9]{32}$/.test(fields.sign))throw new Error('Invalid checkout form');
  const form=document.createElement('form');form.method='POST';form.action=target.href;form.hidden=true;
  for(const [name,value] of Object.entries(fields)){
    const field=document.createElement('input');field.type='hidden';field.name=name;field.value=value;form.appendChild(field);
  }
  document.body.appendChild(form);
  try{form.submit();}finally{form.remove();}
}
