import { describe, it, expect, vi } from "vitest";
import { paginateAll } from "./paginator";

// Mock withBackoff to not actually delay
vi.mock("./backoff", () => ({
  withBackoff: (fn: () => Promise<unknown>) => fn(),
}));

describe("paginateAll", () => {
  it("collects items from multiple pages", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: ["a", "b"], NextToken: "tok1" })
      .mockResolvedValueOnce({ Items: ["c"], NextToken: undefined });

    const items = await paginateAll<string>({
      send,
      input: {},
      getItems: (output) => output.Items,
    });

    expect(items).toEqual(["a", "b", "c"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does NOT stop on empty pages with NextToken (critical AWS behavior)", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: ["a"], NextToken: "tok1" })
      .mockResolvedValueOnce({ Items: [], NextToken: "tok2" }) // empty page!
      .mockResolvedValueOnce({ Items: ["b"], NextToken: undefined });

    const items = await paginateAll<string>({
      send,
      input: {},
      getItems: (output) => output.Items,
    });

    expect(items).toEqual(["a", "b"]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("handles undefined items gracefully", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: undefined, NextToken: "tok1" })
      .mockResolvedValueOnce({ Items: ["x"], NextToken: undefined });

    const items = await paginateAll<string>({
      send,
      input: {},
      getItems: (output) => output.Items,
    });

    expect(items).toEqual(["x"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("passes NextToken correctly between pages", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: ["a"], NextToken: "page2" })
      .mockResolvedValueOnce({ Items: ["b"], NextToken: undefined });

    await paginateAll<string>({
      send,
      input: { MaxResults: 10 },
      getItems: (output) => output.Items,
    });

    expect(send).toHaveBeenCalledWith({ MaxResults: 10, NextToken: undefined });
    expect(send).toHaveBeenCalledWith({ MaxResults: 10, NextToken: "page2" });
  });
});
