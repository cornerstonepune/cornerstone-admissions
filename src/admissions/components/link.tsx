import type NextLink from "next/link";
import type { ComponentProps } from "react";

// A link that does not load its page in advance (ported from design/platform/components/link.tsx). Next pre-loads every
// link on screen in production; a long list of leads would start one page load per row. Only the sidebar links pre-load.
export default function Link(_props: ComponentProps<typeof NextLink>): React.ReactElement {
  throw new Error("not implemented");
}
