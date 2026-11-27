"use client";

// "Paid by" select for the admin "Add offline payment" forms (play-day
// player, member). Posts `method` = "cash" | "bank_transfer"; see
// lib/offline-payment.ts.
import { useAdminText } from "@/components/admin/AdminLang";

export function OfflinePaymentMethodField() {
  const { t } = useAdminText();
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, color: "#666" }}>{t("play_paid_by")}</label>
      <select
        name="method"
        defaultValue="cash"
        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
      >
        <option value="cash">{t("play_method_cash")}</option>
        <option value="bank_transfer">{t("play_method_bank_transfer")}</option>
      </select>
    </div>
  );
}
