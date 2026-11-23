import type { ReactNode } from "react";
import { AdminLink } from "@/components/admin/AdminLink";
import k from "./kit.module.css";

// Admin UI kit (build plan §2.5): the building blocks of the admin pages, so
// new pages stop growing inline style objects. Server components except
// ConfirmButton (components/admin/kit/ConfirmButton.tsx).

export { ConfirmButton } from "./ConfirmButton";
export const kit = k;

export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** The page's main controls, top right (wraps under the title on phones). */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={k.header}>
      <div className={k.headerRow}>
        <h1 className={k.title}>{title}</h1>
        {actions && <div className={k.headerActions}>{actions}</div>}
      </div>
      {subtitle && <p className={k.subtitle}>{subtitle}</p>}
      {children}
    </header>
  );
}

export function Section({ title, children, id }: { title?: string; children: ReactNode; id?: string }) {
  return (
    <section className={k.section} aria-labelledby={title && id ? `${id}-title` : undefined} id={id}>
      {title && (
        <h2 className={k.sectionTitle} id={id ? `${id}-title` : undefined}>
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={k.toolbar}>{children}</div>;
}

export type BadgeTone = "default" | "owner" | "good" | "warn" | "bad";
const TONE: Record<BadgeTone, string> = { default: "", owner: k.badgeOwner, good: k.badgeGood, warn: k.badgeWarn, bad: k.badgeBad };

export function Badge({ tone = "default", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`${k.badge} ${TONE[tone]}`}>{children}</span>;
}

/** Small red count next to a tab label (unread, to review). */
export function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className={k.count} aria-label={`${n} new`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={k.empty}>{children}</p>;
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "error"; children: ReactNode }) {
  return (
    <p className={tone === "error" ? k.errorNote : k.notice} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export type Column<Row> = { key: string; label: string; render: (row: Row) => ReactNode };

/** A table on wide screens; each row becomes a labelled card on phones. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  empty?: ReactNode;
  caption?: string;
}) {
  if (rows.length === 0 && empty) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className={k.tableWrap}>
      <table className={k.table}>
        {caption && <caption className={k.srOnly}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A labelled number, e.g. "Spots left 4 of 12". */
export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "bad" | "good" }) {
  const toneClass = tone === "bad" ? k.statBad : tone === "warn" ? k.statWarn : tone === "good" ? k.statGood : "";
  return (
    <div className={`${k.stat} ${toneClass}`}>
      <div className={k.statLabel}>{label}</div>
      <div className={k.statValue}>{value}</div>
      {hint && <div className={k.statHint}>{hint}</div>}
    </div>
  );
}

/** A row of StatTiles that wraps to two columns on phones. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className={k.statGrid}>{children}</div>;
}

export type TabItem = { key: string; label: string; href: string; count?: number };

/** Page tabs that are links (?tab=…), so every tab has its own URL. */
export function Tabs({ items, current, label }: { items: TabItem[]; current: string; label: string }) {
  return (
    <nav className={k.tabs} aria-label={label}>
      {items.map((t) => (
        <AdminLink key={t.key} href={t.href} current={t.key === current} scroll={false} className={`${k.tab} ${t.key === current ? k.tabActive : ""}`}>
          {t.label}
          {t.count !== undefined && <span className={k.tabCount}>{t.count}</span>}
        </AdminLink>
      ))}
    </nav>
  );
}

/** A collapsed "ⓘ" explanation, for rules most people only need once. */
export function InfoDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className={k.info}>
      <summary>{summary}</summary>
      <div className={k.infoBody}>{children}</div>
    </details>
  );
}

/** A form that opens in place from a button (no JavaScript needed). */
export function FormPanel({
  summary,
  title,
  children,
  id,
  defaultOpen,
}: {
  summary: string;
  title: string;
  children: ReactNode;
  id?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className={k.panel} id={id} open={defaultOpen}>
      <summary className={k.btn}>{summary}</summary>
      <div className={k.panelBody}>
        <h3 className={k.panelTitle}>{title}</h3>
        {children}
      </div>
    </details>
  );
}
