"""Benign 90-day corpus for tenant_demo (docs/06 §7 L1–L20, docs/10 §6).

    python -m app.seed.legitimate --customers 50 --employees 30 --days 90 [--seed 42] [--verify]

Output is deterministic for a given --seed and end date: row content and ids (ULIDs built from the
event timestamp plus seeded random bytes). The data is shaped so that no rule should fire:
customer-to-customer transfers only flow from a lower to a higher customer index (no loops), no
amount lands in the just-under band [0.8T, T), employees act only within role and entitlement
during business hours, and no limit or beneficiary edit precedes a large outgoing transfer within
the edit-then-flow correlation window. --verify runs the detection engine over the corpus.
"""

import argparse
import asyncio
import math
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import delete, insert
from ulid import ULID

from app.config import get_settings
from app.db import SessionLocal, engine
from app.ids import PREFIXES
from app.models import (
    AccessRight,
    Account,
    Alert,
    Case,
    Customer,
    Employee,
    EmployeeAction,
    EmployeeSession,
    Transaction,
)
from app.seed.users import DemoSeedRefused, ensure_tenant

TZ = ZoneInfo("Asia/Kolkata")
THRESHOLD = Decimal(get_settings().REPORTING_THRESHOLD)
BAND_FLOOR = THRESHOLD * Decimal("0.8")
FLOW_WINDOW = timedelta(hours=48)
CHUNK = 1000

BRANCHES = ["PUNE-01", "PUNE-02", "MUM-01"]
CITIES = {"PUNE-01": "Pune", "PUNE-02": "Pune", "MUM-01": "Mumbai"}

ROLE_SHARES = [("teller", 0.34), ("manager", 0.13), ("finance_ops", 0.2), ("analyst", 0.2), ("admin_it", 0.13)]
ROLE_ENTITLEMENTS = {
    "teller": ["tx.approve", "beneficiary.add"],
    "manager": ["tx.approve", "beneficiary.add", "limit.change", "profile.edit"],
    "finance_ops": ["tx.approve", "profile.edit", "limit.change"],
    "analyst": ["read.only", "profile.edit"],
    "admin_it": ["system.admin", "export.data"],
}
DEPARTMENTS = {
    "teller": "Branch Operations",
    "manager": "Branch Operations",
    "finance_ops": "Finance Operations",
    "analyst": "Risk & Compliance",
    "admin_it": "IT",
}
SATURDAY_ROLES = {"teller", "manager"}

FIRST_NAMES = [
    "Aarav", "Aditi", "Akash", "Ananya", "Arjun", "Bhavna", "Chetan", "Deepa", "Devansh", "Divya",
    "Farhan", "Gauri", "Harsh", "Isha", "Jaya", "Karan", "Kavya", "Kunal", "Lakshmi", "Madhav",
    "Meenal", "Mohit", "Neha", "Nikhil", "Nisha", "Omkar", "Pallavi", "Pranav", "Priya", "Rahul",
    "Rashmi", "Rohan", "Sagar", "Sakshi", "Sameer", "Sanjana", "Shreya", "Siddharth", "Sneha", "Tanvi",
    "Tejas", "Uday", "Varun", "Vidya", "Yash", "Zoya", "Irfan", "Swati", "Amol", "Ritika",
]
LAST_NAMES = [
    "Deshpande", "Kulkarni", "Joshi", "Patil", "Shinde", "Pawar", "Gokhale", "Bhosale", "Iyer", "Nair",
    "Menon", "Rao", "Reddy", "Shah", "Mehta", "Desai", "Gupta", "Sharma", "Verma", "Khan",
    "Sheikh", "Fernandes", "D'Souza", "Chavan", "Jadhav", "Kale", "Apte", "Sawant", "More", "Gaikwad",
]
EMPLOYERS = ["Infosys", "Persistent Systems", "Bajaj Auto", "Tata Motors", "KPIT", "Wipro", "Cummins India", "Thermax"]
MERCHANTS = [
    ("pos", "POS D-MART"), ("pos", "POS RELIANCE FRESH"), ("pos", "POS CROMA"), ("pos", "POS HP PETROL PUMP"),
    ("upi", "UPI SWIGGY"), ("upi", "UPI ZOMATO"), ("upi", "UPI BIGBASKET"), ("upi", "UPI MSEDCL ELECTRICITY"),
    ("upi", "UPI JIO RECHARGE"), ("upi", "UPI CHEMIST"), ("upi", "UPI IRCTC"), ("pos", "POS APOLLO PHARMACY"),
]
PROFILE_FIELDS = ["mobile", "email", "address", "nominee", "kyc_document"]
STREETS = ["FC Road", "Baner Road", "Kothrud", "Aundh", "Viman Nagar", "Andheri West", "Dadar", "Powai", "Hadapsar", "Wakad"]


