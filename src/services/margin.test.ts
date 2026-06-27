import { describe, it, expect } from "vitest";

// We test the charge-type classification logic inline
describe("Charge type classification", () => {
  const excludedTypes = new Set(["Tax", "Credit", "Refund"]);

  function isUsageChargeType(chargeType: string, excluded: Set<string>): boolean {
    if (excluded.has(chargeType)) return false;
    if (chargeType.toLowerCase().includes("discount")) return false;
    return true;
  }

  function isDiscountChargeType(chargeType: string): boolean {
    return chargeType.toLowerCase().includes("discount");
  }

  it("classifies Usage as usage charge type", () => {
    expect(isUsageChargeType("Usage", excludedTypes)).toBe(true);
  });

  it("classifies Fee as usage charge type", () => {
    expect(isUsageChargeType("Fee", excludedTypes)).toBe(true);
  });

  it("excludes Tax", () => {
    expect(isUsageChargeType("Tax", excludedTypes)).toBe(false);
  });

  it("excludes Credit", () => {
    expect(isUsageChargeType("Credit", excludedTypes)).toBe(false);
  });

  it("excludes Refund", () => {
    expect(isUsageChargeType("Refund", excludedTypes)).toBe(false);
  });

  it("excludes discount types from usage", () => {
    expect(isUsageChargeType("Enterprise Discount Program Discount", excludedTypes)).toBe(false);
    expect(isUsageChargeType("BundledDiscount", excludedTypes)).toBe(false);
  });

  it("identifies discount types", () => {
    expect(isDiscountChargeType("Enterprise Discount Program Discount")).toBe(true);
    expect(isDiscountChargeType("SPP Discount")).toBe(true);
    expect(isDiscountChargeType("BundledDiscount")).toBe(true);
  });

  it("does not classify Usage as discount", () => {
    expect(isDiscountChargeType("Usage")).toBe(false);
    expect(isDiscountChargeType("Tax")).toBe(false);
  });
});

describe("Margin computation logic", () => {
  it("computes discount % correctly", () => {
    const gross = 1000;
    const discount = 150; // absolute value
    const pct = (discount / gross) * 100;
    expect(pct).toBe(15);
  });

  it("handles zero gross (no division by zero)", () => {
    const gross = 0;
    const discount = 0;
    const pct = gross > 0 ? (discount / gross) * 100 : 0;
    expect(pct).toBe(0);
  });
});
