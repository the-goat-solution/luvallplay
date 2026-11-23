import { Trans } from "@/components/Trans";
import type { I18nKey } from "@/lib/i18n";

export function RequiredFieldLabel({ labelKey }: { labelKey: I18nKey }) {
  return (
    <label className="form-label">
      <Trans k={labelKey} />
      <span className="form-required" aria-hidden="true">
        {" "}
        *
      </span>
    </label>
  );
}
