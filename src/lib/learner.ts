import { randomBytes } from "node:crypto";
import type { CookieJar } from "./cookies";
import { secureCookie } from "./cookies";

export const learnerCookie = "semilla_learner_id";
const learnerCookieMaxAge = 365 * 24 * 60 * 60;
const learnerIdPattern = /^[A-Za-z0-9_-]{32,}$/;

function randomLearnerId(): string {
  return randomBytes(24).toString("base64url");
}

function isValidLearnerId(value: string): boolean {
  return learnerIdPattern.test(value);
}

export function getLearnerId(cookies: CookieJar): string | undefined {
  const value = cookies.get(learnerCookie)?.value;
  return value && isValidLearnerId(value) ? value : undefined;
}

export function ensureLearnerId(cookies: CookieJar, request: Request): string {
  const existing = getLearnerId(cookies);
  if (existing) {
    return existing;
  }

  const learnerId = randomLearnerId();
  cookies.set(learnerCookie, learnerId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(request),
    maxAge: learnerCookieMaxAge
  });

  return learnerId;
}
