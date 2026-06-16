import { and, eq, gte, lt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/db/client";
import { adminSessions, loginAttempts, type AdminSession } from "@/db/schema";
import type { CookieJar } from "./cookies";
import { secureCookie } from "./cookies";

export const adminSessionCookie = "semilla_admin_session";
const sessionDays = 7;
const loginWindowMinutes = 15;
const maxFailedAttempts = 5;

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function expiresAt(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function loginWindowStart(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - loginWindowMinutes);
  return date.toISOString();
}

function pruneLoginAttempts(): void {
  db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, loginWindowStart())).run();
}

function trustProxyHeaders(): boolean {
  return process.env.TRUST_PROXY === "true";
}

export function loginIdentifier(request: Request, username: string): string {
  const trustedProxy = trustProxyHeaders();
  const forwardedFor = trustedProxy ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const realIp = trustedProxy ? request.headers.get("x-real-ip") : undefined;
  const ip = forwardedFor || realIp || "local";
  return `${ip}:${username.trim().toLowerCase() || "unknown"}`;
}

export function isLoginRateLimited(identifier: string): boolean {
  pruneLoginAttempts();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.identifier, identifier), gte(loginAttempts.attemptedAt, loginWindowStart())))
    .get();

  return Number(row?.count ?? 0) >= maxFailedAttempts;
}

export function recordFailedLogin(identifier: string): void {
  pruneLoginAttempts();
  db.insert(loginAttempts).values({ identifier, attemptedAt: new Date().toISOString() }).run();
}

export function clearLoginAttempts(identifier: string): void {
  db.delete(loginAttempts).where(eq(loginAttempts.identifier, identifier)).run();
}

export function createAdminSession(cookies: CookieJar, request: Request): AdminSession {
  const session = {
    id: randomToken(),
    csrfToken: randomToken(),
    userAgent: request.headers.get("user-agent"),
    expiresAt: expiresAt(sessionDays)
  };

  db.insert(adminSessions).values(session).run();
  cookies.set(adminSessionCookie, session.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(request),
    maxAge: sessionDays * 24 * 60 * 60
  });

  return db.select().from(adminSessions).where(eq(adminSessions.id, session.id)).get() as AdminSession;
}

export function getAdminSession(cookies: CookieJar): AdminSession | undefined {
  db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date().toISOString())).run();

  const cookie = cookies.get(adminSessionCookie);
  if (!cookie?.value) {
    return undefined;
  }

  return db.select().from(adminSessions).where(eq(adminSessions.id, cookie.value)).get();
}

export function destroyAdminSession(cookies: CookieJar): void {
  const cookie = cookies.get(adminSessionCookie);
  if (cookie?.value) {
    db.delete(adminSessions).where(eq(adminSessions.id, cookie.value)).run();
  }

  cookies.delete(adminSessionCookie, { path: "/" });
}

export function verifyAdminCsrf(cookies: CookieJar, formData: FormData): AdminSession | undefined {
  const session = getAdminSession(cookies);
  const token = formData.get("csrfToken");
  if (!session || typeof token !== "string" || token !== session.csrfToken) {
    return undefined;
  }

  return session;
}
