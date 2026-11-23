import type { ReactNode } from "react";
import k from "./kit.module.css";

// Admin UI kit (build plan §2.5): the building blocks of the admin pages, so
// new pages stop growing inline style objects. Server components except
// ConfirmButton (components/admin/kit/ConfirmButton.tsx).

export { ConfirmButton } from "./ConfirmButton";
export const kit = k;

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className={k.header}>
      <h1 className={k.title}>{title}</h1>
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
