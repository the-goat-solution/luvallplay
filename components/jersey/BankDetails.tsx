import { BANK_ACCOUNT_NAME, BANK_ACCOUNT_NUMBER } from "@/lib/jersey";
import { CopyButton } from "./CopyButton";

export function BankDetails({ refCode }: { refCode?: string }) {
  return (
    <dl className="jersey-bank">
      <div>
        <dt>Account name</dt>
        <dd>{BANK_ACCOUNT_NAME}</dd>
      </div>
      <div>
        <dt>Account number</dt>
        <dd>
          <span>{BANK_ACCOUNT_NUMBER}</span>
          <CopyButton text={BANK_ACCOUNT_NUMBER} />
        </dd>
      </div>
      {refCode ? (
        <div>
          <dt>Reference</dt>
          <dd>
            <span style={{ fontWeight: 800, letterSpacing: ".15em" }}>{refCode}</span>
            <CopyButton text={refCode} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
