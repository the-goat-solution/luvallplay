import { sendPlayerNoticeEmail } from "./player-email";
import type { ClubRole } from "./admin-roles";

// "An admin was added" emails (build plan §2.4): to the person, and to every
// owner, so a change nobody expected is noticed straight away. Admin emails
// are in English, like the rest of admin.

const ROLE_LABEL: Record<ClubRole, string> = { owner: "owner", admin: "admin", coach: "coach" };

export async function notifyRoleChange(input: {
  email: string;
  name: string | null;
  role: ClubRole | null;
  invited: boolean;
  by: string;
  ownerEmails: string[];
}): Promise<void> {
  const who = input.name || input.email;
  const what = input.role ? `${ROLE_LABEL[input.role]} of Three Wolves` : "no longer an admin of Three Wolves";
  const sends: Promise<void>[] = [];
  if (input.role) {
    sends.push(
      sendPlayerNoticeEmail({
        to: input.email,
        subject: `You're now ${ROLE_LABEL[input.role]} at Three Wolves`,
        heading: `You're now ${what}`,
        lines: [
          `${input.by} gave you ${ROLE_LABEL[input.role]} access to the Three Wolves admin area.`,
          input.invited
            ? "Sign in with this email address and you'll find a Club admin button on your profile."
            : "You'll find a Club admin button on your profile. Admin asks for a fresh sign-in code if you last signed in more than 12 hours ago.",
        ],
        cta: { label: "Open club admin", path: "/login?next=/admin" },
      }),
    );
  }
  for (const owner of input.ownerEmails) {
    if (owner.toLowerCase() === input.email.toLowerCase()) continue;
    sends.push(
      sendPlayerNoticeEmail({
        to: owner,
        subject: `Admin change: ${who} is now ${input.role ? ROLE_LABEL[input.role] : "removed"}`,
        heading: "Admin access changed",
        lines: [`${input.by} made ${who} ${what}.`, "If you didn't expect this, check Admin → People → Admins and the audit log there."],
        cta: { label: "Review admins", path: "/admin/people/admins" },
      }),
    );
  }
  const results = await Promise.allSettled(sends);
  for (const r of results) if (r.status === "rejected") console.error("[admin] role email failed:", r.reason);
}
