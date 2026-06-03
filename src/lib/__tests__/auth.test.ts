import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import {
  createSession,
  getSession,
  deleteSession,
  verifySession,
} from "@/lib/auth";

const JWT_SECRET = new TextEncoder().encode("development-secret-key");
const COOKIE_NAME = "auth-token";

async function makeToken(
  payload: object,
  expiresIn = "7d"
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

function makeRequest(token?: string): NextRequest {
  const req = new NextRequest("http://localhost/");
  if (token) {
    req.cookies.set(COOKIE_NAME, token);
  }
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSession", () => {
  test("sets an httpOnly cookie with a JWT token", async () => {
    await createSession("user-1", "test@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [name, , options] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe(COOKIE_NAME);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.secure).toBe(false);
  });

  test("cookie expires approximately 7 days from now", async () => {
    const before = Date.now();
    await createSession("user-1", "test@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const expiresMs = (options.expires as Date).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDays - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + sevenDays + 1000);
  });

  test("token encodes userId and email", async () => {
    await createSession("user-42", "hello@example.com");

    const [, token] = mockCookieStore.set.mock.calls[0];
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, JWT_SECRET);

    expect(payload.userId).toBe("user-42");
    expect(payload.email).toBe("hello@example.com");
  });
});

describe("getSession", () => {
  test("returns null when cookie is absent", async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    const token = await makeToken({
      userId: "user-1",
      email: "test@example.com",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-1");
    expect(session?.email).toBe("test@example.com");
  });

  test("returns null for a tampered token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "not.a.valid.token" });

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns null for an expired token", async () => {
    const token = await makeToken(
      { userId: "user-1", email: "test@example.com" },
      "1ms"
    );
    await new Promise((r) => setTimeout(r, 10));
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).toBeNull();
  });
});

describe("deleteSession", () => {
  test("deletes the auth cookie", async () => {
    await deleteSession();

    expect(mockCookieStore.delete).toHaveBeenCalledOnce();
    expect(mockCookieStore.delete).toHaveBeenCalledWith(COOKIE_NAME);
  });
});

describe("verifySession", () => {
  test("returns null when cookie is absent from request", async () => {
    const req = makeRequest();
    const session = await verifySession(req);
    expect(session).toBeNull();
  });

  test("returns session payload for a valid token in request", async () => {
    const token = await makeToken({
      userId: "user-2",
      email: "user2@example.com",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const req = makeRequest(token);

    const session = await verifySession(req);
    expect(session).not.toBeNull();
    expect(session?.userId).toBe("user-2");
    expect(session?.email).toBe("user2@example.com");
  });

  test("returns null for an invalid token in request", async () => {
    const req = makeRequest("garbage.token.value");
    const session = await verifySession(req);
    expect(session).toBeNull();
  });

  test("returns null for an expired token in request", async () => {
    const token = await makeToken(
      { userId: "user-1", email: "test@example.com" },
      "1ms"
    );
    await new Promise((r) => setTimeout(r, 10));
    const req = makeRequest(token);

    const session = await verifySession(req);
    expect(session).toBeNull();
  });
});
