"use client";

/**
 * Sign in to the gateway.
 *
 * Each person uses their own gateway account. This app holds no credentials of
 * its own and the proxy behind it holds none either — what the account can see
 * is the gateway's decision, which is the only place it can honestly be made.
 */

import { useState, type FormEvent } from "react";
import { LockKeyhole, TriangleAlert } from "lucide-react";

import { login, LoginError } from "../gateway/auth";
import { apiBase } from "../gateway/config";
import { PrimaryButton } from "../components";

/**
 * The host this build talks to, or null when there is nothing to name.
 *
 * Host only — the scheme and any path are noise at this size.
 *
 * Null on the web build, where apiBase() is "" because the app is served by
 * the same origin as its proxy. That case used to print "same origin", which
 * is a true statement and a useless one: it named no host, answered no
 * question a customer has, and was the only lowercase monospace text on an
 * otherwise composed screen. The line exists for the packaged build, where
 * there IS an address and it is invisible — see the call site.
 */
function backendLabel(): string | null {
  const base = apiBase();
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;
  const backend = backendLabel();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      /* No navigation here. The shell subscribes to the session and swaps this
         screen out the moment one exists, so routing from inside the form would
         be a second source of truth for the same fact. */
    } catch (err) {
      setError(
        err instanceof LoginError
          ? err.message
          : "Could not reach the gateway. Check the connection and try again.",
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="m-login">
      <div className="m-login-mark" aria-hidden>
        <LockKeyhole size={22} strokeWidth={1.7} />
      </div>

      <h1 className="m-login-title">UnityESS</h1>
      <p className="m-login-sub">
        Sign in with your gateway account to see your site.
      </p>

      <form className="m-login-form" onSubmit={onSubmit}>
        <label className="m-field">
          <span className="m-field-label">Username</span>
          <input
            className="m-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            required
          />
        </label>

        <label className="m-field">
          <span className="m-field-label">Password</span>
          <input
            className="m-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            required
          />
        </label>

        {/* role="alert" so a screen reader announces a failed attempt rather
            than leaving the user waiting on a form that looks unchanged. */}
        {error && (
          <p className="m-login-error" role="alert">
            <TriangleAlert size={15} />
            <span>{error}</span>
          </p>
        )}

        <PrimaryButton type="submit" full disabled={!canSubmit}>
          {busy ? "Signing in…" : "Sign in"}
        </PrimaryButton>
      </form>

      <p className="m-login-foot">
        Accounts are issued per site by whoever commissioned it. This app cannot
        create or reset them.
      </p>

      {/* Which backend this build talks to, when that is a question.

          A packaged app carries its server address baked in at build time, and
          nothing on screen used to reveal it — so an app pointed at a stale
          host looked exactly like an app that could not connect, and the only
          way to tell them apart was to decompile the APK. Naming it here makes
          a wrong build obvious in a screenshot.

          None of which applies to the web build, which is served by the same
          origin as its proxy and has no baked-in address to be wrong about. It
          printed "same origin" there — a technically accurate answer to a
          question nobody asked. Shown only where it can actually identify a
          build. */}
      {backend && (
        <p className="m-login-host" title={backend}>{backend}</p>
      )}
    </div>
  );
}
