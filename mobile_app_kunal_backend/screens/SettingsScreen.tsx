"use client";

/**
 * System — where the data comes from, and what this build will not do.
 *
 * The gateway exposes charge, discharge, standby, grid-mode and SOC-protection
 * writes. They are all internal_admin, and the API Reference is unambiguous
 * that they must never sit behind a customer UI. This build therefore refuses
 * them at the proxy rather than at the button: a control that is disabled in
 * the client is a control that a modified client can press.
 */

import {
  Moon, Server, Database, Timer, Cpu, Radio, LogOut, UserRound, Trash2,
  ShieldCheck, HardDrive, ListTree, BadgeCheck, CloudUpload, EyeOff,
  SlidersHorizontal, ChevronRight, LifeBuoy, Activity,
} from "lucide-react";
import {
  useGatewayHealth, useLive, useIdentity, useStorage, useAssets, useServerUpload,
  useIsDispatcher, useSite, useConnectivity,
} from "../data";
import { useRouter } from "next/navigation";
import { useGatewaySelection } from "../gateway/GatewayContext";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, ListItem, Toggle, StatusIndicator, SecondaryButton, Value,
  SectionMenu, SectionBack, useSection,
} from "../components";
import { getSession, logout } from "../gateway/auth";
import { apiBase } from "../gateway/config";
import { useTheme } from "../useTheme";

const BASE = "/k/settings";

/**
 * System, as a contents page.
 *
 * This screen answered nine questions in one scroll — where the data comes
 * from, what the gateway will not do, the theme, the account, the assets, the
 * energy counters, and a paragraph on each of four things the site cannot
 * measure. All of it worth keeping and almost none of it worth reading at the
 * same time.
 *
 * The rows are ordered by how often somebody needs them, not by how the screen
 * grew: support first, because the reason to open System is usually that
 * something is wrong.
 */
const SETTINGS_SECTIONS = ["source", "control", "counters", "limits", "account", "appearance"] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

