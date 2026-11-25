// Routes. Sign-in and the shell are in the first bundle; each tab's screen
// is its own chunk, loaded when it is first opened.
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Navigate, Outlet, redirect } from "@tanstack/react-router";
import { store } from "./app.ts";
import { InviteScreen } from "./screens/Invite.tsx";
import { Shell } from "./screens/Shell.tsx";
import { SignInScreen } from "./screens/SignIn.tsx";

const root = createRootRoute({ component: Outlet });

const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: store.get().token ? "/home" : "/signin", replace: true });
  },
});

const signIn = createRoute({
  getParentRoute: () => root,
  path: "/signin",
  beforeLoad: () => {
    if (store.get().token) throw redirect({ to: "/home", replace: true });
  },
  component: SignInScreen,
});

const invite = createRoute({ getParentRoute: () => root, path: "/c/$club", component: InviteScreen });

const shell = createRoute({
  getParentRoute: () => root,
  id: "shell",
  beforeLoad: () => {
    if (!store.get().token) throw redirect({ to: "/signin", replace: true });
  },
  component: Shell,
});

const home = createRoute({ getParentRoute: () => shell, path: "/home", component: lazyRouteComponent(() => import("./screens/Home.tsx")) });
// Me was the first tab before Home; Settings now lives in My profile. Old links still land.
const me = createRoute({ getParentRoute: () => shell, path: "/me", beforeLoad: () => { throw redirect({ to: "/home", replace: true }); } });
const profile = createRoute({ getParentRoute: () => shell, path: "/profile", component: lazyRouteComponent(() => import("./screens/Profile.tsx")) });
const arena = createRoute({ getParentRoute: () => shell, path: "/arena", component: lazyRouteComponent(() => import("./screens/Arena.tsx")) });
const leaderboard = createRoute({ getParentRoute: () => shell, path: "/leaderboard", component: lazyRouteComponent(() => import("./screens/Leaderboard.tsx")) });
const vision = createRoute({ getParentRoute: () => shell, path: "/vision", component: lazyRouteComponent(() => import("./screens/Vision.tsx")) });
const player = createRoute({ getParentRoute: () => shell, path: "/player", component: lazyRouteComponent(() => import("./screens/Player.tsx")) });
// The inbox isn't a tab (as on the website, where it opens from Me's bell).
const inboxScreen = lazyRouteComponent(() => import("./screens/Inbox.tsx"));
// With several clubs, a conversation is one club's: ?club=<slug> says whose.
const clubSearch = (search: Record<string, unknown>): { club?: string } =>
  typeof search.club === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(search.club) ? { club: search.club } : {};
const inbox = createRoute({ getParentRoute: () => shell, path: "/inbox", component: inboxScreen, validateSearch: clubSearch });
const inboxNew = createRoute({ getParentRoute: () => shell, path: "/inbox/new", component: inboxScreen, validateSearch: clubSearch });
const inboxThread = createRoute({ getParentRoute: () => shell, path: "/inbox/$id", component: inboxScreen, validateSearch: clubSearch });
const welcome = createRoute({ getParentRoute: () => shell, path: "/welcome", component: lazyRouteComponent(() => import("./screens/Welcome.tsx")) });
const membership = createRoute({ getParentRoute: () => shell, path: "/membership", component: lazyRouteComponent(() => import("./screens/Membership.tsx")) });
const visionTrack = createRoute({ getParentRoute: () => shell, path: "/vision/track", component: lazyRouteComponent(() => import("./screens/VisionTrack.tsx")) });
const visionLabel = createRoute({ getParentRoute: () => shell, path: "/vision/label", component: lazyRouteComponent(() => import("./screens/VisionLabel.tsx")) });
const settings = createRoute({ getParentRoute: () => shell, path: "/settings", beforeLoad: () => { throw redirect({ to: "/profile", hash: "settings", replace: true }); } });

const routeTree = root.addChildren([index, signIn, invite, shell.addChildren([home, me, profile, player, arena, leaderboard, vision, visionLabel, visionTrack, settings, welcome, membership, inbox, inboxNew, inboxThread])]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  // An address the app doesn't have: to the start (Me, or sign-in). A redirect
  // thrown here isn't caught (it showed the router's bare error page).
  defaultNotFoundComponent: () => <Navigate to="/" replace />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
