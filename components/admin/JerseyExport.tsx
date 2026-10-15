"use client";

import { useState } from "react";
import { ExportButton } from "@/components/admin/finance/ExportButton";

export function JerseyExport() {
  const [filter, setFilter] = useState("all");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Which registrations to export"
        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
      >
        <option value="all">All registrations</option>
        <option value="paid">Paid only</option>
        <option value="unpaid">Unpaid only</option>
      </select>
      <ExportButton href={`/api/admin/jersey/export?filter=${filter}`}>Export to Excel</ExportButton>
    </div>
  );
}
