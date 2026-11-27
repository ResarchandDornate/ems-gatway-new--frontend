/**
 * Site Config (super admin only).
 *
 * Self-contained, like Admin → User Monitor: it does NOT use the app's own session; it signs in
 * to EMS-gateway-backend2 via the /api/admin-gw proxy and reuses the same ems_admin_token. Every
 * call here needs org:manage / site:manage, which only super_admin holds, so a non-super account
 * gets 403 and sees the restricted note rather than the table.
 *
 * Registering a site orchestrates three endpoints in order:
 *   1. POST admin/organizations      -> customer org + admin(phone, for OTP login) + the site
 *   2. POST site-profiles/{site_id}  -> the registration detail (additive table)
 *   3. POST admin/sites/{id}/gateways-> client_id + one-time client_secret for the gateway team
 */
"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getSession, subscribe } from "@/lib/central";
import { MapPin, Plus, RefreshCw, ShieldAlert, X, Check, Copy, KeyRound } from "lucide-react";

type Site = { id: string; site_key: string; name: string };
type Org = { id: string; org_key: string; name: string; sites: Site[] };
type Profile = {
  site_id: string; company_name: string | null; address: string | null;
  latitude: number | null; longitude: number | null;
  solar_capacity_kw: number | null; connection_voltage_kv: number | null;
  battery_capacity_kwh: number | null; pcs_capacity_kw: number | null;
  state: string | null; pincode: string | null;
  comm_pcs_ems: boolean; comm_pcs_battery: boolean; comm_battery_ems: boolean;
  comm_ems_meter_ems: boolean; comm_solar_inverter_ems: boolean;
  updated_by: string | null; updated_at: string | null;
};

const COMMS: { key: keyof Profile; label: string }[] = [
  { key: "comm_pcs_ems", label: "PCS – EMS" },
  { key: "comm_pcs_battery", label: "PCS – Battery" },
  { key: "comm_battery_ems", label: "Battery – EMS" },
  { key: "comm_ems_meter_ems", label: "EMS Meter – EMS" },
  { key: "comm_solar_inverter_ems", label: "Solar Inverter – EMS" },
];

