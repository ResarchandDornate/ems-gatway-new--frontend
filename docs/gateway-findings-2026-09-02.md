# NorthBound EMS Gateway — findings report

Nine findings from the live API, checked against the handover package of
10 August 2026.

| | |
|---|---|
| **Date** | 2 September 2026 |
| **Gateway** | `ems-api.unityess.cloud` |
| **Sources** | `external_ems_1`, `external_ems_2` |
| **From** | Ornate Agencies Pvt. Ltd. — UnityESS mobile |
| **Method** | Authenticated GET requests against the running gateway |

---

## 1. Summary

Nine items follow. Four are software defects on the gateway, one is an
access-control concern, one is a commissioning question, one is an operational
fault at the site, and two are questions we need answered rather than problems
to fix. Every figure quoted was read from the running system and can be
reproduced.

**Three warrant priority.** Finding 2, because it makes the alarm endpoint
unusable for every consumer. Finding 6, because it affects billing-relevant
counters. Finding 8, because a single register has failed to poll 181,744 times
and closes the Modbus connection on each attempt.

| # | Finding | Kind |
|---|---|---|
| 2 | Protection limits reported as active alarms | Defect — priority |
| 3 | Negative cooling values wrap to ~6553 | Defect |
| 4 | BMS protection thresholds read 0.00 | Commissioning |
| 5 | Utility meter not communicating | Operational |
| 6 | Yearly energy counters word-swapped | Defect — priority |
| 7 | Fire panel temperature reads 69 | Question |
| 8 | 181,744 failed polls of one register | Defect — priority |
| 9 | Customer accounts can read the audit log | Access control |
| 10 | Sustainable concurrent load, and a bulk export | Question |

---

## 2. Protection limits are reported as active alarms

**Defect · priority**

`/api/alarms` returns **149 active alarms** for this site. One hundred and
forty-eight of them are protection limit registers holding their correct
commissioned values. Exactly one is a genuine asserted state.

```
rack_cell_over_voltage_l3_alarm_limit_early_warning          = 3500    mV
rack_cell_under_voltage_l3_alarm_limit_early_warning         = 2900    mV
rack_total_voltage_over_voltage_l3_alarm_limit_early_warning = 910     V
rack_charge_over_current_l3_alarm_limit_early_warning        = 226.1   A
```

Those are correct settings for this pack. They are raised as alarms because
they carry a non-zero value. The single real alarm,
`external_ems_2_dehumidifier.alarm_status = 1`, is indistinguishable among them.

The consequence for any consumer — our application, SCADA, or the server
historian your handover asks the IT team to build — is a permanent report of
149 active alarms on a healthy plant. After the first look nobody trusts the
count, and the one thing genuinely wrong is invisible.

> **Suggested fix.** Exclude limit registers from the alarm engine. Your
> dictionary already carries the discriminator: a genuine alarm bit has an
> empty `unit` and an enum in `notes`, while a setpoint carries an engineering
> unit and no enum. Filtering on that removes all 148 and keeps the one.
>
> We have added a client-side filter so our screen reads 1 rather than 149, but
> that is a workaround over a server defect and every other integrator will have
> to reinvent it.

---

## 3. Negative liquid-cooling values decode as unsigned

**Defect**

Three `liquid_cooling` signals return approximately 6553 whenever the true value
is negative — a signed/unsigned error on a 16-bit register with a 0.1 factor.
Two readings taken twenty minutes apart:

```
Reading A   inlet 0.6 bar, outlet 1.3 bar   true difference -0.7
            inlet_outlet_water_pressure_diff = 6552.9
            (65536 - 7) / 10                 = 6552.9    exact

Reading B   inlet 0.7 bar, outlet 1.0 bar   true difference -0.3
            inlet_outlet_water_pressure_diff = 6553.3
            (65536 - 3) / 10                 = 6553.3    exact
```

The same signature appears on `system_heating_demand` (6353.6, true −182.4) and
`system_cooling_demand` (6443.6, true −92.4). We later observed
`system_cooling_demand` at 80.0, decoding correctly — which confirms the signal
is sound when positive and wraps only when negative.

Separately, the dictionary types both demand signals as `degC`, which given the
values they carry appears incorrect and is worth confirming alongside the
decode.

> **Suggested fix.** Decode these registers as signed `int16` before applying
> the factor, and audit the map for others that can legitimately go negative —
> pressure differentials, demands, and any bidirectional power or current
> signal.

---

## 4. BMS protection thresholds all read 0.00

**Commissioning question**

Four battery protection setpoints report zero on both sources:

```
battery_pack_over_voltage_alarm_voltage_value       0.00  V
battery_pack_under_voltage_alarm_voltage_value      0.00  V
battery_charge_over_current_alarm_current_value     0.00  A
battery_discharge_over_current_alarm_current_value  0.00  A
```

