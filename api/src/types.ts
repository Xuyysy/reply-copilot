export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  WEB_ORIGIN: string;
  API_ORIGIN: string;
  EXTENSION_ORIGIN?: string;
  SITE_DAILY_CAP: string;
  AUTH_HASH_SECRET?: string;
  DEEPSEEK_API_KEY?: string;
  AI_MOCK?: string;
  AI_MOCK_COST_MICRO_USD?: string;
  AI_MOCK_DELAY_MS?: string;
  AI_MODE?: string;
  REAL_DEEPSEEK_TEST_ENABLED?: string;
  REAL_DEEPSEEK_TEST_USER_EMAIL?: string;
  REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
  TURNSTILE_SECRET_KEY?: string;
  PASSWORD_PEPPER?: string;
  DISPOSABLE_EMAIL_DOMAINS?: string;
  DEEPSEEK_INPUT_USD_PER_MILLION?: string;
  DEEPSEEK_OUTPUT_USD_PER_MILLION?: string;
  ADMIN_PORTAL_ENABLED?: string;
  PAYMENTS_ENABLED?: string;
  XIAODOU_WEBHOOKS_ENABLED?: string;
  PAYMENT_PROVIDER?: string;
  XIAODOU_BASE_URL?: string;
  XIAODOU_APP_ID?: string;
  XIAODOU_KEY_ID?: string;
  XIAODOU_PRIVATE_KEY?: string;
  XIAODOU_PLATFORM_PUBLIC_KEYS?: string;
  XIAODOU_RETURN_URL?: string;
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
