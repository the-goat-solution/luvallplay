"use client";

import { useState } from "react";
import type { MembershipDay } from "@/lib/constants";
import { CashMembershipStartDatePicker } from "@/components/admin/CashMembershipStartDatePicker";
import { membershipDays, weekdayName } from "@/lib/club-brand";

// The Day select and the start-date calendar need to interact live (picking
// another day should immediately refilter the calendar to that weekday), which
// a plain server-rendered <select> can't do on its own — this wraps both in
// one client component so the calendar always matches the current Day pick.
export function CashMemberDayAndDateFields() {
  const [day, setDay] = useState<MembershipDay>(membershipDays()[0]);

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
            {membershipDays().map((d) => (
              <option key={d} value={d}>
                {weekdayName(d)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12, maxWidth: 360 }}>
        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
          Start date (optional — leave blank to auto-assign the nearest
          {` ${weekdayName(day)}`} with room)
        </label>
        <CashMembershipStartDatePicker day={day} />
      </div>
    </div>
  );
}
