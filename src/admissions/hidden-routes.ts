// Screens hidden in v1 (PROJECT.md §1, M1 G1.2): they answer 404 but are not deleted.
// /signup stays open only for an invited person (`?invite=<token>`); everyone else joins by invitation.
export const HIDDEN_PREFIXES = ["/signup", "/broadcasts", "/agents"] as const;

/** True when the middleware must answer 404 for this path. */
export function isHiddenRoute(pathname: string, search: URLSearchParams): boolean {
  if (pathname === "/signup") return !search.get("invite");
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
