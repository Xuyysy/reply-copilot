// Source checkout is for local development. scripts/build.js replaces this file
// in the production package and omits the entire dev/ directory.
export const RUNTIME_CONFIG = Object.freeze({
  channel: "development",
  websiteUrl: "http://127.0.0.1:4321",
  hostedApiUrl: "http://127.0.0.1:8787",
  allowedHttpHosts: ["127.0.0.1", "localhost"],
  requestTimeoutMs: 30000,
});
