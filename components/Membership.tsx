"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/context/AppContext";
import { useLanguage } from "@/context/LanguageContext";
import { Trans } from "@/components/Trans";
import type { MembershipDay } from "@/lib/constants";
import {
  combinePlanId,
  resolveAllPlanDisplays,
  type CmsPricingPlan,
  type PlanDisplay,
} from "@/lib/pricing-plans";

type Cell = { kind: "check" } | { kind: "dash" } | { kind: "text"; text: string };

type ColumnKey = "casual" | "monthly" | "quarterly";

type Row = {
  label: string;
  casual: Cell;
  monthly: Cell;
  quarterly: Cell;
};

function CellValue({ cell }: { cell: Cell }) {
  if (cell.kind === "check") return <div className="price-feat-check">✓</div>;
  if (cell.kind === "dash") return <span className="tbl-dash">—</span>;
  return <span className="tbl-text">{cell.text}</span>;
}

export function Membership({
  pricingPlans,
}: {
  pricingPlans?: CmsPricingPlan[] | null;
}) {
  const { lang, tr } = useLanguage();
  const { openCasualModal, openMembershipModal } = useApp();
  const [day, setDay] = useState<MembershipDay>("friday");

  const displays = useMemo(
    () => resolveAllPlanDisplays(pricingPlans, lang, tr),
    [pricingPlans, lang, tr],
  );
  const byId = useMemo(
    () =>
      Object.fromEntries(displays.map((d) => [d.planId, d])) as Record<
        string,
        PlanDisplay
      >,
    [displays],
  );

  const casual = byId.casual;
  const monthly = byId[combinePlanId(day, "monthly")];
  const quarterly = byId[combinePlanId(day, "quarterly")];

  if (!casual || !monthly || !quarterly) return null;

  const dayLabel = tr(
    day === "friday" ? "mem_group_friday" : "mem_group_wednesday",
  );
  const dayCell: Cell = {
    kind: "text",
    text: tr("tbl_val_court_day", { day: dayLabel }),
  };

  const rows: Row[] = [
    {
      label: tr("tbl_row_court"),
      casual: { kind: "text", text: tr("tbl_val_court_any") },
      monthly: dayCell,
      quarterly: dayCell,
    },
    {
      label: tr("tbl_row_shuttle"),
      casual: { kind: "check" },
      monthly: { kind: "check" },
      quarterly: { kind: "check" },
    },
    {
      label: tr("tbl_row_racquet"),
      casual: { kind: "check" },
      monthly: { kind: "check" },
      quarterly: { kind: "check" },
    },
    {
      label: tr("tbl_row_community"),
      casual: { kind: "dash" },
      monthly: { kind: "check" },
      quarterly: { kind: "check" },
    },
    {
      label: tr("tbl_row_cancel"),
      casual: { kind: "dash" },
      monthly: { kind: "check" },
      quarterly: { kind: "dash" },
    },
    {
      label: tr("tbl_row_priority"),
      casual: { kind: "dash" },
      monthly: { kind: "dash" },
      quarterly: { kind: "check" },
    },
    {
      label: tr("tbl_row_save"),
      casual: { kind: "dash" },
      monthly: { kind: "dash" },
      quarterly: { kind: "check" },
    },
  ];

  const columns: {
    key: ColumnKey;
    display: PlanDisplay;
    headerName: string;
    onCta: () => void;
  }[] = [
    {
      key: "casual",
      display: casual,
      headerName: casual.name,
      onCta: openCasualModal,
    },
    {
      key: "monthly",
      display: monthly,
      headerName: tr("tbl_col_monthly"),
      onCta: () => openMembershipModal(monthly.planId),
    },
    {
      key: "quarterly",
      display: quarterly,
      headerName: tr("tbl_col_quarterly"),
      onCta: () => openMembershipModal(quarterly.planId),
    },
  ];

  return (
    <section
      className="section section-navy"
      id="membership"
      data-screen-label="Membership"
    >
      <div className="container">
        <div className="section-label section-label-light">
          <Trans k="mem_lbl" />
        </div>
        <h2 className="section-title section-title-white">
          <Trans k="mem_h" />
        </h2>
        <p className="section-sub section-sub-light">
          <Trans k="mem_sub" />
        </p>

        <div className="day-toggle" role="group" aria-label="Membership day">
          <button
            type="button"
            className={`day-toggle-btn${day === "friday" ? " active" : ""}`}
            aria-pressed={day === "friday"}
            onClick={() => setDay("friday")}
          >
            <Trans k="mem_group_friday" />
          </button>
          <button
            type="button"
            className={`day-toggle-btn${day === "wednesday" ? " active" : ""}`}
            aria-pressed={day === "wednesday"}
            onClick={() => setDay("wednesday")}
          >
            <Trans k="mem_group_wednesday" />
          </button>
        </div>

        <table className="pricing-table-desktop animate-in">
          <thead>
            <tr>
              <th className="pt-row-label" />
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={col.display.featured ? "pt-featured" : undefined}
                >
                  {col.display.featured && (
                    <div className="price-featured-tag">
                      <Trans k="p_popular" />
                    </div>
                  )}
                  <div className="price-name">{col.headerName}</div>
                  <p className="price-desc">{col.display.description}</p>
                  <div className="price-amount-row">
                    <span className="price-cur">NZD $</span>
                    <span className="price-amt">{col.display.priceNzd}</span>
                  </div>
                  <p className="price-period">{col.display.period}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="pt-row-label">
                  {row.label}
                </th>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.display.featured ? "pt-featured" : undefined}
                  >
                    <CellValue cell={row[col.key]} />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="pt-row-label" />
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={col.display.featured ? "pt-featured" : undefined}
                >
                  <button
                    type="button"
                    className={`btn btn-full ${col.display.featured ? "btn-primary" : "btn-outline-white"}`}
                    onClick={col.onCta}
                  >
                    <Trans k={col.display.ctaKey} />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <div className="pricing-cards-mobile">
          {columns.map((col) => (
            <div
              key={col.key}
              className={`pricing-mobile-card animate-in${col.display.featured ? " featured" : ""}`}
            >
              {col.display.featured && (
                <div className="price-featured-tag">
                  <Trans k="p_popular" />
                </div>
              )}
              <div className="price-name">{col.headerName}</div>
              <p className="price-desc">{col.display.description}</p>
              <div className="price-amount-row">
                <span className="price-cur">NZD $</span>
                <span className="price-amt">{col.display.priceNzd}</span>
              </div>
              <p className="price-period">{col.display.period}</p>
              <ul className="pricing-mobile-rows">
                {rows.map((row) => (
                  <li key={row.label}>
                    <span className="pmr-label">{row.label}</span>
                    <CellValue cell={row[col.key]} />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`btn btn-full ${col.display.featured ? "btn-primary" : "btn-outline-white"}`}
                onClick={col.onCta}
              >
                <Trans k={col.display.ctaKey} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
