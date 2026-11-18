# Tag Migration Mapping — UGX Telemetry Keys → Kinetics BESS Gateway Point Keys

**Status:** v2. Documentation only — no application code has been changed.

**Sources**
- `Kinetics_BESS_Gateway_API_Inventory_Phase1_6_20260805.csv` — 65 endpoints
- `Kinetics_BESS_Gateway_Telemetry_Data_Dictionary_Phase1_6_20260805.pdf` — 1012 point definitions
- Both cite `kinetics_gateway_v2(1).zip: app/api/routes.py` as source of truth.

**Companion file:** [`kinetics-telemetry-catalog.csv`](./kinetics-telemetry-catalog.csv) — all 1012 definitions extracted from the PDF (key, name, type, unit_raw + resolved unit, address, access, poll class, scale, range, status). Every claim in this document is checkable against it.

**Current code (unchanged):** `lib/api/adapters/pcs.ts`, `lib/api/adapters/bms.ts`, `lib/api/ugx.ts`

Extraction was verified against the dictionary's own stated totals: **1012 rows = 724 BMS (188 bank + 390 rack + 146 environment) + 288 PCS.** 952 are `implemented`; 60 are `catalogued_reserved_not_normally_exposed`.

---

## 1. What actually changes

Not a rename — the two systems differ in shape.

| | Today — UGX / ThingsBoard | Target — Kinetics Gateway |
|---|---|---|
| Data model | flat telemetry keys per device | catalogued points under an asset tree |
| Read | `GET …/values/timeseries?keys=stack_volt,…` | `GET /api/bms/bank`, `GET /api/pcs/{asset_id}` |
| Auth header | `X-Authorization: Bearer <jwt>` | `Authorization: Bearer <jwt>` |
| Cell reads | 384 × `cel_volt_N`, batched 192/request | one call: `GET /api/bms/racks/{rack_id}/details` |
| Live updates | repeated polling | `WS /ws/telemetry` delta stream |
| Scaling | pre-scaled | **raw Modbus registers — scale applied client-side** |

### JSON envelope

```
assets.{asset_id}.telemetry.{point_key}.value
```

Value sits under `value`; `raw`, `quality`, `unit` and enum metadata may accompany it. **Values can be `null`** when an asset is offline or a Modbus read fails — every field below is nullable. Asset ids are templates (`{bms_bank_asset}`, `{bms_rack_asset}`, `{pcs_asset}`); `bms_environment` is a literal id. Applicability: BMS bank/BAU, **four** racks/BCUs, power environment, **PCS 1–4**.

### Scale factors are mandatory

`bank_voltage` is `U16 scale 0.1` — register `7482` means **748.2 V**. `power_factor` is `scale 0.001`; `grid_frequency` is `scale 0.01`. Points with `scale -` are already in engineering units.

### Unit glyphs mangled by PDF extraction

The PDF's symbol font didn't round-trip — notably `Ω` renders as `W`. In the companion CSV, `unit_raw` is verbatim and `unit` is the resolved reading below.

| Extracted | Actual | Appears on |
|---|---|---|
| `n` | `°C` | all temperatures (153 points) |
| `mW` | `mΩ` | `clu_resistance` (rack DCR) |
| `W/V` | `Ω/V` | 8 `low_ir_*` insulation-resistance alarm thresholds |
| `\211` | `‰` | rack `soc`, `soh`, `rack_inner_soc` |
| `Hex` | bitfield | 65 status/alarm words |
| `Kvar` / `KVA` | `kVar` / `kVA` | PCS + meter power |

> **`kW` is genuinely ambiguous and cannot be resolved by unit alone.** Because `Ω`→`W`, the glyph `kW` covers both real kilowatts and kilo-ohms. It must be disambiguated per key:
>
> | Resolves to | Keys |
> |---|---|
> | **kΩ** (insulation / impedance) | `ir` (bank 0x2006, rack 0x0237), `ir_pos` (0x0238), `ir_neg` (0x0239), `battery_positive_ground_impedance` (0x1120), `battery_negative_ground_impedance` (0x1121) |
> | **kW** (real power) | `grid_active_power`, `dc_power`, `bank_chgable_power`, `bank_dsgable_power`, `essmeter_1_11..14` |
> | **unverified** | `reg_1409`, `reg_1416`, `reg_1634` — unnamed raw-only registers; marked `kW?` in the CSV, do not surface |
>
> This matters directly: a search for "power registers" by unit returns the five impedance points, and treating insulation resistance as power would be badly wrong. It is also why §9 item 1 concludes there is no bank power register — the bank's only `kW`-glyph points are two limits and one insulation reading.

