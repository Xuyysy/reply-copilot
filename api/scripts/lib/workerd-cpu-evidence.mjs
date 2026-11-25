export const ROUTES = Object.freeze(['health', 'me', 'usage', 'entitlements', 'bootstrap', 'login_10k', 'login_100k', 'ai_generate_mock', 'ai_delivery_ack']);

export function parseOptions(args) {
  const opts = {samples: 3, warmup: 1, profile: false, source: 'free'};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source') {if (++i >= args.length || !['free','paid','subscription'].includes(args[i])) throw Error('Invalid source'); opts.source=args[i]; continue;}
    if (arg === '--profile') {opts.profile = true; continue;}
    if (arg !== '--samples' && arg !== '--warmup') throw Error('Unsupported argument');
    if (++i >= args.length) throw Error('Missing value');
    const value = Number(args[i]);
    if (!Number.isInteger(value)) throw Error('Invalid integer');
    opts[arg === '--samples' ? 'samples' : 'warmup'] = value;
  }
  if (opts.samples < 1 || opts.samples > 4 || opts.warmup < 0 || opts.warmup > 1) throw Error('Synthetic request cap exceeded');
  return opts;
}

export function migrationStatements(source) {
  if (typeof source !== 'string') throw Error('Invalid migration');
  const withoutComments = source.replace(/^\s*--[^\n]*$/gm, '');
  // SQLite triggers have interior semicolons. The local fixture uses the
  // same escape strategy as production-generation-workers-runtime.test.mjs.
  const escaped = withoutComments.replace(/CREATE TRIGGER[\s\S]*?END;/gi, value => {
    const end = value.lastIndexOf('END;');
    return value.slice(0, end).replaceAll(';', '__WORKERD_TEST_SEMICOLON__') + value.slice(end);
  });
  return escaped.split(';').map(value => value.replaceAll('__WORKERD_TEST_SEMICOLON__', ';').trim()).filter(Boolean);
}

function q(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)].toFixed(3));
}

export function summarizeWallMs(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid timing evidence');
  return {metric: 'node_dispatch_roundtrip_wall_ms', samples: values.length, p50Ms: q(values, 0.5), p95Ms: q(values, 0.95), maxMs: q(values, 1)};
}

export function summarizeV8Profile(profile) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)) return {status: 'INSUFFICIENT', sampleCount: 0, topFunctions: []};
  const names = new Map(profile.nodes.map(node => [node.id, node.callFrame?.functionName || '(anonymous)']));
  const tally = new Map();
  for (const id of profile.samples) {
    const fn = names.get(id) || '(unknown)';
    // Never output arbitrary file paths, URL parameters, or dynamic labels.
    const safe = /^[a-zA-Z0-9_$().<> -]{1,100}$/.test(fn) ? fn : '(redacted)';
    tally.set(safe, (tally.get(safe) || 0) + 1);
  }
  const total = profile.samples.length;
  if (total < 2) return {status: 'INSUFFICIENT', sampleCount: total, topFunctions: []};
  const topFunctions = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({name, samples: count, sampleSharePct: Number((100 * count / total).toFixed(1))}));
  return {status: 'SAMPLED', sampleCount: total, topFunctions};
}
