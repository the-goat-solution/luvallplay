// "Paid by" select for the admin "Add offline payment" forms (play-day
// player, member). Posts `method` = "cash" | "bank_transfer"; see
// lib/offline-payment.ts.
export function OfflinePaymentMethodField() {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, color: "#666" }}>Paid by</label>
      <select
        name="method"
        defaultValue="cash"
        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
      >
        <option value="cash">Cash</option>
        <option value="bank_transfer">Bank transfer</option>
      </select>
    </div>
  );
}