---

## 2. BMS bank/stack — replaces `stack_*`

`GET /api/bms/bank` (`include_slow` optional). Path prefix `assets.{bms_bank_asset}.telemetry.`

| Current UGX key | Kinetics key | Name | Type | Unit | Addr | Scale | Notes |
|---|---|---|---|---|---|---|---|
| `stack_volt` | `bank_voltage` | Bank Voltage | U16 | V | 0x2001 | 0.1 | |
| `stack_curr` | `ibank` | Bank Curr | S32 | A | 0x2002 | 0.1 | Signed. UGX gave mA; code divides by 1000 — **remove that divide**. |
| `stack_soc` | `soc` | SOC | U16 | % | 0x2004 | 0.1 | |
| `stack_soh` | `bank_soh` | SOH | U16 | % | 0x2005 | 0.1 | |
| `stack_max_volt` | `vcell_max` | Vcell_max | U16 | mV | 0x2010 | — | **Already mV** — remove the `×1000`. |
| `stack_min_volt` | `vcell_min` | Vcell_min | U16 | mV | 0x2014 | — | Already mV. |
| — | `vavg` | Vcell_avg | U16 | mV | 0x2015 | — | Fills "Avg Cell Volt", currently `—`. |
| `stack_max_temp` | `tcell_max` | Tcell_max | S16 | °C | 0x2019 | 0.1 | |
| `stack_min_temp` | `tcell_min` | Tcell_min | S16 | °C | 0x201D | 0.1 | |
| `stack_ave_temp` | `tavg` | Tcell_avg | S16 | °C | 0x201E | 0.1 | |
| `arrcap` | `echg_avl` / `edsg_avl` | E_chargable / E_dischargable | U16 | kWh | 0x2007 / 0x2008 | — | Real readings; replaces the `arrcap×0.1×SOC%` estimate. |
| `daily_cha_cap` | `bank_today_chg_energy` | Today Chg Cum Cap | U16 | kWh | 0x2029 | — | Direct kWh; drop the `×0.1`. |
| `daily_dis_cap` | `bank_today_dsg_energy` | Today Dsg Cum Cap | U16 | kWh | 0x2028 | — | Direct kWh; drop the `×0.1`. |
| `max_temp_no` | `tcell_max_rack`/`_pack`/`_position` | Bank Max Temp locators | U16 | — | 0x2016–18 | — | Three-level locator, not one number. |
| `min_temp_no` | `tcell_min_rack`/`_pack`/`_position` | | U16 | — | 0x201A–1C | — | |
| `max_volt_no` | `vcell_max_rack`/`_pack`/`_position` | | U16 | — | 0x200D–0F | — | |
| `min_volt_rack_no` | `vcell_min_rack`/`_pack`/`_position` | | U16 | — | 0x2011–13 | — | |
| `stack_power` | *(none)* | — | — | — | — | — | See §7 — but §5 has a better answer than deriving it. |

**New at bank level** — replaces hardcoded zeros:

| Key | Name | Unit | Addr | Replaces |
|---|---|---|---|---|
| `bank_chgable_power` | Bank Chg Power Limit | kW | 0x2027 | `maxChargeablePowerKw: 0` |
| `bank_dsgable_power` | BankDsg Power Limit | kW | 0x2026 | `maxDischargePowerKw: 0` |
| `ibank_chg_lim` / `ibank_dsg_lim` | I_chg/dsg_limit | A | 0x2009 / 0x200A | — (scale 0.1) |
| `grid_connect_clu_num` | Conn Racks | — | 0x2023 | — |
| `system_total_racks` | System Total Racks | — | 0x2024 | assuming one rack |
| `vrack_diff` / `irack_diff` | Max Vrack / IRack Diff | V / A | 0x200C / 0x200B | scale 0.1 |
| `bank_echg_cum` / `bank_edsg_cum` | E_chg/dsg_sum | kWh | 0x201F / 0x2021 | U32 lifetime |
| `month_echg_cum` / `year_echg_cum` | Month / Year cum | kWh | 0x202A / 0x202E | U32 |

---