An over-voltage alarm threshold of zero volts is not a protection limit. The
read path is demonstrably working, because the liquid cooling thresholds on the
same gateway are properly commissioned — 40 degC and 5 degC outlet temperature,
2.9 and 0.3 bar pressure. The rack-level limits in finding 2 are populated as
well, so it is these four pack-level registers specifically that are empty.

> **Question.** Are these four mapped correctly, and should they carry
> commissioned values? If protection is configured elsewhere and these are
> vestigial, marking them as such in the dictionary would stop integrators
> reading them as live limits.

---

## 5. The utility meter is not communicating

**Operational**

Not a software defect, but it affects every consumer and it fails silently.

```
external_ems_1_grid_meter   communication_status = 0

  total_active_power            0.0  kW
  frequency                     0.0  Hz
  total_power_factor            0.0
  forward_total_active_energy   0.0  kWh
  reverse_total_active_energy   0.0  kWh
                                ... all 69 signals return 0
```

Zero is a legitimate reading here — an idle plant really can import 0.0 kW — so
a dead meter and a quiet grid are indistinguishable unless
`communication_status` is checked first. We observed our own dashboard
displaying "0.0 kW, importing" while the battery beside it charged at 58.4 kW.

Note also that the asset list reports `online: true` for this meter, because the
gateway's own Modbus polling succeeds. The meter behind it is what is not
answering. Those are two different facts and it would help if the API kept them
distinct.

> **Two asks.** The meter needs attention on site: with it down there is no grid
> power, no power factor and no import or export energy anywhere in the system.
>
> And consider returning null, or omitting the signals, for a non-communicating
> asset rather than zeros, so consumers cannot read them as measurements.

---

## 6. Yearly energy counters return their words swapped

**Defect · priority**

The BMS yearly cumulative energy registers return values around 223 million
kWh — from a 130 kW inverter.

```
yearly_cumulative_charge_energy      223,543,296 kWh
yearly_cumulative_discharge_energy   203,882,496 kWh

223,543,296 / 65536 = 3411   remainder 0
203,882,496 / 65536 = 3111   remainder 0
```

Both are exact multiples of 65536 with zero remainder: a 32-bit value assembled
with its high and low words transposed. The corrected figures, 3,411 and
3,111 kWh, are consistent with the inverter's own lifetime AC counters on the
same asset, which decode correctly at 3,705 and 4,035 kWh.

These are billing-relevant counters. A figure five orders of magnitude too large
is caught by eye; a word-swap on a register whose true value happens to be small
will not be.

> **Suggested fix.** Correct the word order for these registers and audit the
> map for the same pattern. We have removed the yearly figures from our own
> screens rather than dividing by 65536 locally — if you fix the word order, a
> client-side correction silently becomes the defect.

---

## 7. The fire panel reports a temperature of 69

**Question**

The fire protection panel is online and reporting clean: every alarm and fault
bit clear, which is the right answer. One value stands out.

```
external_ems_1_fire_protection   communication_status = 1
  fire_alarm              0   No fire alarm
  fault                   0   No fault
  fire_alarm_temperature  0   Normal
  temperature_value      69   dictionary unit: degC
```

69 degC is high for a container ambient, and the panel's own heat detector is
not asserting against it. Most likely a scaling or unit question rather than a
hot spot — but the two readings disagree, and we would rather ask than assume.

> **Question.** Is `temperature_value` scaled correctly, and what is it
> measuring — container ambient, or something internal to the panel?

---

## 8. One register has failed to poll 181,744 times

**Defect · priority**

`/api/logs/summary` reports 182,835 events on this gateway. **181,744 of them,
or 99.4%, are the same failure.**

```
by_severity     warning 181,754    info 1,081
by_event_type   poll_point_failed           181,744
by_asset_id     external_ems_1_ems_system   121,723
                external_ems_2_ems_system    59,990
```

The failure itself:

```
Failed reading external_ems_1.ems_system.available_count:
Modbus Error: [Connection] ModbusTcpClient 192.168.100.151:502:
Connection unexpectedly closed 0.002 seconds into read of unbounded
read bytes without response from device before it closed connection

payload:  { address: 0, point_name: "Available Count" }
```

It is the same point on both EMS units, at Modbus address 0, and the device
closes the connection rather than answering.

Three reasons this is worth fixing rather than filtering. Each failure *closes
the Modbus connection*, so whatever the poller intended to read next in that
cycle pays for it — the cost is unlikely to be confined to this one point. It
makes the event log unusable, since any real event is one row in twenty
thousand. And it has run long enough to store 181,744 rows.

> **Suggested fix.** Check the `available_count` mapping on `ems_system`.
> Address 0 with an unbounded read looks like an unset register; if the point
> does not exist on these units it should leave the poll set rather than being
> retried indefinitely.

---