def local_ts(day: date, hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute, second), TZ).astimezone(timezone.utc)


def money(value: float) -> Decimal:
    return Decimal(f"{value:.2f}")


class IdMint:
    def __init__(self, rng: random.Random) -> None:
        self.rng = rng

    def __call__(self, prefix: str, ts: datetime) -> str:
        if prefix not in PREFIXES:
            raise ValueError(f"unknown id prefix: {prefix}")
        millis = int(ts.timestamp() * 1000).to_bytes(6, "big")
        return f"{prefix}_{str(ULID.from_bytes(millis + self.rng.randbytes(10))).lower()}"


@dataclass
class CustomerPlan:
    index: int
    row: dict
    branch: str
    segment: str
    primary: dict
    secondary: dict | None
    salary: Decimal | None = None
    employer: str | None = None
    rent: Decimal | None = None
    payees: list["CustomerPlan"] = field(default_factory=list)
    investment_days: set[int] = field(default_factory=set)
    profile: dict = field(default_factory=dict)


@dataclass
class EmployeePlan:
    row: dict
    branch: str
    role: str
    entitlements: list[str]
    ip: str


@dataclass
class Corpus:
    customers: list[dict] = field(default_factory=list)
    accounts: list[dict] = field(default_factory=list)
    employees: list[dict] = field(default_factory=list)
    access_rights: list[dict] = field(default_factory=list)
    sessions: list[dict] = field(default_factory=list)
    transactions: list[dict] = field(default_factory=list)
    actions: list[dict] = field(default_factory=list)


