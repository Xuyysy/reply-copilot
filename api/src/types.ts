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
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
}

export type Session = { id: string; user_id: string; email: string; kind: "web" | "extension"; device_id: string | null; csrf_token_hash: string | null; expires_at: number };

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterSeconds?: number) { super(message); }
}
