"use client";

import { useState } from "react";
import type { MembershipDay } from "@/lib/constants";
import { CashMembershipStartDatePicker } from "@/components/admin/CashMembershipStartDatePicker";

// The Day select and the start-date calendar need to interact live (picking
// Wednesday should immediately refilter the calendar to Wednesdays), which
// a plain server-rendered <select> can't do on its own — this wraps both in
// one client component so the calendar always matches the current Day pick.
export function CashMemberDayAndDateFields() {
  const [day, setDay] = useState<MembershipDay>("friday");

  return (
    <div style={{ flexBasis: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666" }}>
            Day
          </label>
          <select
            name="day"
            value={day}
            onChange={(e) => setDay(e.target.value as MembershipDay)}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #ccc",
              fontSize: 13,
            }}
          >
            <option value="friday">Friday</option>
            <option value="wednesday">Wednesday</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12, maxWidth: 360 }}>
        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
          Start date (optional — leave blank to auto-assign the nearest
          {day === "wednesday" ? " Wednesday" : " Friday"} with room)
        </label>
        <CashMembershipStartDatePicker day={day} />
      </div>
    </div>
  );
}
