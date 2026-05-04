import type { FastifyReply, FastifyRequest } from "fastify";
import { getAdminSecret } from "../config/runtime-config.js";
import { isBasicAuthSatisfied } from "./basic-auth.js";
import { isLoopbackIp } from "./ip-allowlist.js";
import { safeCompareString } from "../utils/security.js";

export function isAdminAuthorized(request: FastifyRequest): boolean {
  const adminSecret = getAdminSecret();
  if (!adminSecret) return false;
  const provided = request.headers["x-admin-secret"];
  const value = Array.isArray(provided) ? provided[0] : provided;
  return typeof value === "string" && safeCompareString(value, adminSecret);
}

export function requirePrivilegedAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { loopbackOnly?: boolean; feature?: string } = {},
): boolean {
  if (!isBasicAuthSatisfied(request)) {
    reply.status(403).send({
      error: "Privileged API requires authenticated access",
      message: "Configure Basic Auth or use loopback/local access before calling privileged APIs.",
    });
    return false;
  }

  if (options.loopbackOnly && !isLoopbackIp(request.ip)) {
    reply.status(403).send({
      error: "Privileged API is loopback-only",
      message: `${options.feature ?? "This feature"} is available only from loopback unless explicitly enabled.`,
    });
    return false;
  }

  if (!getAdminSecret()) {
    reply.status(403).send({
      error: "ADMIN_SECRET is required for privileged APIs",
      message: "Set ADMIN_SECRET and send it in the X-Admin-Secret header.",
    });
    return false;
  }

  if (!isAdminAuthorized(request)) {
    reply.status(403).send({ error: "Invalid or missing X-Admin-Secret header" });
    return false;
  }

  return true;
}
