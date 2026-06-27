import { describe, it, expect } from "vitest";
import { isActiveBilling } from "./relationships";

describe("isActiveBilling", () => {
  const pastDate = new Date("2025-01-01");
  const futureDate = new Date("2099-12-31");
  const now = new Date();

  it("returns true for ACTIVE status with start in past and no end", () => {
    expect(isActiveBilling({ status: "ACTIVE", startTs: pastDate, endTs: null })).toBe(true);
  });

  it("returns true for ACCEPTED status with start in past and end in future", () => {
    expect(
      isActiveBilling({ status: "ACCEPTED", startTs: pastDate, endTs: futureDate }),
    ).toBe(true);
  });

  it("returns false for WITHDRAWN status", () => {
    expect(isActiveBilling({ status: "WITHDRAWN", startTs: pastDate, endTs: null })).toBe(false);
  });

  it("returns false if start is in the future", () => {
    expect(isActiveBilling({ status: "ACTIVE", startTs: futureDate, endTs: null })).toBe(false);
  });

  it("returns false if end is in the past", () => {
    expect(isActiveBilling({ status: "ACTIVE", startTs: pastDate, endTs: pastDate })).toBe(false);
  });

  it("returns false if startTs is null/undefined", () => {
    expect(isActiveBilling({ status: "ACTIVE", startTs: null, endTs: null })).toBe(false);
  });

  it("is case-insensitive on status", () => {
    expect(isActiveBilling({ status: "active", startTs: pastDate, endTs: null })).toBe(true);
  });
});
