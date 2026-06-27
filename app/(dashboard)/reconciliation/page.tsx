"use client";

import { useState } from "react";

interface Attribution {
  accountId: string;
  relationship: { transferId: string; status: string; isActive: boolean } | null;
  directory: { partnerName?: string; customerName?: string; role: string } | null;
  anomaly?: string;
}

interface AttributedInvoice {
  invoiceId: string;
  accountId: string;
  billSourceAccounts: string[];
  attributions: Attribution[];
}

export default function ReconciliationPage() {
  const [accountId, setAccountId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [data, setData] = useState<AttributedInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReconciliation() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reconciliation?accountId=${accountId}&year=${year}&month=${month}`,
      );
      if (!res.ok) throw new Error((await res.json()).error);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reconciliation</h1>

      {/* Filters */}
      <div className="flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">PMA Account ID</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="123456789012"
            className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="mt-1 w-24 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Month</label>
          <input
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="mt-1 w-20 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={loadReconciliation}
          disabled={loading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Results table */}
      {data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Bill Source</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Partner</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.map((inv) =>
                inv.attributions.map((attr, idx) => (
                  <tr key={`${inv.invoiceId}-${idx}`}>
                    <td className="px-4 py-2 font-mono text-xs">
                      {inv.invoiceId.startsWith("ANOMALY") ? "—" : inv.invoiceId}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{attr.accountId}</td>
                    <td className="px-4 py-2">{attr.directory?.partnerName ?? "—"}</td>
                    <td className="px-4 py-2">{attr.directory?.customerName ?? "—"}</td>
                    <td className="px-4 py-2">
                      {attr.relationship ? (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            attr.relationship.isActive
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {attr.relationship.isActive ? "Active" : attr.relationship.status}
                        </span>
                      ) : (
                        <span className="text-gray-400">No relationship</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {attr.anomaly && (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          ⚠ {attr.anomaly}
                        </span>
                      )}
                      {!attr.directory && (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Needs mapping
                        </span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