## 3. BMS rack — replaces `rack_*`

`GET /api/bms/racks`, `GET /api/bms/racks/{rack_id}` (**int**), `GET /api/bms/racks/summary`. Prefix `assets.{bms_rack_asset}.telemetry.`

| Current UGX key | Kinetics key | Name | Type | Unit | Addr | Scale | Range |
|---|---|---|---|---|---|---|---|
| `rack_volt` | `vrack` | Rack Voltage | S16 | V | 0x0231 | 0.1 | −20000~20000 |
| `rack_curr` | `irack` | Rack Current | S16 | A | 0x0232 | 0.1 | −6000~6000 |
| `rack_soc` | `soc` | SOC | U16 | ‰ | 0x0227 | — | 0~1000 |
| `rack_soh` | `soh` | SOH | U16 | ‰ | 0x0228 | — | 0~1000 |
| `rack_max_volt` | `vcell_max` | Vcell_max | S16 | mV | 0x0210 | 1.0 | −5000~5000 |
| `rack_min_volt` | `vcell_min` | Vcell_min | S16 | mV | 0x0214 | 1.0 | −5000~5000 |
| — | `vcell_avg` | Vcell_avg | S16 | mV | 0x0219 | 1.0 | |
| — | `vcell_diff` | Vcell_diff | U16 | mV | 0x0218 | 1.0 | spread computed in UI today |
| `rack_max_temp` | `tcell_max` | Tcell_max | S16 | °C | 0x021A | 0.1 | −400~1400 |
| `rack_min_temp` | `tcell_min` | Tcell_min | S16 | °C | 0x021E | 0.1 | −400~1400 |
| — | `tcell_avg` | Tcell_avg | S16 | °C | 0x0222 | 0.1 | |
| — | `max_bat_temp_diff` | max_bat_temp_diff | U16 | °C | 0x0229 | 0.1 | direct; UI computes max−min today |
| — | `rack_inner_soc` | Inner SOC | U16 | ‰ | 0x022E | — | 0~1000 |
| — | `clu_resistance` | Rack Inner DCR | U16 | mΩ | 0x0245 | — | |
| `rack_power` | *(none)* | — | — | — | — | — | See §7 |

Locators (fill the `Max Cell Num` / `Min Temp Num` tiles that render `--`): `vcell_max_num`/`_pack`/`_position` 0x0211–13, `vcell_min_*` 0x0215–17, `tcell_max_*` 0x021B–1D, `tcell_min_*` 0x021F–21.

Also: `pdu_max_temp` (0x023B) and `pdu_temp1..4` (0x023C–3F), all S16 °C scale 0.1; `tterm_max` (0x0223); `irack_chg_limit`/`irack_dsg_limit` (0x0225/26, A, scale 0.1).

### The ‰ question is now settled

Rack `soc`/`soh` are `U16`, `scale -`, range `[0~1000]`, unit glyph `‰`. The alarm-threshold parameters in the same section — `low_soc_lvl1/2/3_alarm` (0x6011, 0x6033, 0x6055) — are unit `%` with range `[0~100]`. A measured value ranging to 1000 against thresholds ranging to 100 means the measurement is **tenths of a percent**: divide by 10. Bank `soc` differs — it is `%` with `scale 0.1`, arriving at the same resolution by a different route. Still worth one live spot-check, but the internal evidence is consistent.

---

## 4. Cells — replaces `cel_volt_N` / `cel_soc_N` / `pole_temp_P`

`GET /api/bms/racks/{rack_id}/details`. Poll class `bulk`.

| Current UGX key | Kinetics key | Name | Type | Unit | Addr | Scale | Range |
|---|---|---|---|---|---|---|---|
| `cel_volt_1..384` | `vcell` | Cell Voltege *(sic)* | S16 | mV | 0x1401 | 1.0 | −5000~5000 |
| `pole_temp_1..24` | `tcell` | Cell Temperature | S16 | °C | 0x1801 | 0.1 | −400~1400 |
| `cel_soc_1..384` | **none** | — | — | — | — | — | no per-cell SOC register exists |

Structural consequences:

