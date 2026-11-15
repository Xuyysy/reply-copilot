import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NETWORKS,SUPPORTED_BOLT_NETWORKS,parseBoltNetwork,decimalMicros,formatMicros,
  tokenRawUnits,validReceivingAddress,validTransactionHash,verifiedPayment,
  distinctSettlement,quoteFromCnyFen
} from '../src/boltutil/contract.ts';

const tronAddress='T'+'1'.repeat(33);
const evmAddress='0x'+'a'.repeat(40);
const tronHash='f'.repeat(64);
const evmHash='0x'+'b'.repeat(64);
const base={eventId:'evt_123456',externalOrderId:'XRH_123456',status:'CONFIRMED',
  currency:'USDT',settlementType:'EXACT',manuallyAccepted:false,
  amount:'12.345678',paidAmount:'12.345678',shortfallAmount:'0'};

test('only the three explicitly approved USDT networks are accepted',()=>{
  assert.deepEqual(SUPPORTED_BOLT_NETWORKS,['TRC20','POLYGON','BEP20']);
  for(const chain of SUPPORTED_BOLT_NETWORKS) assert.equal(parseBoltNetwork(chain),chain);
  for(const unsupported of ['BSC','BNB','ERC20','POLYGON_USDT','SOLANA',null,''])
    assert.throws(()=>parseBoltNetwork(unsupported));
});
test('USDT contracts and on-chain decimals never alias networks',()=>{
  assert.equal(NETWORKS.TRC20.decimals,6);
  assert.equal(NETWORKS.POLYGON.decimals,6);
  assert.equal(NETWORKS.BEP20.decimals,18);
  assert.equal(NETWORKS.BEP20.contract,'0x55d398326f99059fF775485246999027B3197955');
  assert.notEqual(NETWORKS.POLYGON.contract,NETWORKS.BEP20.contract);
});
test('order amounts use 6 decimal digits but BEP20 token raw uses 18',()=>{
  const amount=decimalMicros('12.345678');
  assert.equal(amount,12345678n);
  assert.equal(formatMicros(amount),'12.345678');
  assert.equal(tokenRawUnits(amount,'TRC20').toString(),'12345678');
  assert.equal(tokenRawUnits(amount,'POLYGON').toString(),'12345678');
  assert.equal(tokenRawUnits(amount,'BEP20').toString(),'12345678000000000000');
  for(const invalid of [12.345678,'-1','1e5','0.0000001','01.00',' 1.00','Infinity'])
    assert.throws(()=>decimalMicros(invalid));
});
test('network-specific transfer address and transaction formats',()=>{
  assert.ok(validReceivingAddress(tronAddress,'TRC20'));
  assert.equal(validReceivingAddress(evmAddress,'TRC20'),false);
  assert.equal(validReceivingAddress(tronAddress,'BEP20'),false);
  assert.ok(validReceivingAddress(evmAddress,'BEP20'));
  assert.ok(validReceivingAddress(evmAddress,'POLYGON'));
  assert.ok(validTransactionHash(tronHash,'TRC20'));
  assert.ok(validTransactionHash(evmHash,'BEP20'));
  assert.ok(validTransactionHash(evmHash,'POLYGON'));
  assert.equal(validTransactionHash(tronHash,'BEP20'),false);
});
test('signed confirmed state alone cannot override network, amount or manual-review rules',()=>{
  const tron=verifiedPayment({...base,network:'TRC20',txHash:tronHash,destinationAddress:tronAddress});
  const bsc=verifiedPayment({...base,network:'BEP20',txHash:evmHash,destinationAddress:evmAddress});
  const polygon=verifiedPayment({...base,network:'POLYGON',txHash:evmHash,destinationAddress:evmAddress});
  assert.equal(distinctSettlement(bsc,polygon),false);
  assert.equal(distinctSettlement(tron,bsc),false);
  assert.ok(distinctSettlement(bsc,{...bsc,status:'COMPLETED'}));
  assert.throws(()=>verifiedPayment({...base,network:'BEP20',txHash:evmHash,destinationAddress:tronAddress}));
  assert.throws(()=>verifiedPayment({...base,network:'BEP20',txHash:evmHash,destinationAddress:evmAddress,status:'PAID'}));
  assert.throws(()=>verifiedPayment({...base,network:'BEP20',txHash:evmHash,destinationAddress:evmAddress,settlementType:'MANUAL_OVERPAID'}));
  assert.throws(()=>verifiedPayment({...base,network:'BEP20',txHash:evmHash,destinationAddress:evmAddress,paidAmount:'12.34'}));
  assert.throws(()=>verifiedPayment({...base,network:'BEP20',txHash:evmHash,destinationAddress:evmAddress,shortfallAmount:'0.01'}));
});
test('quoting cannot use float and rejects unset/implausibly low rates',()=>{
  assert.equal(formatMicros(quoteFromCnyFen(6990,'7000000')),'9.985715');
  assert.throws(()=>quoteFromCnyFen(6990,'0'));
  assert.throws(()=>quoteFromCnyFen(0,'7000000'));
  assert.throws(()=>quoteFromCnyFen(6990,'0.7'));
});
