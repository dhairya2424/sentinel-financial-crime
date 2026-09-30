# 09 — Data Dictionary & Glossary

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Purpose:** Single source of truth for field names, enum values, and domain terminology. UI, API, and docs must match this file.

---

## 1. Financial-Crime Glossary

| Term | Definition in Sentinel |
|---|---|
| **Circular transfer (loop)** | Money leaves an account and returns to it through ≥3 intermediate accounts within the detection window. Detected by **R-CIRC**. |
| **Structuring / smurfing (transaction splitting to avoid attention)** | Deliberately splitting transactions to keep each just under a reporting threshold to avoid a filing/flag — the problem statement's "transaction splitting to avoid attention". Detected by **R-STRUCT**. |
| **Reporting threshold** | Per-tenant value above which a transaction requires regulatory reporting (`tenants.config.reporting_threshold`, default **₹50,000**). |
| **Just-under band** | Transaction amount in `[0.8 × threshold, threshold)`. A cluster here triggers R-STRUCT scrutiny. |
| **Baseline** | An entity's own trailing history (e.g., 30-day transfer count) used to normalize behavior — anomaly = deviation from *own* baseline, not population. |
| **Insider / subject employee** | A bank employee whose actions are monitored (as distinct from Sentinel's own platform users — see **Reviewer**). |
| **Profile mismatch** | Employee action inconsistent with role/entitlement (**R-PROFILE**), or profile edit followed by suspicious flows (**edit-then-flow**). |
| **Pass-through / velocity** | Funds arriving and leaving an account unusually fast; **R-VELOCITY** measures transfers/hour vs. 7-day baseline. |
| **Dormant reactivation** | Account with no activity ≥90 days that suddenly transacts near-threshold (**R-DORMANT**). |
| **Reviewer (platform user)** | Person using Sentinel (admin/manager/investigator/viewer personas) — stored in `users`, NOT `employees`. |
| **Evidence** | Frozen raw records supporting an alert (`alert_evidence.snapshot`), always shown in the EvidencePanel. |
| **Risk band** | Ordinal severity label derived from decomposed factors — replaces any opaque single score. |
| **Money-flow graph** | Directed multi-graph of customers, accounts, employees and their financial/behavioral edges. |

## 2. Core Entities (tables → key fields)

| Table | Purpose | Key fields |
|---|---|---|
| `tenants` | Tenant + config | `id`, `timezone`, `base_currency`, `config.reporting_threshold` |
| `users` | Platform reviewers | `email`, `role`, `tenant_id` |
| `customers` | Bank customers (graph nodes) | `id` (`cust_*`), `external_ref`, `name`, `profile_version` |
| `accounts` | Bank accounts | `id` (`acct_*`), `customer_id`, `account_no_masked`, `baseline_30d_count/amount`, `last_activity_at` |
| `transactions` | Money movement | `id` (`tx_*`), `from_account_id`, `to_account_id`, `amount`, `direction`, `channel`, `value_ts` |
| `employees` | Bank employees (insider subjects) | `id` (`emp_*`), `role`, `department` |
| `access_rights` | Point-in-time entitlements | `employee_id`, `entitlement`, `revoked_at` (NULL=active) |
| `employee_sessions` | Login sessions | `employee_id`, `started_at`, `outcome` |
| `employee_actions` | Behavioral log | `employee_id`, `action_type`, `target_type`, `target_id`, `before_state`, `after_state`, `event_ts` |
| `rules` | Versioned detection config | `code`, `params`, `weights`, `version` |
| `alerts` | Detection output | `rule_code`, `explanation`, `risk_score`, `risk_band`, `risk_factors`, `dedup_key`, `status` |
| `alert_evidence` | Frozen support records | `evidence_type`, `ref_id`, `snapshot` |
| `cases` | Investigation unit | `case_number`, `status`, `assignee_id`, `export_digest` |
| `case_alerts` / `case_notes` | Links + dispositions | — |
| `audit_log` | Append-only trail | `action`, `actor_user`, `object_type/id`, `detail` |
| `ingest_failures` | Dead-letter queue | `payload`, `error`, `replayed_at` |

ID prefixes (frozen): `cust_`, `acct_`, `tx_`, `emp_`, `act_` (employee_action), `sess_`, `ar_` (access_right), `alert_`, `case_`, `usr_`, `rule_`.

## 3. Enumerations (exact allowed values)

| Enum | Values |
|---|---|
| `users.role` | `admin` \| `manager` \| `investigator` \| `viewer` |
| `transactions.direction` | `debit` \| `credit` |
| `transactions.channel` | `upi` \| `neft` \| `rtgs` \| `atm` \| `pos` \| `internal` |
| `transactions.status` | `pending` \| `completed` \| `failed` (detection uses `completed`) |
| `employees.role` (bank) | `teller` \| `manager` \| `finance_ops` \| `analyst` \| `admin_it` — the roles the R-PROFILE policy (`allowed_roles`) names. *As built:* registration accepts any title a bank uses (the Add data screen suggests these five), and a title outside the policy holds no policy role, so its sensitive actions flag as mismatches. |
| `employee_actions.action_type` | `login` \| `logout` \| `profile.edit` \| `beneficiary.add` \| `limit.change` \| `tx.approve` \| `export.data` |
| `employee_actions.target_type` | `customer` \| `account` \| `transaction` \| `employee` \| `system` |
| `employee_sessions.outcome` | `success` \| `fail` \| `lockout` |
| `alerts.risk_band` | `low` (0–39) \| `medium` (40–69) \| `high` (70–84) \| `critical` (85–100) |
| `alerts.status` | `open` \| `acknowledged` \| `linked_to_case` \| `resolved` \| `closed_confirmed` \| `closed_false_positive` |
| `cases.status` | `open` \| `in_review` \| `escalated` \| `closed_confirmed` \| `closed_false_positive` |
| `cases.priority` | `low` \| `medium` \| `high` \| `critical` |
| `alert_evidence.evidence_type` | `transaction` \| `employee_action` \| `access_right` \| `session` |
| Ingest event `kind` | `transaction` \| `employee_action` \| `access_right` \| `session` |
| Timeline `category` | `transaction` \| `profile_change` \| `access_login` \| `approval` |
| Graph node `type` | `customer` \| `account` \| `employee` (plus `transaction` nodes only as EMPLOYEE_ACTION endpoints) |
| Graph edge `type` | `TRANSFER` \| `ACCOUNT_HOLDER` \| `EMPLOYEE_ACCESS` \| `PROFILE_CHANGE` \| `EMPLOYEE_ACTION` |
| WS message `type` | `alert.created` \| `alert.updated` \| `alert.removed` (P5-B: the S1 re-plant deleted that alert; `data: {id, reason}`) \| `case.updated` \| `metrics.update` \| `pong` \| `heartbeat` \| `subscribed` \| `unsubscribed` \| `error` |

## 4. Detection Rule Codes

| Code | Name | Primary trigger (summary) | Full spec |
|---|---|---|---|
| `R-CIRC` | Circular transfer | Cycle len 3–6, ≤72h, ≥₹500k | docs/02 §4.1 |
| `R-STRUCT` | Transaction structuring | ≥3 just-under txns, total ≥1.5×T | docs/02 §4.2 |
| `R-PROFILE_ROLE` | Role-action mismatch | Action outside role/entitlements | docs/02 §4.3 |
| `R-PROFILE_FLOW` | Edit-then-flow correlation | Profile edit → suspicious flow ≤48h | docs/02 §4.3 |
| `R-VELOCITY` | Transfer velocity | >5× 7-day baseline | docs/02 §4.4 |
| `R-OFFHOURS` | Off-hours employee action | Action 00:00–05:00 tenant tz | docs/02 §4.4 |
| `R-DORMANT` | Dormant reactivation | ≥90d idle → ≥0.8×T in 48h | docs/02 §4.4 |

*Note:* R-PROFILE is implemented as two alertable codes (`R-PROFILE_ROLE`, `R-PROFILE_FLOW`) sharing module `r_profile.py`.

## 5. Risk Factor Catalog (names are frozen UI/API contract)

| Factor name | Meaning | `raw_value` example | Used by |
|---|---|---|---|
| `linkage_depth` | Cycle length | `3 hops` | R-CIRC |
| `amount` | Total vs p95 of account history | `4.2x p95` | R-CIRC, R-STRUCT |
| `temporal_proximity` | Share of window consumed / closeness in time | `94% of window` | R-CIRC, R-PROFILE |
| `account_velocity` | Transfers/hour vs baseline | `5.1x baseline` | R-CIRC, R-VELOCITY |
| `sub_threshold_ratio` | Share of value in just-under band | `6/6 in [40k,50k)` | R-STRUCT |
| `velocity_vs_baseline` | Count vs 30-day baseline | `3x baseline` | R-STRUCT |
| `total_amount` | Aggregate suspicious value | `₹2,88,000` | R-STRUCT |
| `destination_spread` | Distinct beneficiaries count | `1 beneficiary` | R-STRUCT |
| `access_anomaly` | Role/entitlement gap | `analyst lacks tx.approve` | R-PROFILE |
| `action_sensitivity` | Weight of action type | `tx.approve` | R-PROFILE |
| `employee_off_hours` | Outside business hours | `03:15 outside 09:00-19:00` | R-PROFILE, R-OFFHOURS |
| `dormancy_gap` | Days since last activity | `93 days idle` | R-DORMANT |

Each factor: `{name, raw_value (string), weight (0–1), contribution (0–1), imputed (bool)}` with `Σ contributions ≈ risk_score/100` (docs/05 §7). `imputed` is true when the factor could not be measured (no baseline, no prior history, no grant on record) and holds a neutral default; the UI must never present it as a finding. Alerts stored before the field existed are read with `imputed` inferred from those raw values.

## 6. Status Transitions

**Alert:** `open → acknowledged → linked_to_case → {resolved | closed_confirmed | closed_false_positive}`; auto-dedup increments `occurrence_count` while open/acknowledged.

**Case:** `open → in_review → escalated → closed_*` (skips allowed per docs/04 §6); closure requires note ≥10 chars; closure propagates to linked alerts.

## 7. Timeline Category Mapping

| action_type | category |
|---|---|
| `login`, `logout` | `access_login` |
| `profile.edit`, `beneficiary.add`, `limit.change` | `profile_change` |
| `tx.approve` | `approval` |
| `export.data` | `access_login`* (v1 groups with access; revisit if noisy) |
| any `transactions` row | `transaction` |
