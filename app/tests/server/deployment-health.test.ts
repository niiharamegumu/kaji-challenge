import { afterEach, expect, it, vi } from "vitest";
import { verifyDeploymentHealth } from "../../scripts/check-deployment";

afterEach(() => vi.unstubAllGlobals());

it("waits through propagation until the expected release responds", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("unreachable"))
    .mockResolvedValueOnce(Response.json({ status: "ok", release: "old" }))
    .mockResolvedValueOnce(Response.json({ status: "ok", release: "new" }));
  vi.stubGlobal("fetch", request);
  await verifyDeploymentHealth("https://kaji.example.com", "new", { attempts: 3, delayMs: 0 });
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[0][0].href).toBe("https://kaji.example.com/health");
  expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
});

it.each([
  () => Response.json({ status: "ok", release: "old" }),
  () => Response.json({ status: "error", release: "new" }),
  () => Response.json({ status: "ok", release: "new" }, { status: 503 }),
  () => new Response("<html>not JSON</html>"),
])(
  "fails after bounded retries instead of accepting a stale or unhealthy release",
  async (reply) => {
    const request = vi.fn(async () => reply());
    vi.stubGlobal("fetch", request);
    await expect(
      verifyDeploymentHealth("https://kaji.example.com", "new", { attempts: 2, delayMs: 0 }),
    ).rejects.toThrow("expected release");
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it.each([
  ["http://localhost:5174", "new"],
  ["https://kaji.example.com/path", "new"],
  ["https://kaji.example.com", ""],
])("rejects invalid settings before making requests", async (origin, release) => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(verifyDeploymentHealth(origin, release)).rejects.toThrow("Invalid production");
  expect(request).not.toHaveBeenCalled();
});
