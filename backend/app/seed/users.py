import asyncio

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.config import get_settings
from app.db import SessionLocal, engine
from app.ids import new_id
from app.models import Tenant, User

DEMO_PASSWORD = "Demo!23456"
DEMO_USERS = [
    ("admin@demo.dev", "Asha Admin", "admin"),
    ("manager@demo.dev", "Meera Manager", "manager"),
    ("investigator@demo.dev", "Ishan Investigator", "investigator"),
    ("viewer@demo.dev", "Vikram Viewer", "viewer"),
]


class DemoSeedRefused(RuntimeError):
    pass


async def ensure_tenant(db: AsyncSession, tenant_id: str) -> None:
    await db.execute(
        insert(Tenant)
        .values(
            id=tenant_id,
            name="Demo Bank",
            base_currency="INR",
            timezone="Asia/Kolkata",
            config={"reporting_threshold": get_settings().REPORTING_THRESHOLD, "off_hours": ["19:00", "09:00"]},
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )


async def seed() -> None:
    if get_settings().ENV == "production":
        raise DemoSeedRefused("ADR-013: demo credentials must never be seeded with ENV=production")
    tenant_id = get_settings().TENANT_DEFAULT
    async with SessionLocal() as db:
        await ensure_tenant(db, tenant_id)
        password_hash = hash_password(DEMO_PASSWORD)
        for email, full_name, role in DEMO_USERS:
            stmt = insert(User).values(
                id=new_id("usr"),
                tenant_id=tenant_id,
                email=email,
                full_name=full_name,
                role=role,
                password_hash=password_hash,
                is_active=True,
            )
            await db.execute(
                stmt.on_conflict_do_update(
                    constraint="users_tenant_id_email_key",
                    set_={"full_name": full_name, "role": role, "password_hash": password_hash, "is_active": True},
                )
            )
        await db.commit()
    await engine.dispose()
    print(f"seeded tenant {tenant_id}: " + ", ".join(f"{e} ({r})" for e, _, r in DEMO_USERS))


if __name__ == "__main__":
    asyncio.run(seed())
