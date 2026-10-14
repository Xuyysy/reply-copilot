import type { Env } from "./types";
import { ApiFailure } from "./types";
import { failure, options, response } from "./http";
import { csrf, logout, requestCode, requireCsrf, sessionFor, takeRate, verifyCode } from "./auth";
import { entitlements, licenseDevices, me, usage } from "./account";
import { approveDevice, exchangeDevice, requestDeviceCode } from "./device";
import { generate } from "./ai";
import { jsonBody, nowMs, uuid } from "./security";
import { cleanup } from "./cleanup";

async function feedback(request: Request, env: Env): Promise<Response> {
  const { session, token } = await sessionFor(request, env);
  if (session.kind !== "web") throw new ApiFailure(403, "FORBIDDEN", "请在网页登录后反馈。");
  await requireCsrf(request, env, token);
  const body = await jsonBody(request, 4096);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) throw new ApiFailure(400, "INVALID_REQUEST", "反馈内容长度无效。");
  if (!await takeRate(env, `feedback:${session.user_id}`, 5, 86400_000, nowMs())) throw new ApiFailure(429, "RATE_LIMITED", "今日反馈次数已达上限。", 3600);
  await env.DB.prepare("INSERT INTO feedback(id,user_id,message,created_at) VALUES(?,?,?,?)").bind(uuid(), session.user_id, message, nowMs()).run();
  return response({ ok: true }, 200, env, request);
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> { await cleanup(env); },
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return options(request, env);
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "GET" && path === "/health") return response({ ok: true, service: "reply-copilot-api" }, 200, env, request);
      if (request.method === "POST" && path === "/v1/auth/request-code") return await requestCode(request, env);
      if (request.method === "POST" && path === "/v1/auth/verify-code") return await verifyCode(request, env);
      if (request.method === "GET" && path === "/v1/auth/csrf") return await csrf(request, env);
      if (request.method === "POST" && path === "/v1/auth/logout") return await logout(request, env);
      if (request.method === "GET" && path === "/v1/me") return await me(request, env);
      if (request.method === "GET" && path === "/v1/entitlements") return await entitlements(request, env);
      if (request.method === "GET" && path === "/v1/usage") return await usage(request, env);
      if (request.method === "GET" && path === "/v1/license/devices") return await licenseDevices(request, env);
      if (request.method === "POST" && path === "/v1/extension/device-code") return await requestDeviceCode(request, env);
      if (request.method === "POST" && path === "/v1/extension/approve") return await approveDevice(request, env);
      if (request.method === "POST" && path === "/v1/extension/exchange") return await exchangeDevice(request, env);
      if (request.method === "POST" && path === "/v1/ai/generate") return await generate(request, env);
      if (request.method === "POST" && path === "/v1/feedback") return await feedback(request, env);
      throw new ApiFailure(404, "NOT_FOUND", "接口不存在。");
    } catch (error) { return failure(error, env, request); }
  },
} satisfies ExportedHandler<Env>;
