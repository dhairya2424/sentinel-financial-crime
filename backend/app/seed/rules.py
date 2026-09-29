import asyncio

from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.db import SessionLocal, engine
from app.detection.config import DEFAULTS
from app.ids import new_id
from app.models import Rule
from app.seed.users import ensure_tenant


async def seed() -> None:
    tenant_id = get_settings().TENANT_DEFAULT
    async with SessionLocal() as db:
        await ensure_tenant(db, tenant_id)
        inserted = 0
        for code, spec in DEFAULTS.items():
            result = await db.execute(
                insert(Rule)
                .values(
                    id=new_id("rule"),
                    tenant_id=tenant_id,
                    code=code,
                    name=spec["name"],
                    enabled=True,
                    params=spec["params"],
                    weights=spec["weights"],
                    version=1,
                )
                .on_conflict_do_nothing(constraint="rules_tenant_id_code_version_key")
            )
            inserted += result.rowcount or 0
        await db.commit()
    await engine.dispose()
    print(f"rules for {tenant_id}: {inserted} inserted, {len(DEFAULTS) - inserted} already present (version 1)")
    for code, spec in DEFAULTS.items():
        weights = ", ".join(f"{k}={v}" for k, v in spec["weights"].items())
        print(f"  {code:<15} {spec['name']:<28} {weights}")


if __name__ == "__main__":
    asyncio.run(seed())