const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export default function SiteConfigPage() {
  // Reuse the dashboard's own session: the same backend (ems-gateway-api) fronts both the data
  // and the admin APIs, so Site Config needs no separate sign-in.
  const session = useSyncExternalStore(subscribe, getSession, () => null);
  const token = session?.token ?? null;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [permNote, setPermNote] = useState("");
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ siteId: string; siteName: string; profile: Profile | undefined } | null>(null);

  const authed = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`/api/admin-gw/${path}`, {
        ...init,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
        cache: "no-store",
      }),
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(""); setPermNote("");
    try {
      const [ro, rp] = await Promise.all([authed("admin/organizations"), authed("site-profiles")]);
      if (ro.status === 401 || rp.status === 401) { setErr("Your session has expired — reload the dashboard to sign in again."); return; }
      if (ro.status === 403 || rp.status === 403) {
        setOrgs([]); setProfiles([]);
        setPermNote("This account is not a super admin. Site Config is restricted to super admins.");
        return;
      }
      setOrgs(ro.ok ? await ro.json() : []);
      setProfiles(rp.ok ? await rp.json() : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load sites.");
    } finally { setLoading(false); }
  }, [token, authed]);

  useEffect(() => { if (token) load(); }, [token, load]);

  // One row per registered site, joined to its profile (null until filled on this page).
  const rows = useMemo(() => {
    const bySite = new Map((profiles || []).map((p) => [p.site_id, p]));
    const out: { org: string; site: Site; p: Profile | undefined }[] = [];
    for (const o of orgs || []) for (const s of o.sites || [])
      out.push({ org: o.name, site: s, p: bySite.get(s.id) });
    return out;
  }, [orgs, profiles]);

  const stats = useMemo(() => ({
    sites: rows.length,
    registered: rows.filter((r) => r.p).length,
    customers: (orgs || []).length,
  }), [rows, orgs]);

  if (!token) {
    return (
      <div className="max-w-sm mx-auto mt-16 rounded-xl bg-surface2 border border-line p-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-1 text-ink font-semibold"><MapPin size={18} /> Site Config</div>
        <p className="text-[12.5px] text-muted">Open the dashboard and sign in to use Site Config.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-ink font-semibold text-[16px]"><MapPin size={18} /> Site Config</div>
        <div className="flex items-center gap-2">
          {!permNote && (
            <button onClick={() => setAdding(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white font-semibold text-[12.5px] hover:opacity-90">
              <Plus size={14} /> Add Site
            </button>
          )}
          <button onClick={load} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface2 border border-line text-[12.5px] text-ink3 hover:bg-surface3">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {err && <div className="text-[12.5px] text-bad mb-3">{err}</div>}
      {permNote && (
        <div className="flex items-center gap-2 text-[12.5px] text-warn bg-warn/10 border border-warn/30 rounded-md px-3 py-2 mb-3">
          <ShieldAlert size={14} /> {permNote}
        </div>
      )}

      {!permNote && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Registered sites" value={stats.registered} />
            <Stat label="Total sites" value={stats.sites} />
            <Stat label="Customers" value={stats.customers} />
          </div>

          <div className="rounded-xl bg-surface2 border border-line overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[1120px]">
              <thead>
                <tr className="text-left text-muted bg-surface3">
                  <th className="px-3 py-2 font-medium text-right">S.No</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Pincode</th>
                  <th className="px-3 py-2 font-medium text-right">Solar kW</th>
                  <th className="px-3 py-2 font-medium text-right">Battery kWh</th>
                  <th className="px-3 py-2 font-medium text-right">PCS kW</th>
                  <th className="px-3 py-2 font-medium text-right">Voltage kV</th>
                  <th className="px-3 py-2 font-medium">Comms</th>
                  <th className="px-3 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && !rows.length ? (
                  <tr><td colSpan={12} className="px-3 py-6 text-center text-muted">Loading…</td></tr>
                ) : !rows.length ? (
                  <tr><td colSpan={12} className="px-3 py-6 text-center text-muted">No sites registered yet.</td></tr>
                ) : rows.map(({ org, site, p }, i) => (
                  <tr key={site.id} className="border-t border-line">
                    <td className="px-3 py-2 text-right text-ink3">{i + 1}</td>
                    <td className="px-3 py-2 text-ink">{p?.company_name || org}</td>
                    <td className="px-3 py-2">{site.name}</td>
                    <td className="px-3 py-2 text-ink3">
                      {p?.latitude != null && p?.longitude != null
                        ? `${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)}`
                        : p?.address || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2">{p?.state || <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2">{p?.pincode || <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2 text-right">{num(p?.solar_capacity_kw)}</td>
                    <td className="px-3 py-2 text-right">{num(p?.battery_capacity_kwh)}</td>
                    <td className="px-3 py-2 text-right">{num(p?.pcs_capacity_kw)}</td>
                    <td className="px-3 py-2 text-right">{num(p?.connection_voltage_kv)}</td>
                    <td className="px-3 py-2">
                      {p ? <CommDots p={p} /> : <span className="text-muted">Not registered</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditing({ siteId: site.id, siteName: site.name, profile: p })}
                              className="px-2.5 py-1 rounded-md border border-line text-[11.5px] text-ink3 hover:bg-surface3">
                        {p ? "Edit" : "Register"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {adding && (
        <AddSiteWizard
          authed={authed}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); load(); }}
        />
      )}

      {editing && (
        <EditSiteModal
          authed={authed}
          siteId={editing.siteId}
          siteName={editing.siteName}
          profile={editing.profile}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function num(v: number | null | undefined) {
  return v == null ? <span className="text-muted">—</span> : v.toLocaleString("en-IN");
}

function CommDots({ p }: { p: Profile }) {
  const on = COMMS.filter((c) => p[c.key]);
  if (!on.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {on.map((c) => (
        <span key={c.key} className="px-1.5 py-0.5 rounded bg-good/15 text-good text-[10.5px]">{c.label}</span>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface2 border border-line px-4 py-3">
      <div className="text-[22px] font-bold text-ink leading-none">{value}</div>
      <div className="text-[11px] text-muted mt-1">{label}</div>
    </div>
  );
}

/* ── Add Site wizard ──────────────────────────────────────────────────────────
   Three steps: (1) site + capacities + comms, (2) the customer phone that
   becomes their OTP login, (3) create + show the gateway credentials once.
   Nothing is written until "Create" on step 2. */
type TariffSlot = { name: string; start: string; end: string; modifier_pct?: number | null; modifier_rs?: number | null };
type TariffTemplate = { state: string; base_energy_charge_rs: number; solar_charge_value_rs: number; slots: TariffSlot[] };

type Form = {
  company: string; siteName: string; address: string;
  latitude: string; longitude: string;
  solar: string; voltage: string; battery: string; pcs: string;
  state: string; pincode: string;
  comms: Record<string, boolean>;
  phone: string; email: string;
};

const EMPTY: Form = {
  company: "", siteName: "", address: "", latitude: "", longitude: "",
  solar: "", voltage: "", battery: "", pcs: "",
  state: "", pincode: "",
  comms: Object.fromEntries(COMMS.map((c) => [c.key, false])),
  phone: "", email: "",
};

function AddSiteWizard({
  authed, onClose, onDone,
}: {
  authed: (p: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void; onDone: () => void;
}) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [creds, setCreds] = useState<{ clientId: string; clientSecret: string; gatewayKey: string } | null>(null);
  const [templates, setTemplates] = useState<TariffTemplate[]>([]);
  useEffect(() => {
    authed("financials/tariff-templates").then((r) => (r.ok ? r.json() : [])).then(setTemplates).catch(() => {});
  }, [authed]);
  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));

  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
  const step1Valid = f.company.trim() && f.siteName.trim();
  const step2Valid = /^\+?[0-9][0-9\s-]{7,}$/.test(f.phone.trim());

  const create = async () => {
    setBusy(true); setErr("");
    try {
      // 1. customer org + admin(phone) + site
      const orgKey = `${slug(f.company)}-${slug(f.siteName)}`.slice(0, 48) || `site-${Date.now()}`;
      const siteKey = slug(f.siteName) || "site-1";
      const ro = await authed("admin/organizations", {
        method: "POST",
        body: JSON.stringify({
          org_key: orgKey, name: f.company.trim(), admin_phone: f.phone.trim(),
          admin_email: f.email.trim() || null,
          sites: [{ site_key: siteKey, name: f.siteName.trim() }],
        }),
      });
      if (!ro.ok) throw new Error(await msg(ro, "create customer/site"));
      const org = await ro.json();
      const siteId: string = org.sites?.[0]?.id;
      if (!siteId) throw new Error("Backend did not return the new site id.");

      // 2. registration detail
      const rp = await authed(`site-profiles/${siteId}`, {
        method: "POST",
        body: JSON.stringify({
          company_name: f.company.trim(), address: f.address.trim() || null,
          latitude: toNum(f.latitude), longitude: toNum(f.longitude),
          solar_capacity_kw: toNum(f.solar), connection_voltage_kv: toNum(f.voltage),
          battery_capacity_kwh: toNum(f.battery), pcs_capacity_kw: toNum(f.pcs),
          state: f.state || null, pincode: f.pincode.trim() || null,
          ...Object.fromEntries(COMMS.map((c) => [c.key, !!f.comms[c.key]])),
        }),
      });
      if (!rp.ok) throw new Error(await msg(rp, "save site detail"));

      // 3. gateway credentials for the gateway team (shown once)
      const gatewayKey = `${siteKey}-gw`;
      const rg = await authed(`admin/sites/${siteId}/gateways`, {
        method: "POST", body: JSON.stringify({ gateway_key: gatewayKey }),
      });
      if (!rg.ok) throw new Error(await msg(rg, "mint gateway credentials"));
      const g = await rg.json();
      setCreds({ clientId: g.client_id, clientSecret: g.client_secret, gatewayKey });

      // 4. auto-generate the revenue config from the chosen state's tariff (best-effort; the site
      //    is already created, so a revenue hiccup must not fail the whole registration).
      if (f.state) {
        const t = templates.find((x) => x.state === f.state);
        if (t) {
          const peak = t.slots.find((sl) => /peak/i.test(sl.name) && !/off/i.test(sl.name));
          const disch = !peak ? t.base_energy_charge_rs
            : peak.modifier_rs != null ? t.base_energy_charge_rs + peak.modifier_rs
            : Math.round(t.base_energy_charge_rs * (1 + (peak.modifier_pct ?? 0) / 100) * 100) / 100;
          await authed(`financials/revenue-config?gateway_id=${encodeURIComponent(g.id)}`, {
            method: "POST",
            body: JSON.stringify({
              state: t.state, charge_source: "solar", charge_cost_rs: t.solar_charge_value_rs,
              replaced_source: "grid", discharge_cost_rs: disch,
              base_energy_charge_rs: t.base_energy_charge_rs, solar_charge_value_rs: t.solar_charge_value_rs,
              slots: t.slots,
            }),
          }).catch(() => {});
        }
      }
      setStep(3);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Registration failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-lg mt-10 rounded-xl bg-surface2 border border-line shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 text-ink font-semibold text-[14px]">
            <Plus size={16} /> Register a site
          </div>
          <button onClick={onClose} className="text-ink3 hover:text-ink"><X size={16} /></button>
        </div>

        <Steps step={step} />

        <div className="px-4 py-4">
          {err && <div className="text-[12.5px] text-bad mb-3">{err}</div>}

          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              <Field className="col-span-2" label="Company name *" value={f.company} onChange={(v) => set("company", v)} />
              <Field className="col-span-2" label="Site name *" value={f.siteName} onChange={(v) => set("siteName", v)} />
              <Field className="col-span-2" label="Address" value={f.address} onChange={(v) => set("address", v)} />
              <Field label="Latitude" value={f.latitude} onChange={(v) => set("latitude", v)} />
              <Field label="Longitude" value={f.longitude} onChange={(v) => set("longitude", v)} />
              <Field label="Solar capacity (kW)" value={f.solar} onChange={(v) => set("solar", v)} />
              <Field label="Connection voltage (kV)" value={f.voltage} onChange={(v) => set("voltage", v)} />
              <Field label="Battery capacity (kWh)" value={f.battery} onChange={(v) => set("battery", v)} />
              <Field label="PCS capacity (kW)" value={f.pcs} onChange={(v) => set("pcs", v)} />
              <label className="block col-span-2">
                <span className="block text-[11px] text-muted mb-1">State (auto-fills revenue tariff)</span>
                <select value={f.state} onChange={(e) => set("state", e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-surface border border-line text-[13px] text-ink">
                  <option value="">{templates.length ? "Select a state…" : "Loading states…"}</option>
                  {[...templates].sort((a, b) => a.state.localeCompare(b.state)).map((t) => (
                    <option key={t.state} value={t.state}>{t.state}</option>
                  ))}
                </select>
                {(() => {
                  const t = f.state ? templates.find((x) => x.state === f.state) : undefined;
                  return t ? (
                    <span className="block text-[10.5px] text-muted mt-1">
                      Base energy ₹{t.base_energy_charge_rs}/kWh · solar ₹{t.solar_charge_value_rs}/kWh — revenue config auto-created on save.
                    </span>
                  ) : null;
                })()}
              </label>
              <Field label="Pincode" value={f.pincode} onChange={(v) => set("pincode", v)} />
              <div className="col-span-2 mt-1">
                <div className="text-[11px] text-muted mb-1.5">Communication mappings</div>
                <div className="flex flex-wrap gap-1.5">
                  {COMMS.map((c) => (
                    <button key={c.key} type="button"
                      onClick={() => setF((p) => ({ ...p, comms: { ...p.comms, [c.key]: !p.comms[c.key] } }))}
                      className={`px-2.5 py-1 rounded-md text-[11.5px] border transition-colors ${
                        f.comms[c.key] ? "bg-accent/15 border-accent/40 text-accent" : "bg-surface border-line text-ink3 hover:border-line2"
                      }`}>
                      {f.comms[c.key] ? <Check size={11} className="inline mr-1 -mt-0.5" /> : null}{c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-[12px] text-muted mb-3">
                The customer signs in to the dashboard with this phone number via a one-time OTP. It becomes their login.
              </p>
              <Field label="Customer phone *" value={f.phone} onChange={(v) => set("phone", v)} placeholder="+91 98XXXXXXXX" />
              <div className="h-3" />
              <Field label="Customer email (optional)" value={f.email} onChange={(v) => set("email", v)} />
            </div>
          )}

          {step === 3 && creds && (
            <div>
              <div className="flex items-center gap-2 text-good text-[13px] font-medium mb-2">
                <Check size={15} /> Site registered.
              </div>
              <p className="text-[12px] text-muted mb-3">
                Give these to the gateway team. The secret is shown once — copy it now.
              </p>
              <CredRow label="Gateway key" value={creds.gatewayKey} />
              <CredRow label="Client ID" value={creds.clientId} />
              <CredRow label="Client secret" value={creds.clientSecret} secret />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-line">
          {step === 1 && (
            <>
              <span />
              <button disabled={!step1Valid} onClick={() => setStep(2)}
                      className="px-4 py-1.5 rounded-md bg-accent text-white text-[12.5px] font-semibold disabled:opacity-50">
                Next
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="px-3 py-1.5 rounded-md border border-line text-[12.5px] text-ink3">Back</button>
              <button disabled={!step2Valid || busy} onClick={create}
                      className="px-4 py-1.5 rounded-md bg-accent text-white text-[12.5px] font-semibold disabled:opacity-50">
                {busy ? "Registering…" : "Create"}
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <span />
              <button onClick={onDone} className="px-4 py-1.5 rounded-md bg-accent text-white text-[12.5px] font-semibold">Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

async function msg(r: Response, what: string) {
  try { const j = await r.json(); return `Could not ${what}: ${j.detail || r.status}`; }
  catch { return `Could not ${what} (${r.status}).`; }
}

function Steps({ step }: { step: number }) {
  const labels = ["Site details", "Customer login", "Gateway keys"];
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-surface3/40">
      {labels.map((l, i) => {
        const n = i + 1, on = step === n, done = step > n;
        return (
          <div key={l} className="flex items-center gap-2">
            <span className={`w-5 h-5 grid place-items-center rounded-full text-[10.5px] font-semibold ${
              done ? "bg-good text-white" : on ? "bg-accent text-white" : "bg-surface border border-line text-muted"
            }`}>{done ? <Check size={11} /> : n}</span>
            <span className={`text-[11.5px] ${on ? "text-ink font-medium" : "text-muted"}`}>{l}</span>
            {n < 3 && <span className="w-5 h-px bg-line2" />}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label, value, onChange, className = "", placeholder,
}: { label: string; value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] text-muted mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
             className="w-full px-3 py-2 rounded-md bg-surface border border-line text-[13px] text-ink" />
    </label>
  );
}

function CredRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted mb-1">
        {secret ? <KeyRound size={11} /> : null}{label}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-2.5 py-1.5 rounded-md bg-surface border border-line text-[12px] text-ink break-all">{value}</code>
        <button onClick={copy} className="px-2 py-1.5 rounded-md border border-line text-ink3 hover:bg-surface3" title="Copy">
          {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

/* ── Edit / Register a site ────────────────────────────────────────────────────
   Updates the registration detail only (POST site-profiles/{id} is an upsert),
   never the customer org, gateway or credentials — so a typo is fixed without
   re-provisioning. The same modal registers an existing unregistered site. */
type EditForm = {
  company: string; address: string; latitude: string; longitude: string;
  solar: string; voltage: string; battery: string; pcs: string;
  state: string; pincode: string; comms: Record<string, boolean>;
};

const edStr = (v: unknown) => (v == null ? "" : String(v));

function editFormOf(p: Profile | undefined): EditForm {
  return {
    company: edStr(p?.company_name), address: edStr(p?.address),
    latitude: edStr(p?.latitude), longitude: edStr(p?.longitude),
    solar: edStr(p?.solar_capacity_kw), voltage: edStr(p?.connection_voltage_kv),
    battery: edStr(p?.battery_capacity_kwh), pcs: edStr(p?.pcs_capacity_kw),
    state: edStr(p?.state), pincode: edStr(p?.pincode),
    comms: Object.fromEntries(COMMS.map((c) => [c.key, !!(p && p[c.key])])),
  };
}

function EditSiteModal({
  authed, siteId, siteName, profile, onClose, onDone,
}: {
  authed: (p: string, init?: RequestInit) => Promise<Response>;
  siteId: string; siteName: string; profile: Profile | undefined;
  onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState<EditForm>(() => editFormOf(profile));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [states, setStates] = useState<string[]>([]);
  useEffect(() => {
    authed("financials/tariff-templates")
      .then((r) => (r.ok ? r.json() : []))
      .then((ts: { state: string }[]) => setStates([...new Set(ts.map((t) => t.state))].sort()))
      .catch(() => {});
  }, [authed]);
  const set = (k: keyof EditForm, v: string) => setF((p) => ({ ...p, [k]: v }));
  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = await authed(`site-profiles/${siteId}`, {
        method: "POST",
        body: JSON.stringify({
          company_name: f.company.trim() || null, address: f.address.trim() || null,
          latitude: toNum(f.latitude), longitude: toNum(f.longitude),
          solar_capacity_kw: toNum(f.solar), connection_voltage_kv: toNum(f.voltage),
          battery_capacity_kwh: toNum(f.battery), pcs_capacity_kw: toNum(f.pcs),
          state: f.state || null, pincode: f.pincode.trim() || null,
          ...Object.fromEntries(COMMS.map((c) => [c.key, !!f.comms[c.key]])),
        }),
      });
      if (!r.ok) throw new Error(await msg(r, "save site detail"));
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-lg mt-10 rounded-xl bg-surface2 border border-line shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <div className="flex items-center gap-2 text-ink font-semibold text-[14px]">
            <MapPin size={16} /> {profile ? "Edit site" : "Register site"} — {siteName}
          </div>
          <button onClick={onClose} className="text-ink3 hover:text-ink"><X size={16} /></button>
        </div>

        <div className="px-4 py-4">
          {err && <div className="text-[12.5px] text-bad mb-3">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Field className="col-span-2" label="Company name" value={f.company} onChange={(v) => set("company", v)} />
            <Field className="col-span-2" label="Address" value={f.address} onChange={(v) => set("address", v)} />
            <Field label="Latitude" value={f.latitude} onChange={(v) => set("latitude", v)} />
            <Field label="Longitude" value={f.longitude} onChange={(v) => set("longitude", v)} />
            <Field label="Solar capacity (kW)" value={f.solar} onChange={(v) => set("solar", v)} />
            <Field label="Connection voltage (kV)" value={f.voltage} onChange={(v) => set("voltage", v)} />
            <Field label="Battery capacity (kWh)" value={f.battery} onChange={(v) => set("battery", v)} />
            <Field label="PCS capacity (kW)" value={f.pcs} onChange={(v) => set("pcs", v)} />
            <label className="block">
              <span className="block text-[11px] text-muted mb-1">State</span>
              <select value={f.state} onChange={(e) => set("state", e.target.value)}
                      className="w-full px-3 py-2 rounded-md bg-surface border border-line text-[13px] text-ink">
                <option value="">{states.length ? "Select a state…" : "—"}</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <Field label="Pincode" value={f.pincode} onChange={(v) => set("pincode", v)} />
            <div className="col-span-2 mt-1">
              <div className="text-[11px] text-muted mb-1.5">Communication mappings</div>
              <div className="flex flex-wrap gap-1.5">
                {COMMS.map((c) => (
                  <button key={c.key} type="button"
                    onClick={() => setF((p) => ({ ...p, comms: { ...p.comms, [c.key]: !p.comms[c.key] } }))}
                    className={`px-2.5 py-1 rounded-md text-[11.5px] border transition-colors ${
                      f.comms[c.key] ? "bg-accent/15 border-accent/40 text-accent" : "bg-surface border-line text-ink3 hover:border-line2"
                    }`}>
                    {f.comms[c.key] ? <Check size={11} className="inline mr-1 -mt-0.5" /> : null}{c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-line">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md border border-line text-[12.5px] text-ink3">Cancel</button>
          <button disabled={busy} onClick={save}
                  className="px-4 py-1.5 rounded-md bg-accent text-white text-[12.5px] font-semibold disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
