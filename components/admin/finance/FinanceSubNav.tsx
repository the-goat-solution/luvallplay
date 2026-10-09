import styles from "./financials.module.css";

const LINKS = [
  { key: "ledger", href: "/admin/financials", label: "Ledger" },
  { key: "bank", href: "/admin/financials/bank", label: "Bank & reconciliation" },
  { key: "report", href: "/admin/financials/report", label: "Annual report" },
] as const;

export function FinanceSubNav({ active }: { active: (typeof LINKS)[number]["key"] }) {
  return (
    <nav className={styles.subNav} aria-label="Financials sections">
      {LINKS.map((l) => (
        <a
          key={l.key}
          href={l.href}
          className={`${styles.subNavLink} ${l.key === active ? styles.subNavActive : ""}`}
          aria-current={l.key === active ? "page" : undefined}
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