## 9. A customer account can read the authentication audit log

**Access control**

We read `/api/logs/summary` and `/api/logs` with an ordinary site account —
username `customer`, which `/api/auth/me` reports as role `customer_admin`.
Both returned in full, including the recent-events block:

```
event_type  auth_login_success
payload     { client:   "103.211.52.244",
              username: "customer",
              role:     "customer_admin" }
```

Any account that can sign in can therefore enumerate who else has signed in,
when, from which IP address, and with what role — including failed attempts. On
a multi-tenant or multi-operator site that is other people's data.

It is also why we will not be surfacing the event log in our customer
application, which we had intended to do. There is no way to show it without
showing that.

> **Suggested fix.** Treat `/api/logs*` as internal_admin, alongside the control
> endpoints. If customer-visible history is wanted later, a filtered view
> excluding `source: auth` and dropping the `payload` block would be safe to
> expose.

---

## 10. Sustainable concurrent load, and a bulk export

**Question**

Not a defect report. The cause here turned out to be at our end, and we are
recording it because the answer needs to come from you and because the next
integrator will meet it too.

We measured the cached-snapshot endpoints degrading badly under sustained
historian load: `/api/fast-bess/latest` taking 32 to 80 seconds against a
sub-second baseline, `/api/health` 25.5 seconds, `/api/telemetry` 21.2 seconds.

**The load was ours.** We run a worker that walks thirty days of one-second
history to pre-fill a local store, pausing one second between reads. That pacing
assumed a read completes quickly; on this board a historian read takes forty to
a hundred seconds, so the walker ran essentially continuously and everything
else queued behind it. We have corrected it — it now stands aside for any
request a person is waiting on — and no change is needed from you for that part.
We would rather tell you than have you chase a phantom capacity problem.

### What would help

- **A documented concurrency and rate ceiling.** The API Reference states none.
  We have been guessing, and guessed badly.
- **Whether historian reads and cached-snapshot reads contend** for the same
  resource on the board, or whether we simply asked too fast.
- **Whether a bulk or ranged export exists, or could.** Walking thirty days one
  chunk at a time over the live API is the wrong shape for the job; a single
  ranged read would remove the contention rather than pacing around it.
- **Twelve signals promoted to `key_signal`** — listed below.

### The key-signal set

We poll `/api/telemetry` every fifteen seconds. It returns 798 KB and 1,422
signals, of which we read about thirty. `/api/telemetry/key-signals`, which your
inventory marks "recommended for server integration", returns the same structure
in 495 KB and 6.2 seconds instead of 798 KB and 10.2 seconds. We would move to it
today except that it omits twelve signals we display:

```
ems_system       load_power                    Site load, on the home screen
ems_system       demand                        Demand
pcs_1            rated_power                   Bounds the dispatch control

liquid_cooling   inlet_water_temperature       Without these six there is
liquid_cooling   outlet_water_temperature      nothing to show for the
liquid_cooling   inlet_water_pressure          cooling system at all
liquid_cooling   outlet_water_pressure
liquid_cooling   outdoor_temperature
liquid_cooling   cooling_set_temperature
liquid_cooling   heating_set_temperature
liquid_cooling   power_on_off

fire_protection  temperature_value             Panel temperature
```

We checked the alternatives before asking. `compact=true` and `format=compact`
are accepted on `/api/telemetry` and change nothing — the payload is
byte-for-byte the same 798 KB with all fourteen metadata fields per signal.
Fetching the six assets we need individually is worse: 690 KB across six round
trips taking 61 seconds, against 798 KB in one.

> **In short.** Promoting those twelve is the single change that would most
> reduce our recurring load on the board. Site load, demand, inverter rating and
> coolant temperatures are what an operator looks at; we would suggest they
> belong in a key-signal set on the merits, not only for our convenience.

---

## Appendix A. Note on asset identifiers

One thing that cost us time and will cost the next integrator the same: runtime
asset IDs do not map predictably to the dictionary's `base_asset_id`.

```
runtime id                          dictionary base_asset_id
external_ems_1_grid_meter      ->   utility_meter
external_ems_1_bms             ->   bms_1
external_ems_1_pcs             ->   pcs_1
external_ems_1_fire_protection ->   fire_protection      (matches)
```

Stripping the source prefix works for some assets and not others, so the mapping
has to come from each node's own `base_asset_id` field. That field is present and
correct in the telemetry response — it is simply not something the naming lets
you guess. Worth a line in the API reference.

---

All values were read from the live gateway on 2 September 2026 via authenticated
GET requests, and cross-checked against the Telemetry Data Dictionary, the API
inventory and the 63-signal profile in the handover package dated 10 August 2026.
Signal names and units are quoted as the gateway and its dictionary report them.
We are glad to supply the raw captures behind any of these, or to re-run the
checks once fixes land.
