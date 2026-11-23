# Admin kit

The building blocks of every club admin page (`app/admin/(console)/**`).
Use these instead of inline styles, so every page looks and behaves the same.

- **Frame:** `components/admin/shell/AdminShell.tsx` (sidebar, phone menu, toasts) via `app/admin/(console)/layout.tsx`.
- **Menu:** `components/admin/nav-config.ts`. Add, rename or hide a page there.
- **Badges / Today page counts:** `lib/admin-attention.ts`.

| Piece | Use it for |
|---|---|
| `PageHeader` | Title (= the menu label), one-sentence subtitle, main `actions` top right |
| `Tabs` | Parts of a page, each with its own `?tab=` URL (actions redirect back to their tab) |
| `Section` | A titled card |
| `StatGrid` + `StatTile` | A few key numbers |
| `FormPanel` | An "＋ Add …" form that opens in place |
| `InfoDisclosure` | Rules and background most people only need once |
| `Badge` | Statuses, in plain words, with a tone |
| `Notice` | A warning or error on the page |
| `EmptyState` | An empty list, saying what to do next |
| `kit.table` (+ `data-label` on each `td`) | Tables that turn into cards on phones |
| `kit.btn` / `btnSecondary` / `btnDanger` | Buttons and button-looking links |
| `SubmitButton` with `confirmMessage` | Any action that changes or removes something |

## The rules every page follows

1. The page title is the menu label. Under it, one plain sentence on what the page is for.
2. The main action sits top right in the header. "Add …" forms open in place (`FormPanel`), not at the bottom of the page.
3. Daily work comes first. Set-up and rare tools go in a later tab or an "Advanced" disclosure.
4. Every action that removes, cancels, refunds or emails asks first, and says exactly what will happen.
5. Human words only: no env var names, file paths, raw status codes or ISO dates. Developer details live on System check.
6. Feedback comes back as a toast (`?toast=` / `?toastError=`, read once by the frame). Errors on the page use `Notice`; empty lists use `EmptyState`.
7. Everything works one-handed on a phone: 44px tap targets, tables become cards, nothing scrolls sideways.
