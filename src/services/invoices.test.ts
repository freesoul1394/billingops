import { describe, it, expect } from "vitest";
import { validateBillingPeriod } from "./invoices";

describe("validateBillingPeriod", () => {
  it("throws for dates before June 2025", () => {
    expect(() => validateBillingPeriod(2025, 5)).toThrow("not available before June 2025");
    expect(() => validateBillingPeriod(2024, 12)).toThrow("not available before June 2025");
    expect(() => validateBillingPeriod(2020, 1)).toThrow("not available before June 2025");
  });

  it("allows June 2025 and later", () => {
    expect(() => validateBillingPeriod(2025, 6)).not.toThrow();
    expect(() => validateBillingPeriod(2025, 12)).not.toThrow();
    expect(() => validateBillingPeriod(2026, 1)).not.toThrow();
  });
});
