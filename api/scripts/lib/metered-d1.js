// Isolated profiling helper only. Never imported by the deployed Worker.
// Benchmarks are strictly sequential: preserving binding identity lets real
// application caches behave normally. Never use this helper for concurrency.
const pools=new WeakMap();
export function meteredD1(db,metrics){
 const old=pools.get(db);if(old){old.metrics=metrics;return old.proxy;}
 const holder={metrics};
 const add=r=>{if(!Number.isSafeInteger(r.meta?.rows_read)||!Number.isSafeInteger(r.meta?.rows_written))throw Error('D1 measurement metadata unavailable');holder.metrics.queries++;holder.metrics.rowsRead+=r.meta.rows_read;holder.metrics.rowsWritten+=r.meta.rows_written;return r};
 const wrap=s=>({statement:s,bind(...a){return wrap(s.bind(...a))},async first(column){const r=add(await s.all());return column?(r.results[0]?.[column]??null):(r.results[0]??null)},async all(){return add(await s.all())},async run(){return add(await s.run())}});
 const proxy={prepare:sql=>wrap(db.prepare(sql)),async batch(statements){const r=await db.batch(statements.map(s=>s.statement));r.forEach(add);return r}};
 holder.proxy=proxy;pools.set(db,holder);return proxy;
}
