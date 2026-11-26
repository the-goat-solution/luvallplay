// The Family section's data: the guardian's own children in the club shown,
// adding one, correcting one, and what the guardian allows for each.
//
// Asked for only when the club's modules list Juniors. The server decides
// again on every request (it fails closed), so a stale list can't show a
// child's data: the answer is then 404 and the section says it is off.
// A child's data is never kept on the device: "family" is not among the
// saved screens (lib/offline.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BodyOf, ResponseOf } from "@luvallplay/api/contract";
import { apiForClub } from "../../app.ts";
import { useCurrentClub, useWho } from "../../hooks.tsx";

export type Family = ResponseOf<"family.list">;
export type Child = Family["children"][number];
export type Consent = Child["consent"];
export const CONSENT_ITEMS = ["leaderboard", "photos", "vision"] as const;

export function useFamilyOn(): boolean {
  const { config } = useCurrentClub();
  return !!config && config.modules.includes("juniors");
}

function useClubApi() {
  const who = useWho();
  const { current, slug } = useCurrentClub();
  const on = useFamilyOn();
  return { who, slug: slug as string, ready: !!who && !!slug && !!current && on, api: apiForClub(current?.apiBase) };
}

export function useFamily() {
  const { who, slug, ready, api } = useClubApi();
  return useQuery({ queryKey: ["family", slug, who], queryFn: ({ signal }) => api.family.list({ club: slug }, { signal }), enabled: ready, retry: false });
}

function useSetChild() {
  const { who, slug } = useClubApi();
  const queryClient = useQueryClient();
  return (child: Child) =>
    queryClient.setQueryData<Family>(["family", slug, who], (f) =>
      f ? { ...f, children: f.children.some((c) => c.id === child.id) ? f.children.map((c) => (c.id === child.id ? child : c)) : [...f.children, child] } : f,
    );
}

export function useAddChild() {
  const { slug, api } = useClubApi();
  const set = useSetChild();
  return useMutation({ mutationFn: (body: BodyOf<"family.add">) => api.family.add({ club: slug }, body), onSuccess: (r) => set(r.child) });
}

export function useUpdateChild(id: number) {
  const { slug, api } = useClubApi();
  const set = useSetChild();
  return useMutation({ mutationFn: (body: BodyOf<"family.update">) => api.family.update({ club: slug, id }, body), onSuccess: (r) => set(r.child) });
}

export function useSetConsent(id: number) {
  const { slug, api } = useClubApi();
  const set = useSetChild();
  return useMutation({ mutationFn: (body: BodyOf<"family.consent">) => api.family.consent({ club: slug, id }, body), onSuccess: (r) => set(r.child) });
}

// ── Booking a place for a child ─────────────────────────────────────────────

export type FamilyBookings = ResponseOf<"family.bookings">;
export type FamilyDay = FamilyBookings["days"][number];
export type FamilyBooking = FamilyBookings["bookings"][number];

/** The play days open to book and this guardian's children's bookings. Refreshed after every booking or cancellation. */
export function useFamilyBookings() {
  const { who, slug, ready, api } = useClubApi();
  return useQuery({ queryKey: ["family-bookings", slug, who], queryFn: ({ signal }) => api.family.bookings({ club: slug }, { signal }), enabled: ready, retry: false });
}

function useRefreshBookings() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["family-bookings"] });
}

export function useBookChild(childId: number) {
  const { slug, api } = useClubApi();
  const refresh = useRefreshBookings();
  return useMutation({ mutationFn: (date: string) => api.family.book({ club: slug, id: childId }, { date }), onSettled: refresh });
}

export function useCancelBooking() {
  const { slug, api } = useClubApi();
  const refresh = useRefreshBookings();
  return useMutation({ mutationFn: (bookingId: number) => api.family.cancelBooking({ club: slug, id: bookingId }, {}), onSettled: refresh });
}

// ── A child's safety details: emergency contacts and the medical note ───────

export type Care = ResponseOf<"family.care">;
export type CareContact = Care["contacts"][number];

/** Asked for only when the guardian opens the section; never kept after the screen closes (gcTime 0). */
export function useCare(childId: number, open: boolean) {
  const { who, slug, ready, api } = useClubApi();
  return useQuery({ queryKey: ["family-care", slug, who, childId], queryFn: ({ signal }) => api.family.care({ club: slug, id: childId }, { signal }), enabled: ready && open, retry: false, gcTime: 0, staleTime: 0 });
}

function useSetCare(childId: number) {
  const { who, slug } = useClubApi();
  const queryClient = useQueryClient();
  return (care: Care) => queryClient.setQueryData<Care>(["family-care", slug, who, childId], care);
}

export function useSaveContacts(childId: number) {
  const { slug, api } = useClubApi();
  const set = useSetCare(childId);
  return useMutation({ mutationFn: (contacts: BodyOf<"family.careContacts">["contacts"]) => api.family.careContacts({ club: slug, id: childId }, { contacts }), onSuccess: set });
}

export function useSaveNotes(childId: number) {
  const { slug, api } = useClubApi();
  const set = useSetCare(childId);
  return useMutation({ mutationFn: (notes: string) => api.family.careNotes({ club: slug, id: childId }, { notes }), onSuccess: set });
}

// ── The club's forms and waivers for a child ────────────────────────────────

export type ChildForms = ResponseOf<"family.forms">;
export type ChildForm = ChildForms["forms"][number];

export function useChildForms(childId: number) {
  const { who, slug, ready, api } = useClubApi();
  return useQuery({ queryKey: ["family-forms", slug, who, childId], queryFn: ({ signal }) => api.family.forms({ club: slug, id: childId }, { signal }), enabled: ready, retry: false });
}

export function useSignForm(childId: number) {
  const { slug, api } = useClubApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { formId: number; name: string }) => api.family.signForm({ club: slug, id: childId, formId: input.formId }, { name: input.name }),
    // Signed, or refused because the wording changed: either way the list is asked for again.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["family-forms"] }),
  });
}
