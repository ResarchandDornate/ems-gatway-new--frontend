"use client";

/**
 * Support — how to reach a person, and what to tell them.
 *
 * The reference app leads with three buttons: write, chat, and a 24/7 number.
 * Only one of those exists for this deployment, and the other two are not
 * mocked up here. A "Chat with us" button that opens nothing, or a phone
 * number nobody answers, is worse than an honest gap — it is discovered at the
 * moment somebody actually needs help, which is the worst possible time.
 *
 * So the channels live in one table at the top of this file. A channel with no
 * address is not drawn, exactly the way System omits a gateway row it has no
 * value for. Filling in the phone and the chat link is a two-line change and
 * needs no other edit anywhere.
 *
 * The other half of the screen is the half that actually shortens a support
 * call: the site, unit, account and app build, gathered in one place and
 * copyable in one tap. Support's first four questions are always these, and a
 * customer reading them off four different screens gets at least one wrong.
 */

import { useState } from "react";
import {
  Mail, MessageSquare, Globe, Phone, Copy, Check, LifeBuoy, ShieldCheck,
  Building2, ChevronRight,
} from "lucide-react";

import { useIdentity, useLive, useGatewayHealth } from "../data";
import { useGatewaySelection } from "../gateway/GatewayContext";
import { useSiteSelection } from "../gateway/SiteContext";
import { getSession } from "../gateway/auth";
import { apiBase } from "../gateway/config";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, ListItem, SecondaryButton, StatusIndicator,
} from "../components";

/* ── The channels ──────────────────────────────────────────────────────────
   Every one of these is drawn only if it has an address. Add the phone number
   and the chat URL here and the rows appear; there is nothing else to change.

   `email` is the only one filled in because it is the only one this repo can
   point at with confidence — it is the address the privacy policy publishes
   and the one Play's data-safety declaration names for account deletion. A
   phone number invented to fill the row would be a real person's number
   somewhere. */
const CONTACT = {
  email: "support@ornatesolar.com",
  /** e.g. "+91 ..." — set this and a "Call us" row appears. */
  phone: "",
  /** Hours to state beside the phone. Meaningless without it. */
  phoneHours: "",
  /** A hosted chat or help desk. Opened in the system browser. */
  chatUrl: "",
  /** A support site or knowledge base. */
  webUrl: "",
} as const;

/**
 * Opened outside the WebView, always.
 *
 * The packaged shell has no chrome, so navigating it to an external page
 * strands the reader with no way back — the same reasoning the privacy link
 * on System records. `noopener` because the opened page has no business
 * holding a handle on this one.
 */
function openExternal(url: string): void {
  window.open(url, "_blank", "noopener");
}

