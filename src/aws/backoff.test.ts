import { describe, it, expect, vi } from "vitest";
import { withBackoff } from "./backoff";

describe("withBackoff", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on throttling (429)", async () => {
    const error = Object.assign(new Error("Throttled"), {
      $metadata: { httpStatusCode: 429 },
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const result = await withBackoff(fn, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 errors", async () => {
    const error = Object.assign(new Error("Server error"), {
      $metadata: { httpStatusCode: 500 },
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("recovered");

    const result = await withBackoff(fn, { baseDelayMs: 1 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const error = Object.assign(new Error("Bad request"), {
      $metadata: { httpStatusCode: 400 },
    });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withBackoff(fn, { baseDelayMs: 1 })).rejects.toThrow("Bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries", async () => {
    const error = Object.assign(new Error("Throttled"), {
      name: "ThrottlingException",
    });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withBackoff(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow("Throttled");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