class LegitimateGenerator:
    def __init__(self, tenant_id: str, customers: int, employees: int, days: int, seed: int, end_day: date) -> None:
        self.tenant = tenant_id
        self.n_customers = customers
        self.n_employees = employees
        self.days = days
        self.rng = random.Random(seed)
        self.ids = IdMint(random.Random(seed + 1))
        self.start_day = end_day - timedelta(days=days)
        self.window_start = local_ts(self.start_day, 0)
        self.corpus = Corpus()
        self.plans: list[CustomerPlan] = []
        self.staff: list[EmployeePlan] = []
        self.account_customer: dict[str, CustomerPlan] = {}
        self.sessions: dict[tuple[str, date], dict] = {}
        self.used_masks: set[str] = set()
        self.large_out: dict[str, list[datetime]] = {}

    def build(self) -> Corpus:
        names = self._unique_names(self.n_customers + self.n_employees)
        self._customers(names[: self.n_customers])
        self._employees(names[self.n_customers :])
        for offset in range(self.days):
            day = self.start_day + timedelta(days=offset)
            for plan in self.plans:
                self._customer_day(plan, day, offset)
        self._sessions()
        self._approvals()
        self.large_out = self._large_outgoing()
        self._beneficiary_adds()
        self._limit_changes()
        self._profile_edits()
        self._exports()
        self._baselines()
        self.corpus.transactions.sort(key=lambda t: t["value_ts"])
        self.corpus.actions.sort(key=lambda a: a["event_ts"])
        return self.corpus

    def _unique_names(self, n: int) -> list[str]:
        pool = [f"{f} {l}" for f in FIRST_NAMES for l in LAST_NAMES]
        if n > len(pool):
            raise ValueError(f"at most {len(pool)} customers + employees supported")
        return self.rng.sample(pool, n)

    def _mask(self) -> str:
        while True:
            mask = f"XXXXXXXX{self.rng.randint(1000, 9999)}"
            if mask not in self.used_masks:
                self.used_masks.add(mask)
                return mask

    def _account(self, customer: dict, kind: str) -> dict:
        opened = self.window_start - timedelta(days=self.rng.randint(180, 3000))
        row = {
            "id": self.ids("acct", opened),
            "tenant_id": self.tenant,
            "customer_id": customer["id"],
            "account_no_masked": self._mask(),
            "type": kind,
            "status": "active",
            "opened_at": opened,
        }
        self.corpus.accounts.append(row)
        return row

    def _customers(self, names: list[str]) -> None:
        for i, name in enumerate(names):
            segment = self.rng.choices(["salaried", "business", "senior"], weights=[0.6, 0.25, 0.15])[0]
            branch = BRANCHES[i % len(BRANCHES)]
            created = self.window_start - timedelta(days=self.rng.randint(200, 3000))
            first, last = name.split(" ", 1)
            profile = {
                "mobile": f"+91-9{self.rng.randint(100000000, 999999999)}",
                "email": f"{first.lower()}.{last.lower().replace(chr(39), '')}@example.in",
                "address": f"{self.rng.randint(1, 250)}, {self.rng.choice(STREETS)}, {CITIES[branch]}",
                "nominee": f"{self.rng.choice(FIRST_NAMES)} {last}",
                "kyc_document": f"Aadhaar XXXX-XXXX-{self.rng.randint(1000, 9999)}",
            }
            row = {
                "id": self.ids("cust", created),
                "tenant_id": self.tenant,
                "external_ref": f"CIF{100001 + i}",
                "name": name,
                "kyc_status": "verified",
                "risk_rating": self.rng.choice(["standard", "standard", "low"]),
                "segment": segment,
                "profile_version": 0,
                "meta": {"branch": branch, "city": CITIES[branch]},
                "created_at": created,
            }
            self.corpus.customers.append(row)
            primary_kind = "current" if segment == "business" else "savings"
            primary = self._account(row, primary_kind)
            secondary = None
            if self.rng.random() < (0.5 if segment == "business" else 0.3):
                secondary = self._account(row, "savings" if primary_kind == "current" else "current")
            plan = CustomerPlan(i, row, branch, segment, primary, secondary, profile=profile)
            if segment == "salaried":
                plan.salary = self._outside_band(round(self.rng.lognormvariate(math.log(62000), 0.45), -2))
                plan.employer = self.rng.choice(EMPLOYERS)
                plan.rent = money(round(self.rng.uniform(8000, 32000), -2))
            elif segment == "senior":
                plan.salary = money(round(self.rng.uniform(18000, 38000), -2))
            if segment != "senior" and self.days > 5 and self.rng.random() < 0.4:
                plan.investment_days = set(self.rng.sample(range(3, self.days - 1), self.rng.randint(1, 2)))
            self.plans.append(plan)
            for acct in (primary, secondary):
                if acct:
                    self.account_customer[acct["id"]] = plan
        for plan in self.plans:
            later = self.plans[plan.index + 1 :]
            if later:
                plan.payees = self.rng.sample(later, min(len(later), self.rng.randint(1, 3)))

    def _outside_band(self, value: float) -> Decimal:
        amount = money(value)
        if BAND_FLOOR <= amount < THRESHOLD:
            amount += THRESHOLD - BAND_FLOOR
        return amount

    def _employees(self, names: list[str]) -> None:
        counts = [max(1, round(share * self.n_employees)) for _, share in ROLE_SHARES]
        counts[0] += self.n_employees - sum(counts)
        roles = [role for (role, _), n in zip(ROLE_SHARES, counts) for _ in range(n)]
        by_role: Counter[str] = Counter()
        managers: dict[str, str] = {}
        for i, (name, role) in enumerate(zip(names, roles)):
            branch = "HQ" if role == "admin_it" else BRANCHES[by_role[role] % len(BRANCHES)]
            by_role[role] += 1
            joined = self.window_start - timedelta(days=self.rng.randint(400, 3600))
            row = {
                "id": self.ids("emp", joined),
                "tenant_id": self.tenant,
                "external_ref": f"E{2001 + i}",
                "name": name,
                "department": DEPARTMENTS[role],
                "role": role,
                "manager_id": None,
                "status": "active",
                "meta": {"branch": branch},
                "created_at": joined,
            }
            if role == "manager":
                managers.setdefault(branch, row["id"])
            subnet = BRANCHES.index(branch) + 1 if branch in BRANCHES else 9
            self.staff.append(EmployeePlan(row, branch, role, ROLE_ENTITLEMENTS[role], f"10.20.{subnet}.{10 + i}"))
            for entitlement in ROLE_ENTITLEMENTS[role]:
                granted = joined + timedelta(days=self.rng.randint(1, 30))
                self.corpus.access_rights.append(
                    {
                        "id": self.ids("ar", granted),
                        "tenant_id": self.tenant,
                        "employee_id": row["id"],
                        "entitlement": entitlement,
                        "scope": "global" if branch == "HQ" else f"branch:{branch}",
                        "granted_at": granted,
                        "revoked_at": None,
                        "granted_by": "iam:provisioning",
                        "source": "iam",
                    }
                )
        for plan in self.staff:
            if plan.role in {"teller", "finance_ops", "analyst"}:
                plan.row["manager_id"] = managers.get(plan.branch)
            self.corpus.employees.append(plan.row)

    def _tx(
        self,
        ts: datetime,
        amount: Decimal,
        channel: str,
        narration: str,
        from_acct: str | None = None,
        to_acct: str | None = None,
        counterparty: str | None = None,
    ) -> dict:
        failed = channel in {"pos", "upi", "atm"} and self.rng.random() < 0.01
        row = {
            "id": self.ids("tx", ts),
            "tenant_id": self.tenant,
            "from_account_id": from_acct,
            "to_account_id": to_acct,
            "amount": amount,
            "currency": "INR",
            "direction": "debit" if from_acct else "credit",
            "channel": channel,
            "reference_no": f"{channel.upper()}{ts.astimezone(TZ):%y%m%d}{self.rng.randint(100000, 999999)}",
            "status": "failed" if failed else "completed",
            "value_ts": ts,
            "raw": {"narration": narration, **({"counterparty": counterparty} if counterparty else {})},
        }
        self.corpus.transactions.append(row)
        return row

    def _retail_time(self, day: date) -> datetime:
        hour = self.rng.choices(range(8, 23), weights=[2, 3, 4, 4, 5, 5, 4, 4, 4, 5, 6, 7, 6, 4, 2])[0]
        return local_ts(day, hour, self.rng.randint(0, 59), self.rng.randint(0, 59))

    def _office_time(self, day: date) -> datetime:
        return local_ts(day, self.rng.randint(10, 16), self.rng.randint(0, 59), self.rng.randint(0, 59))

    def _customer_day(self, plan: CustomerPlan, day: date, offset: int) -> None:
        acct = plan.primary["id"]
        weekday = day.weekday()
        if plan.segment == "salaried" and day.day == 1:
            ts = local_ts(day, self.rng.randint(9, 11), self.rng.randint(0, 59))
            self._tx(ts, plan.salary, "neft", f"SALARY {day:%b %Y} {plan.employer}".upper(), to_acct=acct, counterparty=plan.employer)
        if plan.segment == "senior" and day.day == 1:
            self._tx(local_ts(day, 10, self.rng.randint(0, 59)), plan.salary, "neft", "PENSION CREDIT EPFO", to_acct=acct)
        if plan.segment == "salaried" and day.day == 5:
            self._tx(self._office_time(day), plan.rent, "neft", self.rng.choice(["RENT TRANSFER", "HOME LOAN EMI"]), from_acct=acct)
        if plan.segment == "business" and weekday < 6:
            for _ in range(self.rng.choice([0, 0, 1, 1, 2])):
                amount = money(min(39000, max(150, self.rng.lognormvariate(math.log(2500), 0.9))))
                self._tx(self._retail_time(day), amount, "upi", "UPI COLLECT", to_acct=acct)
            if weekday == 4:
                amount = money(round(self.rng.uniform(8000, 35000), -2))
                self._tx(self._office_time(day), amount, "neft", "SUPPLIER PAYMENT", from_acct=acct)
        if self.rng.random() < 0.1:
            self._tx(self._retail_time(day), Decimal(self.rng.randrange(500, 10001, 500)), "atm", "ATM CASH WITHDRAWAL", from_acct=acct)
        for _ in range(sum(self.rng.random() < 0.28 for _ in range(2))):
            channel, narration = self.rng.choice(MERCHANTS)
            amount = money(min(25000, max(50, self.rng.lognormvariate(math.log(700), 0.9))))
            self._tx(self._retail_time(day), amount, channel, narration, from_acct=acct)
        if plan.secondary and day.day == 7:
            amount = money(round(self.rng.uniform(5000, 30000), -2))
            self._tx(self._office_time(day), amount, "internal", "SWEEP TO LINKED ACCOUNT", from_acct=acct, to_acct=plan.secondary["id"])
        if plan.payees and self.rng.random() < 0.05:
            payee = self.rng.choice(plan.payees)
            amount = money(round(min(30000, max(200, self.rng.lognormvariate(math.log(4000), 0.8))), -1))
            channel = "upi" if amount < 20000 else "neft"
            ts = self._retail_time(day) if channel == "upi" else self._office_time(day)
            self._tx(ts, amount, channel, f"TRANSFER TO {payee.row['name'].upper()}",
                     from_acct=acct, to_acct=payee.primary["id"], counterparty=payee.row["name"])
        if offset in plan.investment_days:
            amount = money(round(self.rng.uniform(60000, 200000), -3))
            self._tx(self._office_time(day), amount, "rtgs", self.rng.choice(["RTGS MUTUAL FUND SIP", "RTGS FD BOOKING"]), from_acct=acct)

    def _working(self, role: str, day: date) -> bool:
        weekday = day.weekday()
        return weekday < 5 or (weekday == 5 and role in SATURDAY_ROLES)

    def _sessions(self) -> None:
        for offset in range(self.days):
            day = self.start_day + timedelta(days=offset)
            for emp in self.staff:
                if not self._working(emp.role, day) or self.rng.random() < 0.07:
                    continue
                start = local_ts(day, 9, self.rng.randint(0, 50), self.rng.randint(0, 59))
                end = local_ts(day, self.rng.randint(17, 18), self.rng.randint(30, 59), self.rng.randint(0, 59))
                device = f"WS-{emp.branch}-{self.rng.randint(1, 20):02d}"
                if self.rng.random() < 0.03:
                    failed = start - timedelta(minutes=self.rng.randint(1, 3))
                    self.corpus.sessions.append(self._session(emp, failed, None, "fail", device))
                session = self._session(emp, start, end, "success", device)
                self.corpus.sessions.append(session)
                self.sessions[(emp.row["id"], day)] = session

    def _session(self, emp: EmployeePlan, start: datetime, end: datetime | None, outcome: str, device: str) -> dict:
        return {
            "id": self.ids("sess", start),
            "tenant_id": self.tenant,
            "employee_id": emp.row["id"],
            "ip_address": emp.ip,
            "device": device,
            "started_at": start,
            "ended_at": end,
            "outcome": outcome,
        }

    def _action(
        self,
        emp: EmployeePlan,
        session: dict,
        ts: datetime,
        action_type: str,
        target_type: str,
        target_id: str,
        before: dict | None,
        after: dict | None,
    ) -> None:
        self.corpus.actions.append(
            {
                "id": self.ids("act", ts),
                "tenant_id": self.tenant,
                "employee_id": emp.row["id"],
                "session_id": session["id"],
                "action_type": action_type,
                "target_type": target_type,
                "target_id": target_id,
                "before_state": before,
                "after_state": after,
                "ip_address": emp.ip,
                "event_ts": ts,
                "raw": {"source": "core-banking-audit", "branch": emp.branch},
            }
        )

    def _staff_for(self, action_type: str, branch: str) -> list[EmployeePlan]:
        return [e for e in self.staff if action_type in e.entitlements and e.branch == branch]

    def _on_shift(self, candidates: list[EmployeePlan], day: date) -> list[tuple[EmployeePlan, dict]]:
        found = [(e, self.sessions[(e.row["id"], day)]) for e in candidates if (e.row["id"], day) in self.sessions]
        self.rng.shuffle(found)
        return found

    def _time_in(self, session: dict, lo: datetime | None = None, hi: datetime | None = None) -> datetime | None:
        start = session["started_at"] + timedelta(minutes=10)
        end = session["ended_at"] - timedelta(minutes=10)
        if lo:
            start = max(start, lo)
        if hi:
            end = min(end, hi)
        if end <= start:
            return None
        return start + timedelta(seconds=self.rng.randint(0, int((end - start).total_seconds())))

    def _large_outgoing(self) -> dict[str, list[datetime]]:
        out: dict[str, list[datetime]] = defaultdict(list)
        for tx in self.corpus.transactions:
            if tx["from_account_id"] and tx["status"] == "completed" and tx["amount"] >= BAND_FLOOR:
                out[self.account_customer[tx["from_account_id"]].row["id"]].append(tx["value_ts"])
        return out

    def _flow_safe(self, customer_id: str, ts: datetime) -> bool:
        return not any(ts <= t <= ts + FLOW_WINDOW for t in self.large_out.get(customer_id, []))

    def _approvals(self) -> None:
        for tx in list(self.corpus.transactions):
            if not tx["from_account_id"] or tx["channel"] not in {"neft", "rtgs"} or tx["amount"] < 25000:
                continue
            plan = self.account_customer[tx["from_account_id"]]
            day = tx["value_ts"].astimezone(TZ).date()
            for emp, session in self._on_shift(self._staff_for("tx.approve", plan.branch), day):
                ts = self._time_in(session, tx["value_ts"] - timedelta(minutes=20), tx["value_ts"] - timedelta(minutes=2))
                if ts:
                    self._action(emp, session, ts, "tx.approve", "transaction", tx["id"],
                                 {"status": "pending_approval"}, {"status": "approved", "amount": str(tx["amount"])})
                    break

    def _beneficiary_adds(self) -> None:
        first_payment: dict[tuple[str, str], dict] = {}
        for tx in sorted(self.corpus.transactions, key=lambda t: t["value_ts"]):
            if tx["from_account_id"] and tx["to_account_id"] and tx["channel"] in {"upi", "neft"}:
                first_payment.setdefault((tx["from_account_id"], tx["to_account_id"]), tx)
        counts: Counter[str] = Counter()
        for (src, dst), tx in first_payment.items():
            if tx["channel"] == "upi" and self.rng.random() < 0.5:
                continue
            plan, payee = self.account_customer[src], self.account_customer[dst]
            first_day = tx["value_ts"].astimezone(TZ).date()
            placed = False
            for back in self.rng.sample(range(1, 7), 6):
                day = first_day - timedelta(days=back)
                if placed or day < self.start_day:
                    continue
                for emp, session in self._on_shift(self._staff_for("beneficiary.add", plan.branch), day):
                    ts = self._time_in(session)
                    if ts and self._flow_safe(plan.row["id"], ts):
                        counts[src] += 1
                        added = {"name": payee.row["name"], "account": payee.primary["account_no_masked"]}
                        self._action(emp, session, ts, "beneficiary.add", "account", src,
                                     {"beneficiaries": counts[src] - 1}, {"beneficiaries": counts[src], "added": added})
                        placed = True
                        break

    def _limit_changes(self) -> None:
        limits: dict[str, int] = {}
        for offset in range(self.days):
            day = self.start_day + timedelta(days=offset)
            for branch in BRANCHES:
                branch_plans = [p for p in self.plans if p.branch == branch]
                if not branch_plans or self.rng.random() > 0.35:
                    continue
                plan = self.rng.choice(branch_plans)
                acct = plan.primary["id"]
                for emp, session in self._on_shift(self._staff_for("limit.change", branch), day):
                    ts = self._time_in(session)
                    if ts and self._flow_safe(plan.row["id"], ts):
                        old = limits.get(acct, 200000 if plan.segment == "business" else 100000)
                        new = old + self.rng.choice([-50000, 50000, 100000]) if old > 50000 else old + 50000
                        limits[acct] = new
                        self._action(emp, session, ts, "limit.change", "account", acct,
                                     {"daily_transfer_limit": old}, {"daily_transfer_limit": new})
                        break

    def _profile_edits(self) -> None:
        versions: Counter[str] = Counter()
        for offset in range(self.days):
            day = self.start_day + timedelta(days=offset)
            for branch in BRANCHES:
                branch_plans = [p for p in self.plans if p.branch == branch]
                shift = self._on_shift(self._staff_for("profile.edit", branch), day)
                if not branch_plans or not shift:
                    continue
                for _ in range(self.rng.choice([0, 1, 1, 2])):
                    plan = self.rng.choice(branch_plans)
                    emp, session = self.rng.choice(shift)
                    ts = self._time_in(session)
                    if not ts:
                        continue
                    fld = self.rng.choice(PROFILE_FIELDS)
                    before, after = plan.profile[fld], self._new_value(fld, plan)
                    plan.profile[fld] = after
                    versions[plan.row["id"]] += 1
                    self._action(emp, session, ts, "profile.edit", "customer", plan.row["id"], {fld: before}, {fld: after})
        for plan in self.plans:
            plan.row["profile_version"] = versions[plan.row["id"]]

    def _new_value(self, fld: str, plan: CustomerPlan) -> str:
        if fld == "mobile":
            return f"+91-9{self.rng.randint(100000000, 999999999)}"
        if fld == "email":
            local = plan.row["name"].lower().replace(" ", ".").replace("'", "")
            return f"{local}{self.rng.randint(1, 99)}@example.in"
        if fld == "address":
            return f"{self.rng.randint(1, 250)}, {self.rng.choice(STREETS)}, {CITIES[plan.branch]}"
        if fld == "nominee":
            return f"{self.rng.choice(FIRST_NAMES)} {plan.row['name'].split(' ', 1)[1]}"
        if self.rng.random() < 0.5:
            return f"Passport X{self.rng.randint(1000000, 9999999)}"
        return f"Aadhaar XXXX-XXXX-{self.rng.randint(1000, 9999)}"

    def _exports(self) -> None:
        admins = [e for e in self.staff if "export.data" in e.entitlements]
        for offset in range(self.days):
            day = self.start_day + timedelta(days=offset)
            if day.weekday() != 0:
                continue
            for emp, session in self._on_shift(admins, day)[:1]:
                ts = self._time_in(session, hi=session["started_at"] + timedelta(hours=3))
                if ts:
                    self._action(emp, session, ts, "export.data", "system", "report:weekly_branch_ops",
                                 None, {"format": "csv", "rows": self.rng.randint(800, 5000)})

    def _baselines(self) -> None:
        cutoff = local_ts(self.start_day + timedelta(days=self.days), 0) - timedelta(days=30)
        count: Counter[str] = Counter()
        total: defaultdict[str, Decimal] = defaultdict(Decimal)
        last: dict[str, datetime] = {}
        for tx in self.corpus.transactions:
            if tx["status"] != "completed":
                continue
            for acct in (tx["from_account_id"], tx["to_account_id"]):
                if acct and (acct not in last or tx["value_ts"] > last[acct]):
                    last[acct] = tx["value_ts"]
            if tx["from_account_id"] and tx["value_ts"] >= cutoff:
                count[tx["from_account_id"]] += 1
                total[tx["from_account_id"]] += tx["amount"]
        for acct in self.corpus.accounts:
            acct["baseline_30d_count"] = count[acct["id"]]
            acct["baseline_30d_amount"] = total[acct["id"]]
            acct["last_activity_at"] = last.get(acct["id"])


