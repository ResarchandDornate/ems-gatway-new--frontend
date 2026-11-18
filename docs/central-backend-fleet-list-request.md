# Request — fleet list endpoints (`GET /gateways`, `GET /sites`)

**To:** Central EMS Backend team
**From:** EMS frontend
**Date:** 24 September 2026
**Re:** the one thing now blocking the dashboard

Thank you for S1 — `GET /gateways/{gateway_id}/fast-bess` is live and wired in
as the website's **Live BESS** screen. It works, and it is the first plant
measurement the site has rendered since we moved off the NorthBound gateway.
What shipped against what we asked for is recorded in the addendum to
`docs/central-backend-s1-contract.md`.

This is a much smaller request than that memo. It is one endpoint family, and
it is now the single thing standing between you and a working dashboard.

---

## 1. Why this is urgent, and why S1 made it more so, not less

**There is no way to discover a gateway id.** Both endpoints that return real
data are addressed by one:

```
GET /api/v1/gateways/{gateway_id}/health
GET /api/v1/gateways/{gateway_id}/fast-bess
```

Nothing in the API lists gateways. The only id we hold came from decoding the
`sub` claim of a gateway JWT that was pasted to us in chat. The website
currently carries it in an environment variable,
`NEXT_PUBLIC_CENTRAL_GATEWAY_ID`, because there is nothing to build a picker
from — which means one gateway, hardcoded per deployment, and a redeploy to
change it.

**And a per-gateway endpoint cannot fill a portfolio view.** The dashboard's
job is the fleet: totals across sites, a station picker, and markers on the
map. No amount of fast-BESS data answers "which sites exist", so those screens
render zero no matter how well S1 works.

---

## 2. `GET /gateways` — the minimum that unblocks us

The smaller and more urgent of the two. Enough to populate a picker and to stop
hardcoding an id:

```jsonc
[
  {
    "gateway_id": "bd57016e-9a31-4ed9-b107-018c36d33bc7",
    "name": "Lanka, Assam — cabinet 1",   // human-readable, for the picker
    "site_id": "...",                      // null until sites exist is fine
    "last_seen_utc": "2026-09-24T12:04:03Z",
    "online": true
  }
]
```

`gateway_id` and a display name are the load-bearing fields. `last_seen_utc`
and `online` let the picker grey out a gateway that has stopped reporting
rather than offering it as if it were live.

**If only one thing ships from this memo, make it this.** It is the difference
between a screen that works for one hardcoded gateway and one that works for
the fleet.

---

## 3. `GET /sites` — and please include coordinates

What the dashboard needs per site. The shape below mirrors the UI type it
feeds (`StationSummary` in `lib/api/types/index.ts`):

```jsonc
[
  {
    "site_id": "...",
    "name": "Dalmia Cement · Lanka",
    "location": "Lanka, Assam",
    "latitude": 26.4,        // <- see below
    "longitude": 92.9,
    "installed_kw": 500,
    "capacity_kwh": 1045,
    "gateway_ids": ["bd57016e-..."],
    "bess_ids": ["bess_1"]
  }
]
```

**Coordinates are the ask worth singling out.** The previous backend returned
none, so the website carries a hand-maintained lookup table of ten
latitude/longitude pairs keyed by station id (`GEO_LOOKUP` in
`components/dashboard/GroupScreen.tsx`), with a comment explaining that a
station missing from it falls back to the centre of the country rather than
vanishing. Every new site therefore needs a **frontend code change and a
deploy** before it appears on the map. Two numbers per site in this response
retires that table permanently.

`installed_kw` and `capacity_kwh` drive the portfolio tiles and size the map
markers.

---

## 4. What this unblocks — and what it still will not

Stated plainly so this is not mistaken for the last piece.

**Unblocked by fleet list alone:** the station picker, the map markers, the
Live BESS and Gateway Health screens working across the fleet instead of one
hardcoded id, and per-site navigation.

**Still empty afterwards:** the dashboard's headline tiles — Charging Capacity,
Discharge Capacity, Cumulative Revenue — are *energy* totals over a financial
year. Fast-BESS is instantaneous power at 1 Hz with a reachable window of about
16.7 minutes, so those figures cannot be derived from it at any sampling rate.
They need either energy counters per site or the aggregated history endpoint in
§3 of the S1 memo.

We are not asking for that here. We are flagging it so the dashboard still
reading zero after this ships is expected rather than a surprise.

---

## 5. Suggested order

1. **`GET /gateways`** — unblocks the two working screens across the fleet.
2. **`GET /sites`** with coordinates — unblocks the map and the picker.
3. Per-signal quality (S1 memo §1) — today a stale register is
   indistinguishable from a live one; `bad_signal_count` says how many, never
   which.
4. Aggregated history (S1 memo §3) — and the energy totals above.

Happy to review a draft response shape before it is built, as with S1. Getting
the vocabulary right the first time is what made that one drop in cleanly.