1. **`vcell`/`tcell` are array points** — one register block per rack, not 384 discrete keys. `fetchLatestBatched` and its 192-key batching become unnecessary.
2. **Per-cell temperature becomes real.** Today `pole_temp_P` is one probe per 16 cells and the adapter copies that value across all 16. `tcell` is per-cell.
3. **Per-cell SOC does not exist in this protocol.** Verified by scanning all 1012 rows: the only SOC points are bank `soc`, rack `soc`, `rack_inner_soc`, and the `low_soc_*` alarm thresholds. This confirms the `maxCellSocPct`/`minCellSocPct` → `null` change already made in `bms.ts`, and means the Cell table's SOC column should be **removed**, not filled.

Extra per-cell detail with no UGX equivalent: `tterm_pos` (0x2201), `tterm_neg` (0x2281), `copper_temp` Busbar Temp (0x2301), `coolant_temp` (0x2381) — S16 °C scale 0.1.

---

## 5. PCS — replaces `*_inv_N`

`GET /api/pcs/all`, `GET /api/pcs/{asset_id}`. Prefix `assets.{pcs_asset}.telemetry.`

Nearly every PCS field the UI renders as `--` has a real register.

| Current UGX key | Kinetics key | Name | Type | Unit | Addr | Scale |
|---|---|---|---|---|---|---|
| `kW_inv_N` | `grid_active_power` | Grid active power | S16 | kW | 0x110D | 0.1 |
| *(computed √(S²−P²))* | `grid_reactive_power` | Grid reactive power | S16 | kVar | 0x110E | 0.1 |
| *(computed)* | `grid_apparent_power` | Grid apparent power | S16 | kVA | 0x110F | 0.1 |
| *(mislabelled `efficiency`)* | `power_factor` | Power factor | S16 | — | 0x110B | **0.001** |
| `Vr_inv_N`/`V_rn_inv_N` | `grid_ab_voltage` | Grid AB line voltage | S16 | V | 0x1105 | 0.1 |
| `Vy_inv_N`/`V_yn_inv_N` | `grid_bc_voltage` | Grid BC line voltage | S16 | V | 0x1106 | 0.1 |
| `Vb_inv_N`/`V_bn_inv_N` | `grid_ca_voltage` | Grid CA line voltage | S16 | V | 0x1107 | 0.1 |
| `Ir_inv_N` | `grid_a_current` | Grid phase A current | S16 | A | 0x1108 | 0.1 |
| `Iy_inv_N` | `grid_b_current` | Grid phase B current | S16 | A | 0x1109 | 0.1 |
| `Ib_inv_N` | `grid_c_current` | Grid phase C current | S16 | A | 0x110A | 0.1 |
| `Hz_grid_1` | `grid_frequency` | Grid frequency | S16 | Hz | 0x110C | **0.01** |
| `kW_dc_inv_N` | `dc_power` | DC power | S16 | kW | 0x1104 | 0.1 |
| — (was `0`) | `dc_bus_voltage` | DC bus voltage | S16 | V | 0x1100 | 0.1 |
| — (was `0`) | `dc_bus_current` | DC bus current | S16 | A | 0x1101 | 0.1 |
| — (was `null`) | `igbt_a_temperature` | IGBT A temperature | S16 | °C | 0x1110 | 0.1 |
| — (was `null`) | `igbt_b_temperature` | IGBT B temperature | S16 | °C | 0x1111 | 0.1 |
| — (was `null`) | `igbt_c_temperature` | IGBT C temperature | S16 | °C | 0x1112 | 0.1 |
| — (was `null`) | `cabinet_temperature` | Cabinet internal temperature | S16 | °C | 0x1113 | 0.1 |
| `mode` | `operating_state` | PCS operating state | U16 | enum | 0x1200 | 1.0 |
| — | `actual_pq_mode` | Actual PQ mode | U16 | — | 0x1205 | — |
| — | `battery_voltage` / `battery_current` | | S16 | V / A | 0x1102 / 0x1103 | 0.1 |
| — | `grid_n_current` | Grid neutral current | S16 | A | 0x112B | 0.1 |
| — | `inverter_ab/bc/ca_voltage` | Inverter line voltages | S16 | V | 0x1116–18 | 0.1 |
| — | `pcc_ab_voltage` | PCC AB line voltage | S16 | V | 0x1119 | 0.1 |
| — | `positive_bus_voltage` / `negative_bus_voltage` | DC bus ± | S16 | V | 0x1114 / 0x1115 | 0.1 |

### What this retires

Three derivations in `pcs.ts` become obsolete, each a current source of error:

