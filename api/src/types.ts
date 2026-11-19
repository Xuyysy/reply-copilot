export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  WEB_ORIGIN: string;
  API_ORIGIN: string;
  EXTENSION_ORIGIN?: string;
  SITE_DAILY_CAP?: string;
  AUTH_HASH_SECRET?: string;
  DEEPSEEK_API_KEY?: string;
  AI_CONFIG_ENCRYPTION_KEY?: string;
  AI_MOCK?: string;
  AI_MOCK_COST_MICRO_USD?: string;
  AI_MOCK_DELAY_MS?: string;
  AI_MODE?: string;
  AI_PERFORMANCE_DIAGNOSTICS?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
  TURNSTILE_SECRET_KEY?: string;
  PASSWORD_PEPPER?: string;
  /** Optional CPU-limited password derivation for NEW hashes; default safe 100k. */
  PASSWORD_FREE_CPU_ENABLED?: string;
  /** Paid-only transitional rehash of verified legacy passwords. Never implicit. */
  PASSWORD_LEGACY_MIGRATION_ENABLED?: string;
  /** Explicit additional opt-in: PBKDF2 10k, significantly weaker than OWASP recommendations. */
  PASSWORD_FREE_TINY_CPU_ENABLED?: string;
  /** Optional email-only user login; requires separately approved SQL table; disabled by default. */
  EMAIL_OTP_LOGIN_ENABLED?: string;
  /** Optional cutover gate to disable PBKDF2 password login; default remains enabled. */
  PASSWORD_LOGIN_ENABLED?: string;
  DISPOSABLE_EMAIL_DOMAINS?: string;
  DEEPSEEK_INPUT_USD_PER_MILLION?: string;
  DEEPSEEK_OUTPUT_USD_PER_MILLION?: string;
  ADMIN_PORTAL_ENABLED?: string;
  PAYMENTS_ENABLED?: string;
  /** BoltUtil USDT is independent of the MK99/Xiaodou fiat rail. */
  BOLTUTIL_ENABLED?: string;
  BOLTUTIL_TRC20_ENABLED?: string;
  BOLTUTIL_POLYGON_ENABLED?: string;
  BOLTUTIL_BEP20_ENABLED?: string;
  BOLTUTIL_ERC20_ENABLED?: string;
  BOLTUTIL_SOLANA_ENABLED?: string;
  BOLTUTIL_SCHEMA_READY?: string;
  BOLTUTIL_STAGING_CREATE_ENABLED?: string;
  BOLTUTIL_PRODUCTION_CREATE_ENABLED?: string;
  BOLTUTIL_API_KEY?: string;
  BOLTUTIL_WEBHOOK_SECRET?: string;
  BOLTUTIL_CNY_PER_USDT_MICROS?: string;
  /** Explicit release acknowledgements. These are not evidence of a live payment. */
  BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED?: string;
  BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED?: string;
  /** Must exactly match the configured CNY/USDT micros quote; rate changes revoke approval. */
  BOLTUTIL_PRODUCTION_APPROVED_CNY_PER_USDT_MICROS?: string;
  BOLTUTIL_ADMIN_TEST_ENABLED?: string;
  BOLTUTIL_ADMIN_TEST_CREATE_ENABLED?: string;
  BOLTUTIL_ADMIN_TEST_SCHEMA_READY?: string;
  SUBSCRIPTIONS_ENABLED?: string;
  SUBSCRIPTION_PURCHASES_ENABLED?: string;
  SUBSCRIPTION_CHECKOUT_ENABLED?: string;
  XIAODOU_WEBHOOKS_ENABLED?: string;
  PAYMENT_PROVIDER?: string;
  MK99_BASE_URL?: string;
  MK99_PID?: string;
  MK99_KEY?: string;
  MK99_PRIVATE_KEY?: string;
  MK99_PLATFORM_PUBLIC_KEY?: string;
  MK99_REQUEST_SIGN_TYPE?: string;
  MK99_NOTIFY_SIGN_TYPE?: string;
  MK99_PROTOCOL_CONFIRMED?: string;
  MK99_AMOUNT_CONTRACT?: string;
  MK99_CASHIER_ORIGINS?: string;
  MK99_NOTIFY_DIAGNOSTICS_ENABLED?: string;
  XIAODOU_BASE_URL?: string;
  XIAODOU_APP_ID?: string;
  XIAODOU_KEY_ID?: string;
  XIAODOU_PRIVATE_KEY?: string;
  XIAODOU_PLATFORM_PUBLIC_KEYS?: string;
  XIAODOU_RETURN_URL?: string;
  XIAODOU_EPAY_GATEWAY?: string;
  XIAODOU_EPAY_PID?: string;
  XIAODOU_EPAY_KEY?: string;
  XIAODOU_NETWORK_DIAGNOSTIC_ENABLED?: string;
  XIAODOU_SOURCE_IP_CONFIRMED?: string;
  /** The operator independently confirmed the vendor IP allowlist is disabled. */
  XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED?: string;
  XIAODOU_RSA2_SUBSCRIPTIONS_READY?: string;
  XIAODOU_WECHAT_MERCHANT_APPROVED?: string;
  XIAODOU_TRADE_SCOPE?: string;
  /** Explicit owner-only Production test enabling; defaults disabled. */
  XIAODOU_PRODUCTION_PILOT_ENABLED?: string;
  /** Separate merchant Alipay + declared trade-scope approval attestation. */
  XIAODOU_PRODUCTION_PILOT_TRADE_APPROVED?: string;
  /** Only exercised with the reserved api-staging.example.test fixture hostname. */
  XIAODOU_EPAY_TEST_COMPAT?: string;
}

