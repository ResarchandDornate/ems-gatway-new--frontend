/**
 * Admin → User Monitor (read-only).
 *
 * Self-contained new page. It does NOT use the app's existing session (which targets
 * the current backend); it signs in to EMS-gateway-backend2 on its own via the
 * /api/admin-gw proxy, because only that backend exposes user data:
 *   GET /org/operators          (user:manage)  → { id, phone, email, is_active, site_ids }
 *   GET /admin/organizations    (org:manage)   → orgs + sites + operators (for names)
 * No user is created, deactivated or modified here — monitor only.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, RefreshCw, LogOut, ShieldAlert } from "lucide-react";

const TOKEN_KEY = "ems_admin_token";

type Operator = { id: string; phone: string | null; email: string | null; is_active: boolean; site_ids: string[] };
type Site = { id: string; site_key: string; name: string };
type OrgOperator = { id: string; phone: string | null; email: string | null };
type Org = { id: string; org_key: string; name: string; sites: Site[]; operators: OrgOperator[] };

export default function AdminUsersPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ident, setIdent] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [permNote, setPermNote] = useState("");
  const [operators, setOperators] = useState<Operator[] | null>(null);
  const [orgs, setOrgs] = useState<Org[] | null>(null);

  useEffect(() => { try { setToken(sessionStorage.getItem(TOKEN_KEY)); } catch {} }, []);

  const authed = useCallback(
    (path: string) =>
      fetch(`/api/admin-gw/${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      }),
    [token],
  );

  const logout = useCallback(() => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    setToken(null); setOperators(null); setOrgs(null);
  }, []);

  const login = async () => {
    setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/admin-gw/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: ident.trim(), password: pw }),
      });
      if (!r.ok) { setErr(r.status === 401 ? "Invalid credentials for the admin backend." : `Login failed (${r.status}).`); return; }
      const j = await r.json();
      try { sessionStorage.setItem(TOKEN_KEY, j.access_token); } catch {}
      setPw(""); setToken(j.access_token);
    } catch { setErr("Cannot reach the admin backend (ems-gateway-api)."); }
    finally { setLoading(false); }
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(""); setPermNote("");
    try {
      const [ro, rg] = await Promise.all([authed("org/operators"), authed("admin/organizations")]);
      if (ro.status === 401 || rg.status === 401) { logout(); setErr("Session expired — sign in again."); return; }
      const missing: string[] = [];
      setOperators(ro.ok ? await ro.json() : []);
      if (!ro.ok && ro.status === 403) missing.push("user list (needs user:manage)");
      setOrgs(rg.ok ? await rg.json() : []);
      if (!rg.ok && rg.status === 403) missing.push("organizations (needs org:manage)");
      if (missing.length) setPermNote("This account lacks permission for: " + missing.join(", ") + ".");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load users.");
    } finally { setLoading(false); }
  }, [token, authed, logout]);

  useEffect(() => { if (token) load(); }, [token, load]);

  const siteName = useCallback((id: string) => {
    for (const o of orgs || []) for (const s of o.sites || []) if (s.id === id) return s.name;
    return id.slice(0, 8) + "…";
  }, [orgs]);

  const orgOf = useCallback((opId: string) => {
    for (const o of orgs || []) if ((o.operators || []).some((x) => x.id === opId)) return o.name;
    return "—";
  }, [orgs]);

  const users = useMemo(() => {
    if (operators && operators.length) {
      return operators.map((o) => ({
        id: o.id, email: o.email, phone: o.phone, active: o.is_active as boolean | null,
        sites: (o.site_ids || []).map(siteName), org: orgOf(o.id),
      }));
    }
    const out: { id: string; email: string | null; phone: string | null; active: boolean | null; sites: string[]; org: string }[] = [];
    for (const o of orgs || []) for (const op of o.operators || [])
      out.push({ id: op.id, email: op.email, phone: op.phone, active: null, sites: [], org: o.name });
    return out;
  }, [operators, orgs, siteName, orgOf]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.active === true).length,
    orgs: (orgs || []).length,
    sites: (orgs || []).reduce((a, o) => a + (o.sites?.length || 0), 0),
  }), [users, orgs]);

  if (!token) {
    return (
      <div className="max-w-sm mx-auto mt-16 rounded-xl bg-surface2 border border-line p-6">
        <div className="flex items-center gap-2 mb-1 text-ink font-semibold"><Users size={18} /> User Monitor — Admin</div>
        <p className="text-[12.5px] text-muted mb-4">Sign in to the EMS-gateway backend to view all users. Read-only.</p>
        {err && <div className="text-[12.5px] text-bad mb-2">{err}</div>}
        <label className="block text-[11px] text-muted mb-1">Identifier (email / phone)</label>
        <input value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="username"
               className="w-full mb-3 px-3 py-2 rounded-md bg-surface border border-line text-[13px] text-ink" />
        <label className="block text-[11px] text-muted mb-1">Password</label>
        <input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()}
               type="password" autoComplete="current-password"
               className="w-full mb-4 px-3 py-2 rounded-md bg-surface border border-line text-[13px] text-ink" />
        <button onClick={login} disabled={loading}
                className="w-full py-2 rounded-md bg-accent text-white font-semibold text-[13px] disabled:opacity-60">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-ink font-semibold text-[16px]"><Users size={18} /> User Monitor</div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface2 border border-line text-[12.5px] text-ink3 hover:bg-surface3">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={logout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface2 border border-line text-[12.5px] text-bad hover:bg-bad/10">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      {err && <div className="text-[12.5px] text-bad mb-3">{err}</div>}
      {permNote && (
        <div className="flex items-center gap-2 text-[12.5px] text-warn bg-warn/10 border border-warn/30 rounded-md px-3 py-2 mb-3">
          <ShieldAlert size={14} /> {permNote}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Total users" value={stats.total} />
        <Stat label="Active" value={stats.active} />
        <Stat label="Organizations" value={stats.orgs} />
        <Stat label="Sites" value={stats.sites} />
      </div>

      <div className="rounded-xl bg-surface2 border border-line overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-muted bg-surface3">
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Sites</th>
              <th className="px-3 py-2 font-medium">Organization</th>
            </tr>
          </thead>
          <tbody>
            {loading && !users.length ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Loading…</td></tr>
            ) : !users.length ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No users found.</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-3 py-2 text-ink">{u.email || <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">{u.phone || <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">
                  {u.active === null ? <span className="text-muted">—</span>
                    : u.active ? <span className="px-2 py-0.5 rounded-full bg-good/15 text-good">Active</span>
                    : <span className="px-2 py-0.5 rounded-full bg-bad/15 text-bad">Inactive</span>}
                </td>
                <td className="px-3 py-2">{u.sites.length ? u.sites.join(", ") : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">{u.org}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
