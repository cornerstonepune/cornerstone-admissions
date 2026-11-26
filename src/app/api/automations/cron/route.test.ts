// #69 · The cron that sends follow-ups answers only to its secret: no secret configured is 503, a wrong or missing one 401,
// and nothing runs; the right one runs the follow-ups along with wacrm's automations.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ followUps: vi.fn(), expire: vi.fn() }));

vi.mock("@/admissions/lib/follow-ups", () => ({ runFollowUps: h.followUps }));
vi.mock("@/lib/automations/engine", () => ({
  expireAwaitingReplies: h.expire,
  requeueStalledExecutions: async () => 0,
  claimPendingExecution: async () => false,
  resumePendingExecution: async () => {},
}));
vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => {
    const b: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq", "lte", "order"]) b[m] = () => b;
    b.limit = async () => ({ data: [], error: null });
    return b;
  },
}));

import { GET } from "./route";

const call = (secret?: string) =>
  GET(new Request("http://localhost/api/automations/cron", { headers: secret ? { "x-cron-secret": secret } : {} }));

beforeEach(() => {
  vi.stubEnv("AUTOMATION_CRON_SECRET", "s3cret-value");
  h.followUps.mockResolvedValue({ sent: 2, failed: 0 });
  h.expire.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/automations/cron", () => {
  it("is 503 when no secret is configured", async () => {
    vi.stubEnv("AUTOMATION_CRON_SECRET", "");
    expect((await call("anything")).status).toBe(503);
    expect(h.followUps).not.toHaveBeenCalled();
  });

  it("is 401 without the secret or with a wrong one, and sends nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("s3cret-valuX")).status).toBe(401);
    expect((await call("short")).status).toBe(401);
    expect(h.followUps).not.toHaveBeenCalled();
  });

  it("runs the follow-ups with the right secret", async () => {
    const res = await call("s3cret-value");
    expect(res.status).toBe(200);
    expect(h.followUps).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ processed: 0, followUps: { sent: 2, failed: 0 } });
  });
});
