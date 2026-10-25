export function paymentActionLabel(channel, action='pay', language='zh') {
 const en=language==='en';
 if(channel==='WECHAT_H5')return action==='cashier'?(en?'Open WeChat Pay cashier':'打开微信支付收银台'):(en?'Pay with WeChat Pay':'使用微信支付');
 return action==='cashier'?(en?'Open Alipay cashier':'打开支付宝收银台'):(en?'Pay with Alipay':'使用支付宝付款');
}
