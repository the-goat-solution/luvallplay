"use client";

import { FormError } from "@/components/FormError";
import { Trans } from "@/components/Trans";
import { RequiredFieldLabel } from "@/components/forms/RequiredFieldLabel";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { useLanguage } from "@/context/LanguageContext";
import type { I18nKey } from "@/lib/i18n";
import type { ContactErrors } from "@/lib/validate-contact";

type ContactFieldKey = "firstName" | "lastName" | "email" | "phone" | "turnstileToken";

export function ContactDetailsForm({
  firstName,
  lastName,
  email,
  phone,
  errors,
  onFirstNameChange,
  onLastNameChange,
  onEmailChange,
  onPhoneChange,
  onTurnstileToken,
  onClearError,
  hintKey = "form_email_hint",
  showTurnstile = true,
  emailReadOnly = false,
}: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  errors: ContactErrors;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onTurnstileToken?: (token: string) => void;
  onClearError: (key: ContactFieldKey) => void;
  hintKey?: I18nKey;
  showTurnstile?: boolean;
  /** Signed-in players book under their account email. */
  emailReadOnly?: boolean;
}) {
  const { tr } = useLanguage();

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 18 }}>
        <Trans k={hintKey} />
      </p>
      <div className="form-row">
        <div className="form-group">
          <RequiredFieldLabel labelKey="form_fn" />
          <input
            className="form-input"
            value={firstName}
            required
            aria-invalid={Boolean(errors.firstName)}
            onChange={(e) => {
              onFirstNameChange(e.target.value);
              onClearError("firstName");
            }}
            placeholder={tr("form_fn_ph")}
          />
          <FormError messageKey={errors.firstName} />
        </div>
        <div className="form-group">
          <RequiredFieldLabel labelKey="form_ln" />
          <input
            className="form-input"
            value={lastName}
            required
            aria-invalid={Boolean(errors.lastName)}
            onChange={(e) => {
              onLastNameChange(e.target.value);
              onClearError("lastName");
            }}
            placeholder={tr("form_ln_ph")}
          />
          <FormError messageKey={errors.lastName} />
        </div>
      </div>
      <div className="form-group">
        <RequiredFieldLabel labelKey="form_email" />
        <input
          type="email"
          className="form-input"
          value={email}
          readOnly={emailReadOnly}
          autoComplete="email"
          required
          aria-invalid={Boolean(errors.email)}
          onChange={(e) => {
            onEmailChange(e.target.value);
            onClearError("email");
          }}
          placeholder={tr("form_email_ph")}
        />
        <FormError messageKey={errors.email} />
      </div>
      <div className="form-group">
        <RequiredFieldLabel labelKey="form_phone" />
        <input
          type="tel"
          className="form-input"
          value={phone}
          required
          aria-invalid={Boolean(errors.phone)}
          onChange={(e) => {
            onPhoneChange(e.target.value);
            onClearError("phone");
          }}
          placeholder={tr("form_phone_ph")}
        />
        <FormError messageKey={errors.phone} />
      </div>
      {showTurnstile && onTurnstileToken && (
        <>
          <TurnstileWidget
            onToken={(token) => {
              onTurnstileToken(token);
              onClearError("turnstileToken");
            }}
          />
          <FormError messageKey={errors.turnstileToken} />
        </>
      )}
    </>
  );
}
