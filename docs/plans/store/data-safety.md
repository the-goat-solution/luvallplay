# Data safety and App Privacy with Social on (lane S)

What Social adds to **Play Console → App content → Data safety** and to **App Store Connect → App Privacy**. The sheet for everything the app already collects is lane N's [`docs/store/data-safety.md`](../../store/data-safety.md) (the Android app as built on 26 Nov 2026). This file does not repeat it: it lists the rows Social adds or widens. **The two must be submitted as one form**, so lane N's sheet is updated in the same release that puts Social in the build (a `[lane N]` change).

Written 27 Nov 2026 from the Social plan and the code built so far (migrations `0022`–`0024`, `apps/web/lib/social`, `apps/web/lib/moderation`). Re-check each row against the build before submitting.

## The short answer

Social adds **user content: posts, photos and comments**. It is **linked to the account**, **not used for tracking**, **not shared** with anyone but our own service providers, and used for **app functionality** only. Nothing is sold; there are no ads and no advertising id.

## What Social stores

| Data | Where | Who sees it | Deleted with the account? |
|---|---|---|---|
| Display name (chosen by the person, 1–40 characters), bio (≤160), a random public id, who may see the profile | `social_profiles` | Members of a shared club, or followers too if the person chose "Everyone" | Yes |
| "I am 18 or older" and the rules version accepted, each with its time | `social_profiles` | Nobody; kept as the record of consent | Yes |
| Posts (≤500 characters), and automatic posts for a confirmed match or a rank-up | `social_posts` | As the profile | Yes |
| Post photos | `player_photos` with `purpose = 'social'`, the file in our photo store | With the post, once the image check has approved it | Yes, the file too |
| Comments (≤300) and kudos | `social_comments`, `social_kudos` | Whoever can see the post | Yes |
| Follows | `social_follows` | Counts on a profile | Yes, both ways |
| Blocks | `user_blocks` | Only the person who blocked | Yes, both ways |
| A club switching a person off in its space | `social_club_bans` | That club's admins | Yes (the row about them; a ban they made as an admin stays, without their id) |
| Reports a person files: the reason, and optional details (≤1,000) | `content_reports`; the details are stored only sealed (`MODERATION_KEKS`) | Moderators | The report stays with no reporter and no details |
| What a moderator did | `moderation_actions` (ids and a short reason, never the content) | Platform moderators | **Kept** |
| A suspension, with keyed fingerprints of the email and phone (not the values) | `player_suspensions` | Platform moderators | **Kept**, so signing up again stays suspended |
| For a child-safety report only: a sealed copy of the reported words and the author's account id | `moderation_evidence` | Opened only by a platform moderator | **Kept** |

Not collected by Social: location, contacts, private messages (there are none), a profile photo (initials only), a date of birth (the 18+ answer is a yes, not a date).

## Google Play: Data safety rows

Add or widen these in lane N's table. "Shared" uses Google's definition, which leaves out service providers working for us.

| Category → type | Collected | Shared | Required or optional | Purposes | Note |
|---|---|---|---|---|---|
| **App activity → Other user-generated content** | Yes | No | Optional (only if the person joins Social) | App functionality | **Widen** the existing row: posts, comments, kudos, bio, reports. Lane N's row covers match statistics from Vision |
| **Photos and videos → Photos** | Yes | No | Optional | App functionality | **Widen**: add "photos attached to posts". Videos stay No |
| **Personal info → Name** | Yes | No | Optional | App functionality | Add "a display name chosen for Social". Real names are not shown in Social |
| **Personal info → User IDs** | Yes | No | Required | App functionality, account management | Add "a random public id for the social profile" |
| **App activity → App interactions** | Yes | No | Optional | App functionality | Add "follows, kudos, blocks" |
| **Personal info → Other info** (the 18+ confirmation) | **To confirm with lane N**: a yes with a time is not an age or a birth date. If Play's reviewer reads it as "other personal info", declare it: collected, not shared, required to join Social, app functionality | | | | |
| **Messages → Other in-app messages** | Unchanged | | | | Social has no messages. Comments are public to whoever sees the post and are declared as user-generated content |

Overview questions: unchanged. Deletion: the in-app delete and the public web page also remove Social data (the "Deleted with the account?" column above is what the page must say). **To confirm with lane N:** that the public deletion page's text lists the three things kept (the moderation record, a suspension, child-safety evidence) and why.

## Apple: App Privacy labels

| Data type | Collected | Linked to the user | Used for tracking | Purposes |
|---|---|---|---|---|
| **User Content → Photos or Videos** | Yes (post photos) | Yes | No | App Functionality |
| **User Content → Other User Content** (posts, comments, bio, reports) | Yes | Yes | No | App Functionality |
| **Contact Info → Name** (the display name) | Yes | Yes | No | App Functionality |
| **Identifiers → User ID** (the public id) | Yes | Yes | No | App Functionality |
| **Usage Data → Product Interaction** (follows, kudos) | **To confirm with lane N** how the existing bookings and match rows are declared; declare these the same way | Yes | No | App Functionality |

"Data Used to Track You": **none**. No App Tracking Transparency prompt.

**The privacy manifest** (`PrivacyInfo.xcprivacy`) does not exist yet: `apps/native` has no `ios/` project. When lane N adds it, the collected-data list gains `NSPrivacyCollectedDataTypePhotosorVideos` and `NSPrivacyCollectedDataTypeOtherUserContent`, each linked, not tracking, purpose `NSPrivacyCollectedDataTypePurposeAppFunctionality`. **To confirm with lane N** when the file is written.

## Service providers that touch Social data

| Provider | What it gets | Declared as shared? |
|---|---|---|
| The database and hosting providers | Everything above | No (service provider) |
| The photo store | Post photo files | No (service provider) |
| Google Cloud Vision SafeSearch (`lib/photo-moderation.ts`), when `GOOGLE_VISION_ENABLED=1` | Each post photo, for the automated check | No (service provider). **To confirm with lane H**: that the privacy policy names it, and that Google's terms for the Vision API keep it a processor |
| The email sender | An alert to the platform moderators: a reason and a link, never the content | No |

## The privacy policy must say the same

The app's privacy policy isn't published yet (the website's notice covers the website only and says the apps' policy comes before clubs go live). When it is written it needs, for Social: what the table "What Social stores" lists; that a display name and posts are seen by other players; the image check and its provider; that reports are confidential and their details sealed; what is kept after deletion and why; the safety contact (`SAFETY_CONTACT_EMAIL`). **To confirm with the owner and counsel.**

## To confirm

- **Lane N:** the rows marked above; that `docs/store/data-safety.md` gains these lines in the Social release; the privacy manifest.
- **Lane H:** the Vision SafeSearch line.
- **Before submitting:** Tasks 4–8 of the Social plan were not finished when this was written. Check the tables and the delete path (`forgetSocial`, Task 6) against this sheet once they are.