- **`V_LL_avg = avg(Vr,Vy,Vb) × √3`** — plus the dual-naming fallback (`Vr_inv_N` vs `V_rn_inv_N`). The gateway publishes line-to-line directly, per phase pair. The `SQRT3` constant goes away entirely.
- **`Q = √(S² − P²)`** — sign was unrecoverable so reactive power was always positive. `grid_reactive_power` is signed `S16`.
- **`PF = P / S`** — replaced by a measured register.

### `dc_power` is the answer to "where is battery power?"

`dc_power` (0x1104) is the PCS's DC-side power — battery power as measured at the converter. For a BESS this is what `stack_power` was standing in for. Prefer it over deriving `bank_voltage × ibank`, and prefer both over `grid_active_power` (which is AC-side, after conversion losses). See §7 item 1.

### Two cautions

1. **`operating_state` enum labels are unrecoverable from the PDF.** The dictionary carries `{"1":"nn","2":"nn","48":"nn","576":"VSGnnnn",…}` — labels are CJK and did not survive extraction. The **numeric keys are reliable** (1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 48, 80, 144, 272, 576, 320); the English text must come from the gateway or vendor doc. Do not guess.
2. **`reg_1122`–`reg_112f`, `reg_1206`–`reg_122a`, and all 12 `version` points (`reg_1300`–`reg_130b`) are raw-only.** The dictionary is explicit: *"UNKNOWN PCS data types are intentionally marked raw-only and must not be assigned engineering meaning until the vendor definition is confirmed."* They carry `HW: hmi_map_not_yet_directly_probed`. Do not surface them. Points marked `HW: validated_2026-07-27` — which includes every measure point in the table above — are hardware-confirmed.

---

## 6. Power environment — 146 points, no UGX equivalent at all

`GET /api/bms/environment`, `GET /api/bms/environment/{asset_id}`. Literal asset id `bms_environment`.

**This section is the largest single gain, and it feeds three views that currently render nothing.**

### 6.1 Water chiller → `WaterChillerData` (currently returns `[]`)

| Frontend field | Kinetics key | Name | Type | Unit | Addr | Scale |
|---|---|---|---|---|---|---|
| `outletWaterTempC` | `liquidcool_1_6` | Outlet Water Temp | S16 | °C | 0x0669 | 0.1 |
| `returnWaterTempC` | `liquidcool_1_7` | Return Water Temp | S16 | °C | 0x066A | 0.1 |
| `supplyWaterPressureBar` | `liquidcool_1_8` | Outlet Water Pressure | U16 | Bar | 0x066B | 0.01 |
| `returnWaterPressureBar` | `liquidcool_1_9` | Return Water Pressure | U16 | Bar | 0x066C | 0.01 |
| `ambientTempC` | `liquidcool_1_10` | Unit Ambient Temp | S16 | °C | 0x066D | 0.1 |
| `tmsWorkingStatus` | `liquidcool_1_12` + `_13` + `_20` | Unit On/Off, Local/Remote, Control Mode | U16 | bitfield | 0x066F, 0x0670, 0x0677 | 1.0 |
| `status` | `liquid_cooling_comm_fault` | Liquid Cooling Comm Fault | U16 | bitfield | 0x0601 | 1.0 |
| `waterPumpSpeedRpm` | `liquidcool_1_1` / `liquidcool_1_22` | Pump Speed / Pump Speed Setting | U16 | bitfield / % | 0x0664 / 0x0679 | 1.0 |
| `compressorSpeedRpm` | `liquidcool_1_2`, `_3` | Compressor Status #1, #2 | U16 | bitfield | 0x0665, 0x0666 | 1.0 |

> **The two RPM fields do not map cleanly.** There is no compressor or pump *speed in RPM* anywhere in the catalog. `liquidcool_1_1` (Pump Speed) is unit `Hex` — a coded status, not RPM — and `liquidcool_1_22` is a setpoint in %. `liquidcool_1_2/_3` are compressor *status*, not speed. Recommend re-typing these two frontend fields from `rpm` to status/percent rather than inventing an RPM value.

Also available: `liquidcool_1_4` Electric Heater Status, `_5` Condenser Fan Status, `_11` Fluid Replenishment Status, `_19` Alarm Level, `_25`/`_26` Cooling/Heating Setpoint, `_31`/`_32` High/Low Outlet Temp Setpoint, and alarm words `liquidcool_1_alarm1/3/5/6/7` (0x0671–75).

