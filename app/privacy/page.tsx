import type { Metadata } from "next";
/* Self-hosted; see app/layout.tsx for why next/font/google is not used. */
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@/mobile_app_kunal_backend/styles/mobile.css";
import { AppBackground, FloatingCard, SectionHeader } from "@/mobile_app_kunal_backend/components";
import { HashScroll } from "./HashScroll";

/**
 * The privacy policy for the UnityESS mobile app.
 *
 * Dressed in the /k design system rather than the web app's, because this is
 * the mobile app's policy and it is read on a phone — from the Settings screen,
 * or from the Play listing on the same device that is about to install it.
 * Landing on the desktop EMS styling from either would read as a different
 * product. Everything here is scoped under `.m-root`, so importing that sheet
 * on this route cannot reach the thirteen web routes.
 *
 * It deliberately does NOT live under /k. That route is gated to the packaged
 * app — a browser gets AppOnlyScreen — and Google opens this URL signed out, in
 * a browser, during review. A policy behind that gate is a policy the reviewer
 * cannot read. It sits at /privacy and is listed in AUTH_BYPASS_ROUTES in
 * components/auth/AuthGate.tsx so the UGX gate does not swallow it either.
 *
 * Every factual claim below was checked against the code rather than adapted
 * from a template, because a policy that overstates what an app collects is a
 * liability and one that understates it is a lie:
 *
 *   - no analytics, crash-reporting, advertising or attribution SDK appears in
 *     either package.json
 *   - AndroidManifest.xml requests exactly one permission, INTERNET
 *   - the proxy holds no gateway account and stores nothing
 *     (mobile_app_kunal_backend/gateway/proxy.ts)
 *   - what is written to the device is three keys, listed below and named
 *     exactly as the code writes them
 *
 * If any of those change, this page has to change with them, and so does
 * docs/PLAY_DATA_SAFETY.md — Google treats a Data Safety form that disagrees
 * with the policy as a policy violation in itself.
 */

export const metadata: Metadata = {
  title: "Privacy Policy · UnityESS",
  description:
    "How the UnityESS mobile app handles your sign-in, your site's readings and the data kept on your device.",
};

const UPDATED = "24 August 2026";

/** A paragraph at the body size, with the line height long prose needs. */
function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-body m-ink2" style={{ margin: 0, lineHeight: 1.62 }}>
      {children}
    </p>
  );
}

/* `id` exists so a section can be linked to from outside. Play's Data Safety
   form and App Store Connect both ask for a *URL* where an account can be
   deleted, not an address to write to, and refuse a mailto: — so the deletion
   section has to be addressable on its own. Changing that id breaks a link
   already filed with both stores. */
function Block({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ marginTop: 22, scrollMarginTop: 16 }}>
      <SectionHeader title={title} />
      <FloatingCard>
        <div className="m-stack" style={{ gap: 12 }}>{children}</div>
      </FloatingCard>
    </div>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="m-root">
      <HashScroll />
      <AppBackground>
        <header style={{ padding: "38px 4px 4px" }}>
          <span className="m-eyebrow">UnityESS</span>
          <h1 className="m-h1 m-ink" style={{ margin: "8px 0 0" }}>
            Privacy Policy
          </h1>
          <p className="m-label m-ink3" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>
            Last updated {UPDATED}
            <br />
            Ornate Agencies Pvt. Ltd.
          </p>
        </header>

        <div style={{ padding: "18px 4px 0" }}>
          <P>
            UnityESS is an app for the people who operate a battery energy
            storage site. It shows readings from the energy management gateway
            installed at that site. It is not a consumer product, it carries no
            advertising, and it has no interest in you beyond letting you see
            your own plant.
          </P>
        </div>

        <Block title="What we collect">
          <P>
            <strong className="m-ink">Your gateway username and password</strong>,
            at the moment you type them, so they can be sent to your site’s
            gateway to be checked. We do not store them. Our server holds no
            account of its own and keeps no copy of yours — it passes your
            sign-in through and forwards the access token the gateway issues back
            to you.
          </P>
          <P>
            <strong className="m-ink">Readings from your site</strong> — state of
            charge, power, temperatures, alarms and the other measurements the
            gateway reports. These describe equipment, not people.
          </P>
          <P>
            That is the entire list. The app contains no analytics, no crash
            reporting, no advertising and no attribution or tracking software of
            any kind.
          </P>
        </Block>

        <Block title="Stored on your device">
          <P>Three things, all held locally by the app:</P>
          <P>
            <strong className="m-ink">Your session</strong> — the access token the
            gateway issued, your username and the token’s expiry time. It
            expires on the schedule the gateway sets, and signing out removes it
            immediately.
          </P>
          <P>
            <strong className="m-ink">Recent readings</strong> — the most recent
            responses from your site, kept for up to 24 hours so the app can still
            show the last known figures in a plant room with no signal. They are
            overwritten as new readings arrive and discarded after 24 hours.
          </P>
          <P>
            <strong className="m-ink">Your theme preference</strong> — whether you
            chose the light or dark appearance.
          </P>
          <P>
            On a phone this lives in the app’s own private storage, which
            other apps cannot read. Uninstalling the app removes all three.
            Signing out clears your session; cached readings expire on their own
            within 24 hours.
          </P>
        </Block>

        <Block title="Where your data goes">
          <P>
            The app talks to one place: our server, which forwards your requests
            to your site’s gateway and returns its answers. Nothing is sent
            anywhere else, and nothing is sold, rented or shared with any third
            party for any purpose.
          </P>
          <P>
            Our server does not retain the contents of those requests. Like any
            web server it keeps ordinary operational logs — the time of a request,
            the address it came from, which endpoint was asked for — which exist
            to keep the service running and secure, and are not used to build any
            profile of you.
          </P>
        </Block>

        <Block title="What the app does not do">
          <P>
            It does not access your location, camera, microphone, contacts,
            calendar, photos, files, call history or messages, and it does not ask
            for permission to. On Android the app requests exactly one permission,
            internet access, because it cannot show you your site without it.
          </P>
          <P>
            It also cannot operate your plant. The app is read-only by design:
            every command endpoint — charge, discharge, standby, grid mode — is
            refused at our server, so no version of this app, modified or
            otherwise, can dispatch your battery.
          </P>
        </Block>

        <Block title="Your account" id="account-deletion">
          <P>
            Accounts are not created here. They are issued on the gateway at your
            site by whoever commissioned it, and this app has no ability to
            create, change or delete one.
          </P>
          <P>
            To have your account and its access removed, ask whoever commissioned
            your site, or write to{" "}
            <a className="m-link" href="mailto:support@ornatesolar.com">
              support@ornatesolar.com
            </a>
            . It is removed at the source, which also ends its access here. The
            same address reaches us for any question about this policy, or for a
            copy of what is held about you.
          </P>
        </Block>

        <Block title="Children">
          <P>
            UnityESS is a tool for site operators and industrial customers. It is
            not directed at children and we do not knowingly collect anything from
            them.
          </P>
        </Block>

        <Block title="Changes">
          <P>
            If this policy changes, the date at the top changes with it, and any
            change that affects what we collect will be reflected in the
            app’s Play Store listing before it takes effect.
          </P>
        </Block>

        <div
          className="m-label m-ink3"
          style={{ textAlign: "center", padding: "30px 0 10px", lineHeight: 1.6 }}
        >
          Ornate Agencies Pvt. Ltd.
          <br />
          <a className="m-link" href="mailto:support@ornatesolar.com">
            support@ornatesolar.com
          </a>
        </div>
      </AppBackground>
    </div>
  );
}
