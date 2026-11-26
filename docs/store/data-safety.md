# Data safety form: draft answers

For Play Console → App content → Data safety. Answers describe the Android app **as built on 26 Nov 2026** (`com.luvallplay.app`, permissions: `INTERNET`, plus the push-notification permission the plugin adds). The form must match what the app really collects (§4.5.1 step 5): re-check every row against the app and the server before submitting, and again whenever a feature ships.

## Overview questions

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by the app encrypted in transit? | **Yes** (HTTPS only) |
| Do you provide a way for users to request that their data be deleted? | **Yes**: in the app (Settings → delete account) **and** on a public web page. **OWNER CHECK:** the web page must be live; paste its URL in "Delete account URL". |
| Does the app follow the Families policy? | **No** for now (target audience 18+, see `content-rating.md`). Revisit when Juniors is switched on. |
| Independent security review | No |

## Data types

"Shared" below follows Google's definition: **not** counting a service provider processing on our behalf (Stripe for payments, Firebase for push, hosting and database providers), which Google exempts. Nothing is sold, and nothing is used for advertising or analytics across apps.

| Category → type | Collected | Shared | Required or optional | Why (purposes) |
|---|---|---|---|---|
| **Personal info → Name** | Yes | No | Required | App functionality, account management |
| **Personal info → Email address** | Yes | No | Required | App functionality (sign-in code, receipts, club messages), account management |
| **Personal info → Phone number** | Yes | No | Optional | App functionality, account management, club contact |
| **Personal info → User IDs** (account id) | Yes | No | Required | App functionality, account management |
| **Personal info → Other** (date of birth, if the club asks) | **OWNER CHECK**: answer Yes only if the player profile stores it; the Juniors design does | No | Optional | App functionality |
| **Financial info → Purchase history** (memberships, session fees, orders) | Yes | No | Required to buy | App functionality |
| **Financial info → Payment info** (card number etc.) | **No**: card details go to Stripe's secure form and never reach our servers | n/a | n/a | n/a |
| **Photos and videos → Photos** (profile photo, club gallery) | Yes | No | Optional | App functionality |
| **Photos and videos → Videos** | **No**: the Vision tracker analyses the camera or a chosen video **on the phone**; video is not uploaded | n/a | n/a | n/a |
| **Audio → Voice or sound recordings** | **No** (the tracker doesn't send audio anywhere) | n/a | n/a | n/a |
| **Messages → Other in-app messages** (club inbox, challenges) | Yes | No | Required to use messaging | App functionality |
| **App activity → App interactions** (bookings, challenges, match results, points) | Yes | No | Required | App functionality |
| **App activity → Other user-generated content** (match statistics saved from Vision) | Yes | No | Optional | App functionality |
| **Device or other IDs** (push device address) | Yes, **only if the person turns notifications on** | No | Optional | App functionality (notifications) |
| **App info and performance → Crash logs, Diagnostics** | **OWNER CHECK:** No today (no crash reporter is in the app). Plan §4.5 adds Sentry: answer **Yes** (not shared, purpose "Analytics"/"App functionality") in the same release that adds it. | | | |
| **Location** (approximate or precise) | **No** (the app has no location permission) | n/a | n/a | n/a |
| **Contacts, calendar, health, web history, files** | No | n/a | n/a | n/a |

## Notes for the form

- Optional "Help train the AI" sharing in the Vision tracker sends **the AI's learned numbers only, never video** (the in-app wording). If the numbers can't identify a person, no row is needed; **OWNER CHECK** with whoever built it before answering.
- The session token lives in the Android Keystore; backups are off (`allowBackup="false"`), so nothing is restored on another phone.
- The privacy policy (luvallplay.com) must say the same as this table. **OWNER CHECK:** read it against this sheet.
