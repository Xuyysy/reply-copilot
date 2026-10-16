import type { Env } from "./types";
import { ApiFailure } from "./types";
import { failure, options, response } from "./http";
import { csrf, logout, requireCsrf, sessionFor, takeRate } from "./auth";
import { entitlements, licenseDevices, me, usage,activity } from "./account";
import {register,verifyRegistration,passwordLogin,requestPasswordReset,resetPassword} from "./password-auth";
import {packages,createOrder,adminDashboard,adminUsers,adminUserStatus,adminAdjust,adminPackages,adminPackageUpdate,adminOrders,adminSettings,adminSettingUpdate,adminLedger,settleMockOrder} from "./commercial";
import { approveDevice, deviceCodeStatus, exchangeDevice, requestDeviceCode } from "./device";
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
    const path = new URL(request.url).pathname;
    try {
      const host=new URL(request.url).hostname;
      if(env.ENVIRONMENT==="development" && host!=="127.0.0.1" && host!=="localhost") throw new ApiFailure(503,"ENVIRONMENT_NOT_CONFIGURED","开发环境只能在本机运行。");
      if(env.ENVIRONMENT!=="development" && (!['staging','production'].includes(env.ENVIRONMENT)||[env.WEB_ORIGIN,env.API_ORIGIN].some(value=>!value?.startsWith('https://')||value.includes('.invalid'))||!/^chrome-extension:\/\/[a-p]{32}$/.test(env.EXTENSION_ORIGIN||''))) throw new ApiFailure(503,"ENVIRONMENT_NOT_CONFIGURED","服务环境尚未完成隔离配置。");
      if (request.method === "OPTIONS") return options(request, env);
      if (request.method === "GET" && path === "/health") return response({ ok: true, service: "reply-copilot-api" }, 200, env, request);
      if (request.method === "POST" && path === "/v1/auth/register") return await register(request,env);
      if (request.method === "POST" && path === "/v1/auth/verify-registration") return await verifyRegistration(request,env);
      if (request.method === "POST" && path === "/v1/auth/login") return await passwordLogin(request,env);
      if (request.method === "POST" && path === "/v1/auth/request-password-reset") return await requestPasswordReset(request,env);
      if (request.method === "POST" && path === "/v1/auth/reset-password") return await resetPassword(request,env);
      if (request.method === "GET" && path === "/v1/auth/csrf") return await csrf(request, env);
      if (request.method === "POST" && path === "/v1/auth/logout") return await logout(request, env);
      if (request.method === "GET" && path === "/v1/me") return await me(request, env);
      if (request.method === "GET" && path === "/v1/entitlements") return await entitlements(request, env);
      if (request.method === "GET" && path === "/v1/usage") return await usage(request, env);
      if (request.method === "GET" && path === "/v1/activity") return await activity(request,env);
      if (request.method === "GET" && path === "/v1/packages") return await packages(request,env);
      if (request.method === "POST" && path === "/v1/orders") return await createOrder(request,env);
      if (request.method === "GET" && path === "/v1/license/devices") return await licenseDevices(request, env);
      if (request.method === "POST" && path === "/v1/extension/device-code") return await requestDeviceCode(request, env);
      if (request.method === "GET" && path === "/v1/extension/device-code/status") return await deviceCodeStatus(request, env);
      if (request.method === "POST" && path === "/v1/extension/approve") return await approveDevice(request, env);
      if (request.method === "POST" && path === "/v1/extension/exchange") return await exchangeDevice(request, env);
      if (request.method === "POST" && path === "/v1/ai/generate") return await generate(request, env);
      if (request.method === "POST" && path === "/v1/feedback") return await feedback(request, env);
      if (request.method === "GET" && path === "/v1/admin/dashboard") return await adminDashboard(request,env);
      if (request.method === "GET" && path === "/v1/admin/users") return await adminUsers(request,env);
      if (request.method === "GET" && path === "/v1/admin/packages") return await adminPackages(request,env);
      if (request.method === "GET" && path === "/v1/admin/orders") return await adminOrders(request,env);
      if (request.method === "GET" && path === "/v1/admin/settings") return await adminSettings(request,env);
      if (request.method === "GET" && path === "/v1/admin/ledger") return await adminLedger(request,env);
      const userStatus=path.match(/^\/v1\/admin\/users\/([0-9a-f-]{36})\/status$/i);
      if(request.method==="POST"&&userStatus)return await adminUserStatus(request,env,userStatus[1]);
      const userAdjust=path.match(/^\/v1\/admin\/users\/([0-9a-f-]{36})\/credits$/i);
      if(request.method==="POST"&&userAdjust)return await adminAdjust(request,env,userAdjust[1]);
      const packageUpdate=path.match(/^\/v1\/admin\/packages\/([a-z0-9_-]{1,64})$/i);
      if(request.method==="POST"&&packageUpdate)return await adminPackageUpdate(request,env,packageUpdate[1]);
      const settingUpdate=path.match(/^\/v1\/admin\/settings\/([a-z_]+)$/);
      if(request.method==="POST"&&settingUpdate)return await adminSettingUpdate(request,env,settingUpdate[1]);
      const mockPayment=path.match(/^\/v1\/dev\/orders\/([0-9a-f-]{36})\/settle$/i);
      if(request.method==="POST"&&mockPayment)return await settleMockOrder(request,env,mockPayment[1]);
      throw new ApiFailure(404, "NOT_FOUND", "接口不存在。");
    } catch (error) { return failure(error, env, request); }
  },
} satisfies ExportedHandler<Env>;
