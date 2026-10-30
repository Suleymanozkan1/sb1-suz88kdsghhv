import { afterEach, describe, expect, it, vi } from "vitest";

// after() as Next provides it inside a request: the callback is kept for after the response
const scheduled: Array<() => unknown> = [];
let inRequest = true;
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    if (!inRequest) throw new Error("`after` was called outside a request scope");
    scheduled.push(task);
  },
}));

const { log } = await import("@/server/log");

describe("error webhook delivery (ARCH-04)", () => {
  const fetchMock = vi.fn(async () => new Response("ok"));
  const prevUrl = process.env.ERROR_WEBHOOK_URL;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevUrl === undefined) delete process.env.ERROR_WEBHOOK_URL;
    else process.env.ERROR_WEBHOOK_URL = prevUrl;
    scheduled.length = 0;
    fetchMock.mockClear();
  });

  it("inside a request the post is handed to after(), so the function stays alive until it is sent", async () => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.ERROR_WEBHOOK_URL = "https://hooks.test/x";
    inRequest = true;
    log.error("nightly: hotel failed", { hotelId: "h1", requestId: "r-123456789", error: "boom (after)" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ msg: "nightly: hotel failed", hotelId: "h1", requestId: "r-123456789" });
  });

  it("outside a request (scripts, background jobs) it is sent at once", () => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.ERROR_WEBHOOK_URL = "https://hooks.test/x";
    inRequest = false;
    log.error("export job failed", { error: "boom (direct)" });
    expect(scheduled).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