function row(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function SettingsScreen() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const gw = useGatewayHealth();
  const live = useLive();
  /* The same freshness judgement the banner and every metric label use.
     This row used to make its own, from a different endpoint — see the card
     below for what that cost. */
  const conn = useConnectivity();
  const { available } = useGatewaySelection();
  const { identity } = useIdentity();
  const site = useSite();
  const { isDispatcher } = useIsDispatcher();
  const logger = (gw.logger ?? {}) as Record<string, unknown>;
  const { storage } = useStorage();
  const { assets } = useAssets();
  const { upload } = useServerUpload();

  /* Read defensively by trying the plausible key names rather than pinning one.
     The status payloads are not in the API Reference's schema section, so the
     exact spelling is not a contract — and a row that quietly disappears
     because a key was renamed is better than one that renders "undefined". */
  const pick = (o: Record<string, unknown> | null, ...keys: string[]) => {
    for (const k of keys) {
      const v = o?.[k];
      if (v != null && v !== "") return v;
    }
    return null;
  };

  const dbMb = pick(storage, "db_size_mb", "size_mb", "database_size_mb", "disk_used_mb");
  const retain = pick(storage, "retention_days") ?? row(logger.retention_days);
  const storageLine = dbMb != null
    ? `${row(dbMb)} MB on disk · ${retain} days retained`
    : null;

  const upEvery = pick(upload, "upload_interval_sec", "interval_sec");
  const upMode = pick(upload, "payload_mode", "mode");
  const uploadLine = upEvery != null || upMode != null
    ? [upMode && String(upMode), upEvery != null && `every ${row(upEvery)} s`].filter(Boolean).join(" · ")
    : null;


  const section = useSection(BASE, SETTINGS_SECTIONS) as SettingsSection | null;

  if (!section) {
    return (
      <>
        <Header />
        <div style={{ padding: "0 4px 18px" }}>
          <span className="m-h1 m-ink">System</span>
        </div>

        {/* Support is not one of the sections below — it is a screen of its
            own, and the reason most people open System at all. It keeps the
            top row rather than being buried under "Account". */}
        <SectionMenu
          base="/k"
          items={[{
            key: "support",
            title: "Support",
            subtitle: "Reach Ornate Solar, with this site's details attached",
            icon: <LifeBuoy size={17} />,
          }]}
        />

        <div style={{ marginTop: 14 }}>
          <SectionMenu
            base={BASE}
            items={[
              {
                key: "source",
                title: "Data source",
                subtitle: live.mode === "capture"
                  ? "Demonstration data — not your plant"
                  : "Which gateway these readings come from, and whether it is answering",
                icon: <Server size={17} />,
              },
              {
                key: "counters",
                title: "Energy counters",
                subtitle: "The plant's own cumulative charge and discharge registers",
                icon: <Activity size={17} />,
              },
              {
                key: "limits",
                title: "What this site cannot measure",
                subtitle: "Stored energy, savings, solar and the rest — and why each is absent",
                icon: <EyeOff size={17} />,
              },
              {
                key: "control",
                title: "Control",
                subtitle: "What this app will and will not do to the plant",
                icon: <SlidersHorizontal size={17} />,
              },
              {
                key: "account",
                title: "Account",
                subtitle: "Who you are signed in as, deletion, privacy and sign out",
                icon: <UserRound size={17} />,
              },
              {
                key: "appearance",
                title: "Appearance",
                subtitle: theme === "dark" ? "Dark theme" : "Light theme",
                icon: <Moon size={17} />,
              },
            ]}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <SectionBack title="System" base={BASE} />

      {section === "source" && <>
      <SectionHeader title="Data source" />
      <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
        <ListItem
          leading={<Server size={17} />}
          title={live.mode === "capture" ? "Demonstration data" : "Your site"}
          /* Two facts, kept apart, because they are two facts.
           *
           * This row used to say "Connected. Readings come directly from the
           * site." beside a green "Live" chip, and both were driven by
           * gw.error — that is, by whether /api/health had answered. It is the
           * cheapest endpoint the gateway has, and on 7 September 2026 it was
           * returning in 18.7 s while /api/fast-bess/latest, which is where
           * every reading on every screen actually comes from, had been
           * failing for an hour. So the phone showed a green Live chip above a
           * banner reading "Can't reach the site. Nothing on screen is newer
           * than 62 min ago", and a customer had no way to tell which to
           * believe.
           *
           * Neither was lying; they were answering different questions. The
           * gateway answering and your readings being current are separate
           * things, and on this plant they come apart regularly. So the
           * subtitle reports reachability, which is what gw.error measures,
           * and the chip reports freshness, from the one judgement the banner
           * and every metric label already share. They cannot disagree now
           * because there is only one of them. */
          subtitle={
            live.mode === "capture"
              ? "Sample data for demonstration — not your plant."
              : gw.error
                ? "The gateway is not answering."
                : conn.isLive
                  ? "Connected. Readings come directly from the site."
                  : `The gateway is answering, but ${conn.detail.toLowerCase()}.`
          }
          trailing={
            <StatusIndicator
              tone={live.mode === "capture" ? "warn" : gw.error ? "bad" : conn.tone}
              label={live.mode === "capture" ? "Capture" : gw.error ? "Error" : conn.label}
              live={live.mode !== "capture" && !gw.error && conn.isLive}
            />
          }
        />
        {/* A row that only listed the units is now the way into seeing them
            together, on a site that has more than one. It stays a plain
            statement of fact where there is only one unit — a chevron that
            leads to a comparison of one thing is a broken promise. */}
        <ListItem
          leading={<Cpu size={17} />}
          title="Battery units"
          subtitle={
            available.map((a) => a.bessId.replace("bess_", "BESS ")).join(", ") ||
            "none reported"
          }
          onClick={available.length > 1 ? () => router.push("/k/site") : undefined}
          trailing={available.length > 1 ? <ChevronRight size={16} className="m-ink3" /> : undefined}
        />
        {/* ── Everything below is for whoever supports the site ─────────
            Logger cadence, retention, poll intervals, SQLite size and upload
            queue state are how an engineer diagnoses a gateway. They are not
            what the plant is doing, they are not actionable by the person who
            owns it, and a customer reading "profile pcs_bms_critical_lean_90d"
            learns nothing except that this app is talking about itself.

            Gated rather than deleted: Ornate still needs them in the field,
            and the gateway already answers these endpoints. Same role that
            gates dispatch, so there is one boundary to reason about. */}
        {isDispatcher && (
          <>
          <ListItem
            leading={<Timer size={17} />}
            title="Logger"
            subtitle={`interval ${row(logger.interval_sec)}s · profile ${row(logger.profile_name)}`}
            trailing={
              <StatusIndicator
                tone={logger.thread_alive ? "good" : "warn"}
                label={logger.thread_alive ? "Running" : "Unknown"}
              />
            }
          />
          <ListItem
            leading={<Database size={17} />}
            title="Retention"
            subtitle={`${row(logger.retention_days)} days on the gateway · ${row(logger.total_signal_count_per_bess)} signals per BESS`}
          />
          <ListItem
            leading={<Radio size={17} />}
            title="Poll cadence"
            subtitle="Latest 5 s · alarms 15 s · health 30 s · history on demand"
          />
          {/* One line each from /api/storage/status and /api/server-upload/status.
              Both used to be rendered as whole sections of raw key = value rows
              straight off the JSON — enabled = true, queue size = 0 — which is a
              diagnostic dump, not something an operator reads. The two facts
              worth keeping are how much the historian has accumulated and
              whether the gateway is shipping it anywhere, so they are stated
              here in words and the dumps are gone. Each row is omitted entirely
              when the gateway does not report it, rather than showing a dash. */}
          {storageLine && (
            <ListItem leading={<HardDrive size={17} />} title="Storage" subtitle={storageLine} />
          )}
          {uploadLine && (
            <ListItem leading={<CloudUpload size={17} />} title="Server upload" subtitle={uploadLine} />
          )}
          </>
        )}
      </FloatingCard>

      {isDispatcher && (
        <div className="m-label m-ink3" style={{ padding: "10px 6px 0", lineHeight: 1.5 }}>
          The gateway holds ninety days at one second and its own storage note warns that a SQLite
          file does not shrink until it is vacuumed. Treat it as a buffer, not a historian —
          anything that must outlive ninety days has to be pulled into a server store.
        </div>
      )}


      {/* The assets the gateway actually reports for this source. The screens
          read nine of them by base_asset_id; this is the gateway's own list,
          so a source that stops reporting one is visible here rather than
          showing up as a silently absent figure on the dashboard. */}
      {isDispatcher && assets.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <SectionHeader title={`Assets reported (${assets.length})`} />
          <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
            {assets.map((a, i) => (
              <ListItem
                key={String(a.asset_id ?? i)}
                wrap
                leading={<ListTree size={17} />}
                title={String(a.display_name ?? a.asset_id ?? "—")}
                subtitle={String(a.base_asset_id ?? a.asset_id ?? "")}
              />
            ))}
          </FloatingCard>
        </div>
      )}


      </>}

      {section === "control" && <>
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Control" />
        {/* Always reachable, by explicit instruction. The row navigates for
            every account; what an account may actually do is decided by the
            gateway on each request, and Control says so on arrival rather than
            here. The subtitle stays honest about the role either way. */}
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<SlidersHorizontal size={17} />}
            title="Dispatch"
            subtitle={
              isDispatcher
                ? "Charge, discharge and standby for the selected unit"
                : "Charge, discharge and standby — the gateway decides what this account may send"
            }
            /* Through the shared router, which is what the dock already uses
               and what the packaged build shims to hash routing. Setting
               window.location.hash directly worked on the phone and did
               nothing at all on the web: Next routes by path there, so the
               only way into Control from a browser was to type the URL. */
            onClick={() => router.push("/k/control")}
            trailing={<ChevronRight size={16} className="m-ink3" />}
          />
        </FloatingCard>
      </div>

      </>}

      {section === "appearance" && <>
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Appearance" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<Moon size={17} />}
            title="Dark theme"
            trailing={<Toggle checked={theme === "dark"} onChange={toggle} label="Dark theme" />}
          />
        </FloatingCard>
      </div>

      </>}

      {section === "account" && <>
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Account" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<UserRound size={17} />}
            title="Signed in as"
            trailing={<span className="m-label m-ink2">{getSession()?.username ?? "—"}</span>}
          />
          {/* The gateway's own answer, from /api/auth/me, rather than the name
              that was typed at the login form. The role is the part that
              matters: it is what actually decides what this token may read,
              and nothing on any screen could show it before. */}
          {identity?.role && (
            <ListItem
              leading={<BadgeCheck size={17} />}
              title="Role"
              subtitle="As granted by the gateway, not by this app"
              trailing={<span className="m-label m-ink2">{String(identity.role)}</span>}
            />
          )}
          {/* Deletion is stated rather than offered, because this app cannot
              honestly offer it: gateway accounts are issued and revoked on the
              device by whoever commissioned the site, and a button here that
              quietly did nothing would be worse than no button. Play requires
              a route to deletion, not that the app perform it. */}
          <ListItem
            wrap
            leading={<Trash2 size={17} />}
            /* "Delete this account" reads as a control, and this row performs
               nothing — a reader who taps it and watches nothing happen
               reasonably concludes the app is broken. Naming it as guidance
               keeps Play's requirement met (deletion is still described and
               reachable from inside the app) while telling the truth about
               what the row is. */
            title="How to delete this account"
            subtitle="Accounts live on the site gateway, not in this app. Ask whoever commissioned the site, or write to support@ornatesolar.com, and the account and its access are removed at source."
          />
          {/* Play requires the policy to be reachable from inside the app as
              well as from the listing.

              Prefixed with apiBase() rather than linked as a bare "/privacy".
              A packaged build is served from https://localhost, which hosts the
              bundle and nothing else — a relative link there resolves inside
              the app and 404s. apiBase() is the deployed origin on a phone and
              "" on the web build, where a relative link is already right.

              _blank so Capacitor hands it to the system browser instead of
              navigating the WebView away from the app with no way back: the
              shell has no chrome, so an in-place navigation strands the user. */}
          <ListItem
            leading={<ShieldCheck size={17} />}
            title="Privacy policy"
            subtitle="What this app collects, and what it keeps on this device"
            onClick={() => window.open(`${apiBase()}/privacy`, "_blank", "noopener")}
          />
        </FloatingCard>

        <div style={{ marginTop: 12 }}>
          <SecondaryButton
            full
            onClick={() => logout()}
          >
            <LogOut size={16} style={{ marginRight: 8, verticalAlign: "-3px" }} />
            Sign out
          </SecondaryButton>
        </div>

        {/* Says what signing out does and does not do. On a shared phone the
            distinction matters: the session goes, the plant carries on. */}
        <p className="m-label m-ink3" style={{ padding: "10px 2px 0", lineHeight: 1.55 }}>
          Signing out clears this device&rsquo;s session only. It does not stop
          the site or change anything at the plant.
        </p>
      </div>

      {/* Moved off the dashboard, which is the screen an operator reads to see
          the plant — two lines about what cannot be shown pushed the readings
          that can be down the page. Stated once, here, rather than dropped
          entirely: an operator who expects a savings figure and finds none
          should learn that the gateway prices nothing, not conclude the app
          is broken. Both are properties of the gateway, not of this build. */}
      </>}

      {section === "counters" && <>
      {/* Energy the plant counts for itself.

          These are the inverter's and the battery's own cumulative registers,
          not anything this app integrated — so they are exact, they survive a
          restart of the phone, and they are the figures an operator can
          reconcile against a bill. The section below still explains what
          cannot be shown; it used to read as though that were everything. */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Energy counters" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            wrap
            title="Charged, this month"
            subtitle="Battery's own counter — resets monthly"
            trailing={<Value value={site.chargedKwhMonth} unit="kWh" precision={0} />}
          />
          <ListItem
            wrap
            title="Discharged, this month"
            subtitle="Battery's own counter — resets monthly"
            trailing={<Value value={site.dischargedKwhMonth} unit="kWh" precision={0} />}
          />
          {/* The yearly counters are deliberately absent.
           *
           * `yearly_cumulative_charge_energy` reads 223,543,296 kWh on this
           * site and its discharge twin reads 203,882,496 — both exact
           * multiples of 65536 (3411 x 65536 and 3111 x 65536, remainder zero),
           * which is a 32-bit register read with its two 16-bit words swapped.
           * The true figures are almost certainly 3,411 and 3,111 kWh, sitting
           * sensibly below the lifetime AC totals below.
           *
           * Not shown, and not silently corrected. Dividing by 65536 here would
           * be this app deciding what the plant meant, and if the gateway fixes
           * the word order the correction becomes the bug. The values stay on
           * `useSite` for whoever needs them; the row reappears when the
           * gateway returns a number that can be read as written. Reported to
           * the gateway team. */}
          <ListItem
            wrap
            title="Charged, lifetime"
            subtitle="Metered by the inverter on the AC side"
            trailing={<Value value={site.acChargedKwhTotal} unit="kWh" precision={0} />}
          />
          <ListItem
            wrap
            title="Discharged, lifetime"
            subtitle="Metered by the inverter on the AC side"
            trailing={<Value value={site.acDischargedKwhTotal} unit="kWh" precision={0} />}
          />
        </FloatingCard>
      </div>

      </>}

      {section === "limits" && <>
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Not available for this site" />
        <FloatingCard>
          <div className="m-stack" style={{ gap: 12 }}>
            <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
              <b className="m-ink">Stored energy in kWh.</b> The site reports
              state of charge but not pack capacity, so the energy held in the
              battery cannot be worked out from it.
            </span>
            <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
              <b className="m-ink">Cost and savings.</b> Energy is metered but no
              tariff is configured, so nothing here can be priced.
            </span>
            <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
              <b className="m-ink">Solar.</b> This site reports no solar
              generation.
            </span>
          </div>
        </FloatingCard>
        <p className="m-label m-ink3" style={{ padding: "10px 2px 0", lineHeight: 1.55 }}>
          <EyeOff size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Nothing above is hidden by this app. These are not measured at your
          site, and a figure invented for them would be a guess.
        </p>
      </div>

      <div className="m-label m-ink3" style={{ textAlign: "center", padding: "26px 0 6px", lineHeight: 1.6 }}>
        UnityESS · Ornate Agencies Pvt. Ltd.<br />
        UnityESS
      </div>
    </>}
    </>
  );
}
