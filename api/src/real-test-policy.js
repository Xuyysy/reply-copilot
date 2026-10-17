export function realTestAllowed(env, email) {
  const budget = Number(env.REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD);
  const siteCap = Number(env.SITE_DAILY_CAP);
  const allowedEmail = typeof env.REAL_DEEPSEEK_TEST_USER_EMAIL === "string"
    ? env.REAL_DEEPSEEK_TEST_USER_EMAIL.trim().toLowerCase()
    : "";
  return env.ENVIRONMENT === "staging"
    && env.REAL_DEEPSEEK_TEST_ENABLED === "1"
    && Boolean(allowedEmail)
    && typeof email === "string"
    && email.trim().toLowerCase() === allowedEmail
    && Number.isSafeInteger(budget)
    && budget >= 1
    && budget <= 100_000
    && Number.isSafeInteger(siteCap)
    && siteCap >= 1
    && siteCap <= 10;
}