def verify(corpus: Corpus, tenant_config: dict) -> tuple[list, int]:
    """Run the full detection engine over the corpus. Dormancy is evaluated from in-window history only,
    since the seed has no activity before its first day."""
    from app.detection.base import (
        AccountProfile,
        ActionRecord,
        ActionWindow,
        EmployeeProfile,
        RuleContext,
        TransferRecord,
        TransferWindow,
    )
    from app.detection.config import resolve_rule_configs
    from app.detection.engine import detect

    customer_of = {a["id"]: a["customer_id"] for a in corpus.accounts}
    sender_of = {t["id"]: customer_of.get(t["from_account_id"]) for t in corpus.transactions}
    transfers = [
        TransferRecord(t["id"], t["from_account_id"], t["to_account_id"], t["amount"], t["value_ts"], t["channel"])
        for t in corpus.transactions
        if t["status"] == "completed"
    ]
    accounts = {
        a["id"]: AccountProfile(a["id"], a["customer_id"], a["baseline_30d_count"], a["baseline_30d_amount"], None)
        for a in corpus.accounts
    }
    entitlements: defaultdict[str, set[str]] = defaultdict(set)
    for right in corpus.access_rights:
        entitlements[right["employee_id"]].add(right["entitlement"])
    employees = {e["id"]: EmployeeProfile(e["id"], e["name"], e["role"], frozenset(entitlements[e["id"]])) for e in corpus.employees}

    def customer_for(action: dict) -> str | None:
        target = action["target_id"]
        return {"customer": target, "account": customer_of.get(target), "transaction": sender_of.get(target)}.get(action["target_type"])

    actions = [
        ActionRecord(a["id"], a["employee_id"], a["action_type"], a["target_type"], a["target_id"], a["event_ts"], customer_for(a))
        for a in corpus.actions
    ]
    ctx = RuleContext(
        tenant_id="verify",
        configs=resolve_rule_configs(tenant_config=tenant_config),
        transfers=TransferWindow(transfers, accounts),
        actions=ActionWindow(actions, employees),
    )
    hits = detect(ctx, [c["id"] for c in corpus.customers], ["transaction", "employee_action", "access_right", "session"])
    customer_ids = {c["id"] for c in corpus.customers}
    flagged = {customer_of.get(e, e) for h in hits if h.score >= 40 for e in h.entity_ids}
    return hits, len(flagged & customer_ids)


