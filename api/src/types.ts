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
  DISPOSABLE_EMAIL_DOMAINS?: string;
  DEEPSEEK_INPUT_USD_PER_MILLION?: string;
  DEEPSEEK_OUTPUT_USD_PER_MILLION?: string;
  ADMIN_PORTAL_ENABLED?: string;
  PAYMENTS_ENABLED?: string;
  /** BoltUtil is staged independently of MK99/Xiaodou payment controls. */
  BOLTUTIL_ENABLED?: string;
  BOLTUTIL_TRC20_ENABLED?: string;
  BOLTUTIL_POLYGON_ENABLED?: string;
  BOLTUTIL_BEP20_ENABLED?: string;
  BOLTUTIL_ERC20_ENABLED?: string;
  BOLTUTIL_SOLANA_ENABLED?: string;
  BOLTUTIL_SCHEMA_READY?: string;
  BOLTUTIL_STAGING_CREATE_ENABLED?: string;
  BOLTUTIL_API_KEY?: string;
  /** Admin-only real-mainnet 1-USDT diagnostic; never enables public checkout. */
  BOLTUTIL_ADMIN_TEST_ENABLED?: string;
  /** Archived probe read/refresh stays available; retired creation is OFF unless explicitly reauthorized. */
  BOLTUTIL_ADMIN_TEST_CREATE_ENABLED?: string;
  BOLTUTIL_ADMIN_TEST_SCHEMA_READY?: string;
  BOLTUTIL_WEBHOOK_SECRET?: string;
  /** Fixed, operator-approved CNY per USDT in 1e-6 CNY, staging only. */
  BOLTUTIL_CNY_PER_USDT_MICROS?: string;
  SUBSCRIPTIONS_ENABLED?: string;
  /** Disabled-by-default 5-use QA ceiling, only for one authenticated Staging subscriber. */
  STAGING_QA_SUBSCRIPTION_FIVE?: string;
  STAGING_QA_SUBSCRIPTION_USER_ID?: string;
  /** Optional unique Staging username selector; ID selector takes precedence. */
  STAGING_QA_SUBSCRIPTION_USERNAME?: string;
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
  XIAODOU_RSA2_SUBSCRIPTIONS_READY?: string;
  XIAODOU_WECHAT_MERCHANT_APPROVED?: string;
  XIAODOU_TRADE_SCOPE?: string;
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
