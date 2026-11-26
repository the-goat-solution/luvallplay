# Decisions: personal data leaving the Vietnam region

Build plan §6.9: **anything that sends personal data out of the Vietnam region needs a written decision** (who, what, why, and counsel's view).

Each decision is one file in this folder, named `NNNN-service.md`, and the service's entry in the regional services matrix (`packages/core/src/regional-services.ts`) points to it. CI refuses a service that is approved for the Vietnam region, receives personal data outside it, and has no decision file with all the headings below (`apps/web/tests/regional-services.test.ts`).

There are no decisions yet. Until there is one for a service, that service is blocked for the Vietnam region.

## Template

Copy this into a new file and fill in every section.

```markdown
# NNNN: <service> may receive <what> from the Vietnam region

## Who
Who decided, their role, and the date.

## What
The service, the personal data it receives, whose data it is, and where it is processed and stored.

## Why
Why this service is needed, and why an in-region alternative isn't used.

## Counsel's view
What Vietnamese counsel said, who said it, the date, and any conditions (consent wording, transfer assessment filed, retention).

## Review
When this decision is looked at again.
```
