"use client";

import { useEffect } from "react";

/**
 * Scrolls to the fragment in the URL once the page has actually rendered.
 *
 * This page streams, so at the moment the browser handles `#account-deletion`
 * the element it names does not exist yet and the browser silently gives up:
 * the anchor resolves, the page stays at the top. That is fine for a reader who
 * arrived at the policy to read it, and not fine for the one link that matters
 * here — both stores are given a deletion *URL*, and a reviewer following it
 * should land on the section rather than on paragraph one of a 2,600px page.
 *
 * Runs after mount, so the element exists. No-ops without a fragment.
 */
export function HashScroll() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    /* rAF rather than an immediate call: on a fresh load the browser may still
       be restoring its own scroll position, and it would win the race. */
    requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  }, []);
  return null;
}
