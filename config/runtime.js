// Source checkout is for local development. scripts/build.js replaces this file
// in the production package and omits the entire dev/ directory.
export const RUNTIME_CONFIG = Object.freeze({
  channel: "development",
  websiteUrl: "",
  hostedApiUrl: "",
  requestTimeoutMs: 30000,
});
