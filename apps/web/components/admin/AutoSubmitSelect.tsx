"use client";

import type { ReactNode } from "react";

// A <select> that submits its form as soon as the choice changes, so a
// filter needs no separate "Show" button. Works inside a plain GET form.
export function AutoSubmitSelect({
  name,
  defaultValue,
  className,
  id,
  children,
}: {
  name: string;
  defaultValue: string;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue} className={className} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {children}
    </select>
  );
}
