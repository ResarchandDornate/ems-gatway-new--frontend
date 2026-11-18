"use client";

/**
 * What a browser sees when this deployment is gated to the packaged app.
 *
 * The proxy at /api/gw requires an app token when GW_APP_TOKEN is set, and only
 * the packaged build carries one — it is baked into the bundle at build time.
 * A web page cannot carry it without serving it to everyone who loads the page,
 * which would make the gate decorative, so the web build deliberately does not.
 *
 * The consequence is that every call from a browser is refused, and until this
 * screen existed the refusal arrived as a *login failure*: the sign-in form
 * rendered, accepted a username and password, posted them, and reported "that
 * account is not permitted to sign in here". The account was fine. The message
 * blamed the operator for a property of the deployment, and the only way to
 * find that out was to read the proxy.
 *
 * So the form is not shown at all. A door that cannot open should not have a
 * handle on it.
 *
 * NOTE the absence of the backend-host line that LoginScreen carries. There it
 * earns its place: a packaged APK has its server address baked in at build
 * time, and printing the host is the only way to tell an app pointed at a stale
 * backend from one that simply cannot connect. Here it cannot say anything.
 * This screen is reachable only from the web build, where apiBase() is always
 * "" — so the line rendered the constant string "same origin" to every visitor,
 * diagnosing nothing, on the one page whose whole job is to be understood by
 * someone who is not a developer.
 */

import { Smartphone } from "lucide-react";

export function AppOnlyScreen() {
  return (
    <div className="m-login">
      <div className="m-login-mark" aria-hidden>
        <Smartphone size={22} strokeWidth={1.7} />
      </div>

      <h1 className="m-login-title">UnityESS</h1>
      <p className="m-login-sub">
        This site is the phone app. In a browser it cannot reach your gateway.
      </p>

      <div className="m-appnote">
        <p>
          The installed app carries a key that identifies it to this server. A
          web page cannot hold one without handing it to everyone who opens the
          page, so sign-in is available in the app and not here.
        </p>
        <p>
          Install the Android app to sign in with your gateway account. Whoever
          commissioned your site issues both the app and the account.
        </p>
      </div>

      <p className="m-login-foot">
        Nothing is wrong with your account or with the plant — this page simply
        is not the way in.
      </p>
    </div>
  );
}