export function SupportScreen() {
  const { identity } = useIdentity();
  const { siteId, siteName } = useSiteSelection();
  const { sourceId, bessId, available } = useGatewaySelection();
  const live = useLive();
  const gw = useGatewayHealth();
  const [copied, setCopied] = useState(false);

  const account =
    (identity && (identity as Record<string, unknown>).username) ??
    getSession()?.username ??
    "—";

  /* The facts support asks for, in the order they ask for them. Assembled once
     and used for both the clipboard and the mail body, so the two cannot drift
     apart — a customer who copies one and sends the other should not be able
     to produce two different accounts of the same site. */
  const details = [
    `Site: ${siteName || siteId || "—"}`,
    `Unit: ${bessId || "—"} (${sourceId || "—"})`,
    `Account: ${account}`,
    `Data source: ${live.mode === "capture" ? "demonstration capture" : "live gateway"}`,
    `Gateway: ${gw.error ? `error — ${gw.error}` : "reachable"}`,
  ].join("\n");

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      /* Reverts on its own. A tick that stays forever stops meaning "copied
         just now" and starts meaning nothing. */
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* Clipboard access is refused in some WebViews and over plain http.
         Nothing is claimed in that case — the details are on screen above and
         can be read out, which is what a caller does anyway. */
      setCopied(false);
    }
  }

  const mailHref =
    `mailto:${CONTACT.email}` +
    `?subject=${encodeURIComponent(`UnityESS support — ${siteName || siteId || "site"}`)}` +
    `&body=${encodeURIComponent(`\n\n---\n${details}\n`)}`;

  return (
    <>
      <Header />

      <div style={{ padding: "0 4px 18px" }}>
        <span className="m-h1 m-ink">Support</span>
      </div>

      {/* ── Who is being talked about ─────────────────────────────────── */}
      <SectionHeader title="This site" />
      <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
        <ListItem
          leading={<Building2 size={17} />}
          title={siteName || siteId || "Site"}
          subtitle={
            available.length > 1
              ? `${available.length} battery units · viewing ${bessId.replace("bess_", "BESS ")}`
              : bessId
                ? bessId.replace("bess_", "BESS ")
                : "one battery unit"
          }
          trailing={
            <StatusIndicator
              tone={live.mode === "capture" ? "warn" : gw.error ? "bad" : "good"}
              label={live.mode === "capture" ? "Capture" : gw.error ? "Error" : "Live"}
              live={live.mode !== "capture" && !gw.error}
            />
          }
        />
        <ListItem
          leading={copied ? <Check size={17} /> : <Copy size={17} />}
          title={copied ? "Copied" : "Copy site details"}
          subtitle="Site, unit, account and connection state — paste this into any message"
          onClick={copyDetails}
        />
      </FloatingCard>

      {/* ── How to reach someone ──────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Contact Ornate Solar" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<Mail size={17} />}
            title="Write to us"
            /* Prefilled with the details above, so the first reply is an
               answer rather than a request for the site id. */
            subtitle={`${CONTACT.email} — your site details are attached automatically`}
            onClick={() => openExternal(mailHref)}
            trailing={<ChevronRight size={16} className="m-ink3" />}
          />

          {CONTACT.phone && (
            <ListItem
              leading={<Phone size={17} />}
              title="Call us"
              subtitle={[CONTACT.phone, CONTACT.phoneHours].filter(Boolean).join(" · ")}
              onClick={() => openExternal(`tel:${CONTACT.phone.replace(/\s+/g, "")}`)}
              trailing={<ChevronRight size={16} className="m-ink3" />}
            />
          )}

          {CONTACT.chatUrl && (
            <ListItem
              leading={<MessageSquare size={17} />}
              title="Chat with us"
              subtitle="Opens in your browser"
              onClick={() => openExternal(CONTACT.chatUrl)}
              trailing={<ChevronRight size={16} className="m-ink3" />}
            />
          )}

          {CONTACT.webUrl && (
            <ListItem
              leading={<Globe size={17} />}
              title="Visit support"
              subtitle="Guides and answers to common questions"
              onClick={() => openExternal(CONTACT.webUrl)}
              trailing={<ChevronRight size={16} className="m-ink3" />}
            />
          )}
        </FloatingCard>
      </div>

      {/* ── What support can and cannot do from here ──────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Before you write" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            wrap
            leading={<LifeBuoy size={17} />}
            title="Alarms are explained in the app"
            subtitle="Every active alarm on the Alarms screen carries what it means and what usually causes it. Quoting the alarm's own wording is the fastest thing you can put in a message."
          />
          <ListItem
            wrap
            leading={<ShieldCheck size={17} />}
            /* Stated here as well as on System, because this is the screen
               somebody reaches when they want something changed — and the
               answer that no app can change it is better given before the
               message is written than in reply to it. */
            title="This app cannot operate the plant"
            subtitle="Charge, discharge and grid-mode commands are refused by this app and by the gateway, for every account. Anything that needs the plant to do something has to go through whoever commissioned the site."
          />
          <ListItem
            leading={<ShieldCheck size={17} />}
            title="Privacy policy"
            subtitle="What this app collects, and what it keeps on this device"
            onClick={() => openExternal(`${apiBase()}/privacy`)}
            trailing={<ChevronRight size={16} className="m-ink3" />}
          />
        </FloatingCard>
      </div>

      <div style={{ marginTop: 12 }}>
        <SecondaryButton full onClick={() => openExternal(mailHref)}>
          <Mail size={16} style={{ marginRight: 8, verticalAlign: "-3px" }} />
          Write to support
        </SecondaryButton>
      </div>
    </>
  );
}