### 6.2 Fire protection → `FireProtectionData` (currently returns `[]`)

| Kinetics key | Name | Addr |
|---|---|---|
| `di6h` | Fire Alarm Level 1 | 0x0609 |
| `di4h` | Fire Alarm Level 2 | 0x0607 |
| `di5h` | Fire Fault FBK | 0x0608 |
| `di13h` | Fire Spray FBK | 0x0610 |

Related safety DIs worth surfacing: `di1h` E-Stop (0x0604), `di7l` Access Door Feedback (0x060A), `di8l` Electrical Cabinet Water Leak (0x060B), `di10l` Battery Cabinet Water Leak (0x060D), `di12l` AC Surge/Lightning Fault (0x060F), `di14l` UPS Power Off Feedback (0x0611).

### 6.3 Energy meter → `MeterTodData` (currently returns `[]`) — partial

`essmeter_1_1..30`, all `U32`, `scale 1.0`, addresses 0x061C–0x0656 (two registers each):

| Group | Keys | Quantities |
|---|---|---|
| Phase voltage | `essmeter_1_1..3` | UA, UB, UC (V) |
| Line voltage | `essmeter_1_4..6` | UAB, UBC, UCA (V) |
| Current | `essmeter_1_7..10` | Ia, Ib, Ic, In (A) |
| Active power | `essmeter_1_11..14` | Pa, Pb, Pc, **Pt** (kW) |
| Reactive power | `essmeter_1_15..18` | Qa, Qb, Qc, Qt (kVar) |
| Apparent power | `essmeter_1_19..22` | SA, SB, SC, ST (kVA) |
| Power factor | `essmeter_1_23..26` | PFA, PFB, PFC, PF |
| Frequency | `essmeter_1_27` | F (Hz) |
| Averages | `essmeter_1_28..30` | UN Avg, UL Avg, I Avg |

> **TOD buckets have no source.** `MeterDataView` renders peak/shoulder/flat/valley charge and discharge energy. The meter publishes **instantaneous** P/Q/S/PF/F only — there is not a single kWh register in the entire environment section. Time-of-day bucketing would have to be computed by aggregating `GET /api/historian/{asset_id}` over tariff windows, which is a backend job, not a frontend one. Bank-level energy totals exist (`bank_today_chg_energy`, `month_echg_cum`, …) but are not TOD-split. **Do not wire `MeterDataView` to `essmeter` and present it as TOD data.**

### 6.4 HVAC / ambient — new capability

`aircond_1_10` Indoor Temp (0x068F, S16 °C, scale 0.1) is a genuine ambient temperature — the field currently set to `null` in `PcsSubDevice`. Plus `aircond_1_11` Humidity (%), `aircond_1_1..5` unit/fan/compressor/heater status, `aircond_1_7` Coil Temp, `aircond_1_9` Condensing Temp, and alarms `_16` High Temp, `_18` High Humidity, `_33` High Pressure, `_41`/`_42` Over/Under Voltage.

Dehumidifiers ×2: `dehumidifier_3`/`dehumidifier2_3` Dew Point (scale **0.01**), `_4` Current Humidity (%, scale 0.1), `_1`/`_2` Operating/Alarm Status.

---

## 7. State, status and comms — replaces derived logic and hardcoded strings

This resolves several places where the current code guesses.

| Frontend need | Today | Kinetics key | Name | Addr |
|---|---|---|---|---|
| `chargeDischargeStatus` | derived from current sign | `chg_dsg_state` (bank) | Chg/Dsg | 0x1032 |
| same, per rack | derived | `current_state` (rack) | Chg/Dsg State | 0x001D |
| bank run state | — | `run_state` | Run State | 0x1031 |
| rack run state / `ClusterData.status` | hardcoded `"normal"` | `bcu_run_state` | Rack Run State | 0x0019 |
| `dcContactorStatus` (renders `--`) | hardcoded | `contactor_state` (rack) | Contactor State | 0x001F |
| precharge stage | — | `pre_charge_state` | Pre-chg_state | 0x0018 |
| `commStatus.bms` | `hasComms` heuristic | `bau_comm_fault_l16` / `_h16` / `_3` | BAU↔BCU comm fault | 0x1009 / 0x1008 / 0x10C1 |
| rack↔module comms | — | `bmu_comm_fault_state_l16b` / `_h16b` / `3` | BMU comm fault | 0x0023 / 0x0022 / 0x0021 |
| chiller comms | — | `liquid_cooling_comm_fault` | | 0x0601 |
| HVAC comms | — | `hvac_comm_fault` | | 0x0600 |
| meter comms | — | `energy_meter_comm_fault` | | 0x0602 |
| rack connection | assumed | `connected_state_l16`/`_h16`, `rack_enable_state_l16`/`_h16` | | 0x102D/E, 0x1029/A |

