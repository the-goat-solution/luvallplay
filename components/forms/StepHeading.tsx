import { Trans } from "@/components/Trans";
import type { I18nKey } from "@/lib/i18n";

export function StepHeading({
  titleKey,
  required,
}: {
  titleKey: I18nKey;
  required?: boolean;
}) {
  return (
    <h4 className="modal-step-title">
      <Trans k={titleKey} />
      {required && (
        <span className="form-required" aria-hidden="true">
          {" "}
          *
        </span>
      )}
    </h4>
  );
}
