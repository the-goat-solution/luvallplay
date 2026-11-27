"use client";

import { useState } from "react";
import type { MembershipDay } from "@/lib/constants";
import { CashMembershipStartDatePicker } from "@/components/admin/CashMembershipStartDatePicker";
import { membershipDays } from "@/lib/club-brand";
import { useAdminText } from "@/components/admin/AdminLang";
import type { AdminKey } from "@luvallplay/i18n/admin";

// The Day select and the start-date calendar need to interact live (picking
// another day should immediately refilter the calendar to that weekday), which
// a plain server-rendered <select> can't do on its own — this wraps both in
// one client component so the calendar always matches the current Day pick.
export function CashMemberDayAndDateFields() {
  const { t } = useAdminText();
  const dayName = (d: string) => t(`weekday_${d}` as AdminKey);
  const [day, setDay] = useState<MembershipDay>(membershipDays()[0]);

  return (
    <div style={{ flexBasis: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#666" }}>
            {t("mem_day_label")}
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
                {dayName(d)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12, maxWidth: 360 }}>
        <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>
          {t("mem_start_date", { day: dayName(day) })}
        </label>
        <CashMembershipStartDatePicker day={day} />
      </div>
    </div>
  );
}