**`chg_dsg_state` removes the need to infer direction from current polarity** — which was open item #3 in v1 of this document. The gateway states it directly.

Alarm words for the Alarms module: bank `external_level1/2/3_alarm` (0x1002–04), `rack_fault` (0x100C), `fault_info_sum2` (0x100D); rack `external_critical`/`external_alarm`/`external_warn` (0x0012–14) and `_2` variants (0x0015–17), `bmu_fault_state` (0x0020), `bmu_sum_fault_state1/2/3` (0x0024–26), `functional_safety_warn` (0x0010). All `Hex` bitfields — bit definitions are in the dictionary's enum column and mostly survived extraction for the environment section, partially for BMS.

---

## 8. Endpoint mapping

| Current function | Today | Kinetics endpoint |
|---|---|---|
| `fetchHierarchyReal` | `/api/customer/{id}/deviceInfos` | `GET /api/assets` |
| `fetchCabinetDetailReal` | `kW_inv_1` + `stack_*` + `arrcap` | `GET /api/telemetry/key-signals` |
| dashboard poll | repeated `values/timeseries` | `GET /api/telemetry/compact` |
| alarms service | — | `GET /api/alarms` (`active_only`, `limit`), `/api/alarms/history` |
| curve / history | windowed `timeseries` | `GET /api/historian/{asset_id}` (`limit`, `since`) |
| live values | polling | `WS /ws/telemetry` (`token`, `mode=delta`) |
| water chiller | `[]` | `GET /api/bms/environment` → §6.1 |
| fire protection | `[]` | `GET /api/bms/environment` → §6.2 |
| meter | `[]` | `GET /api/bms/environment` → §6.3 (**instantaneous only**) |

**Excluded deliberately:** all `/api/control-sequence/*`, `/api/control/{asset_id}/{point_key}`, `/api/protocols/*` and the diagnostics endpoints. The inventory classes these "Privileged backend only" / "Engineering VPN or service account only" with the guidance *"Do not expose to customer UI; use high-level sequence APIs."*

---

## 9. Open items

Down from seven to four; §5 and §7 resolved three of the v1 items.

1. **No measured bank/rack power register.** Confirmed by scanning all 1012 rows — the only bank kW points are `bank_chgable_power`/`bank_dsgable_power` (limits) and `ir`/`ir_pos`/`ir_neg` (which are kΩ, not kW). Three options, in order of preference: (a) **`pcs.dc_power`** — battery-side power at the converter, the closest true equivalent to `stack_power`; (b) derive `bank_voltage × ibank / 1000`; (c) `essmeter_1_14` (Pt) for site total. Confirm which the gateway intends, and whether `/api/bms/bank` returns a computed power field that isn't a catalogued Modbus point.
2. **Current/power sign convention.** `ibank` is `S32` and `dc_power` is `S16`, but neither the dictionary nor the inventory states which sign is charge. `chg_dsg_state` (§7) gives direction independently, so this only affects magnitude display — but getting it wrong still inverts power charts.
3. **`operating_state` enum labels** — numeric keys known, CJK text unrecoverable. See §5.
4. **Response envelope shape.** The canonical path is `assets.{id}.telemetry.{key}.value`, but whether `GET /api/bms/bank` returns that full nesting or a flattened object is not stated anywhere. One sample response settles it — this is the only item blocking a typed client.

Resolved since v1: rack `soc`/`soh` unit (§3, evidence-based), charge/discharge derivation (§7, direct register), water chiller / fire protection / ambient "no source" (§6 — all three have sources).

---

## 10. Scope note

Nothing in `lib/api/` or `components/` has been modified. This is the mapping only. Implementation should not start until item 4 is answered (it determines every response type) and item 1 is decided (it determines whether power is read or derived). Items 2 and 3 affect display correctness and can be settled during implementation against a live gateway.
