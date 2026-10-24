// Generic RFC 1321 digest primitive shared by legacy integrations. Protocol
// canonicalization and key handling remain inside each provider adapter.
const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
const constants = Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296)|0);
export function md5Hex(text) {
  const input=new TextEncoder().encode(text),size=Math.ceil((input.length+9)/64)*64;
  const bytes=new Uint8Array(size);bytes.set(input);bytes[input.length]=128;
  const view=new DataView(bytes.buffer),bits=BigInt(input.length)*8n;
  view.setUint32(size-8,Number(bits&0xffffffffn),true);view.setUint32(size-4,Number(bits>>32n),true);
  let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476;
  for(let offset=0;offset<size;offset+=64){
    let a=h0,b=h1,c=h2,d=h3;
    for(let i=0;i<64;i++){
      const round=i>>4,g=round===0?i:round===1?(5*i+1)%16:round===2?(3*i+5)%16:(7*i)%16;
      const f=round===0?(b&c)|(~b&d):round===1?(d&b)|(~d&c):round===2?b^c^d:c^(b|~d);
      const n=(a+f+constants[i]+view.getInt32(offset+g*4,true))|0,s=shifts[round*4+i%4];
      a=d;d=c;c=b;b=(b+((n<<s)|(n>>>(32-s))))|0;
    }
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;
  }
  return [h0,h1,h2,h3].map(n=>[0,8,16,24].map(s=>((n>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');
}
