// Routes. Sign-in and the shell are in the first bundle; each tab's screen
// is its own chunk, loaded when it is first opened.
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from "@tanstack/react-router";
import { store } from "./app.ts";
import { InviteScreen } from "./screens/Invite.tsx";
import { Shell } from "./screens/Shell.tsx";
import { SignInScreen } from "./screens/SignIn.tsx";

const root = createRootRoute({ component: Outlet });

const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: store.get().token ? "/me" : "/signin", replace: true });
  },
});

const signIn = createRoute({
  getParentRoute: () => root,
  path: "/signin",
  beforeLoad: () => {
    if (store.get().token) throw redirect({ to: "/me", replace: true });
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

const me = createRoute({ getParentRoute: () => shell, path: "/me", component: lazyRouteComponent(() => import("./screens/Me.tsx")) });
const arena = createRoute({ getParentRoute: () => shell, path: "/arena", component: lazyRouteComponent(() => import("./screens/Arena.tsx")) });
const leaderboard = createRoute({ getParentRoute: () => shell, path: "/leaderboard", component: lazyRouteComponent(() => import("./screens/Leaderboard.tsx")) });
const vision = createRoute({ getParentRoute: () => shell, path: "/vision", component: lazyRouteComponent(() => import("./screens/Vision.tsx")) });
const player = createRoute({ getParentRoute: () => shell, path: "/player", component: lazyRouteComponent(() => import("./screens/Player.tsx")) });
// The inbox isn't a tab (as on the website, where it opens from Me's bell).
const inboxScreen = lazyRouteComponent(() => import("./screens/Inbox.tsx"));
const inbox = createRoute({ getParentRoute: () => shell, path: "/inbox", component: inboxScreen });
const inboxNew = createRoute({ getParentRoute: () => shell, path: "/inbox/new", component: inboxScreen });
const inboxThread = createRoute({ getParentRoute: () => shell, path: "/inbox/$id", component: inboxScreen });
const welcome = createRoute({ getParentRoute: () => shell, path: "/welcome", component: lazyRouteComponent(() => import("./screens/Welcome.tsx")) });
const settings = createRoute({ getParentRoute: () => shell, path: "/settings", component: lazyRouteComponent(() => import("./screens/Settings.tsx")) });

const routeTree = root.addChildren([index, signIn, invite, shell.addChildren([me, player, arena, leaderboard, vision, settings, welcome, inbox, inboxNew, inboxThread])]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultNotFoundComponent: () => {
    throw redirect({ to: "/", replace: true });
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
