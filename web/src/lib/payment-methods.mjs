// A visible choice always carries its provider; channel names are not route IDs.
export const paymentMethodKey=method=>`${method.provider}:${method.channel}`;
export function uniquePaymentMethods(methods){const seen=new Set();return methods.filter(method=>{const key=paymentMethodKey(method);if(seen.has(key))return false;seen.add(key);return true;});}