async def _insert(db, model, rows: list[dict]) -> None:
    for i in range(0, len(rows), CHUNK):
        await db.execute(insert(model), rows[i : i + CHUNK])


async def load(corpus: Corpus, tenant_id: str) -> dict[str, int]:
    """Wipe-and-reload in one transaction. Alerts and cases are derived from the domain rows being
    replaced, so they are cleared too; audit_log is append-only and never touched."""
    async with SessionLocal() as db:
        async with db.begin():
            await ensure_tenant(db, tenant_id)
            wiped = {}
            for model in (Case, Alert, EmployeeAction, EmployeeSession, AccessRight, Transaction, Account, Customer, Employee):
                result = await db.execute(delete(model).where(model.tenant_id == tenant_id))
                wiped[model.__tablename__] = result.rowcount
            await _insert(db, Customer, corpus.customers)
            await _insert(db, Account, corpus.accounts)
            await _insert(db, Employee, [e for e in corpus.employees if e["manager_id"] is None])
            await _insert(db, Employee, [e for e in corpus.employees if e["manager_id"] is not None])
            await _insert(db, AccessRight, corpus.access_rights)
            await _insert(db, EmployeeSession, corpus.sessions)
            await _insert(db, Transaction, corpus.transactions)
            await _insert(db, EmployeeAction, corpus.actions)
    await engine.dispose()
    return wiped