export type Session = { id: string; user_id: string; email: string; kind: "web" | "extension"; device_id: string | null; csrf_token_hash: string | null; expires_at: number };

export type RegistrationStage =
  | "origin_validation"
  | "request_validation"
  | "rate_limit"
  | "registration_settings"
  | "turnstile"
  | "account_lookup"
  | "registration_code_hash"
  | "password_hash"
  | "pending_registration_write"
  | "mail_send";

export interface RegistrationDiagnostics {
  requestId: string;
  stage: RegistrationStage;
}

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterSeconds?: number) { super(message); }
}

export type RefreshDiagnosticCode = "PROVIDER_NETWORK_ERROR" | "PROVIDER_HTTP_ERROR" | "PROVIDER_SIGNATURE_ERROR" | "PROVIDER_CONFIG_ERROR" | "ORDER_RECONCILIATION_ERROR" | "SERVER_UNAVAILABLE";
export type RefreshDiagnosticStage = "provider_config" | "provider_request_signing" | "provider_fetch" | "provider_http_response" | "provider_response_signature" | "provider_response" | "order_reconciliation" | "unknown";
export type ProviderResponseDiagnostic = {
  format: "business_json" | "other_json" | "html" | "other";
  providerCode: string | null;
  signatureState: "absent" | "incomplete" | "invalid" | "verified";
  sourceIpReason: "PEER_NOT_TRUSTED" | "FORWARDED_HEADER_PRESENT" | "XFF_MISSING" | "XFF_CHAIN_ABNORMAL"
    | "XFF_LAST_INVALID" | "REAL_IP_MISSING" | "HEADER_CONFLICT" | null;
};

export class RefreshDiagnosticFailure extends ApiFailure {
  constructor(
    public diagnosticCode: RefreshDiagnosticCode,
    public stage: RefreshDiagnosticStage,
    public requestId: string,
    status: number,
    message: string,
    public upstreamHttpStatus: number | null = null,
    public providerResponse: ProviderResponseDiagnostic | null = null,
  ) {
    super(status, diagnosticCode, message);
  }
}