def summarize(corpus: Corpus) -> str:
    channels = Counter(t["channel"] for t in corpus.transactions)
    action_types = Counter(a["action_type"] for a in corpus.actions)
    roles = Counter(e["role"] for e in corpus.employees)
    failed_tx = sum(t["status"] == "failed" for t in corpus.transactions)
    failed_logins = sum(s["outcome"] == "fail" for s in corpus.sessions)
    return "\n".join(
        [
            f"  customers        {len(corpus.customers)}",
            f"  accounts         {len(corpus.accounts)}",
            f"  employees        {len(corpus.employees)}  ({', '.join(f'{r}={n}' for r, n in sorted(roles.items()))})",
            f"  access_rights    {len(corpus.access_rights)}",
            f"  sessions         {len(corpus.sessions)}  (failed logins={failed_logins})",
            f"  transactions     {len(corpus.transactions)}  (failed={failed_tx}; {', '.join(f'{c}={n}' for c, n in sorted(channels.items()))})",
            f"  employee_actions {len(corpus.actions)}  ({', '.join(f'{a}={n}' for a, n in sorted(action_types.items()))})",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the benign (legitimate) corpus for the default tenant.")
    parser.add_argument("--customers", type=int, default=50)
    parser.add_argument("--employees", type=int, default=30)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--verify", action="store_true", help="run the detection engine over the corpus and report hits")
    parser.add_argument("--dry-run", action="store_true", help="generate and summarise without touching the database")
    args = parser.parse_args()

    settings = get_settings()
    if settings.ENV == "production":
        raise DemoSeedRefused("demo corpora must never be seeded with ENV=production")
    if args.customers < 2 or args.employees < 5 or args.days < 7:
        parser.error("need at least 2 customers, 5 employees and 7 days")

    end_day = datetime.now(TZ).date()
    generator = LegitimateGenerator(settings.TENANT_DEFAULT, args.customers, args.employees, args.days, args.seed, end_day)
    corpus = generator.build()
    print(f"legitimate corpus for {settings.TENANT_DEFAULT}: {args.days} days to {end_day}, seed {args.seed}")
    print(summarize(corpus))

    if args.verify:
        hits, flagged = verify(corpus, {"reporting_threshold": settings.REPORTING_THRESHOLD})
        by_rule = dict(Counter(h.pattern_code for h in hits))
        total = len(corpus.customers)
        print(
            f"verify: {len(hits)} detection hits {by_rule if hits else ''}; customers with band>=medium "
            f"{flagged}/{total} (false-positive rate {flagged / total:.1%}, target <=10%)"
        )

    if not args.dry_run:
        wiped = asyncio.run(load(corpus, settings.TENANT_DEFAULT))
        replaced = ", ".join(f"{t}={n}" for t, n in wiped.items() if n)
        print(f"loaded into {settings.TENANT_DEFAULT}" + (f" (replaced: {replaced})" if replaced else ""))


if __name__ == "__main__":
    main()
