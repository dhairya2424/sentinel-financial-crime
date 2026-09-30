from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-insecure-secret-change-me-0123456789"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENV: str = "dev"
    DATABASE_URL: str = "postgresql+asyncpg://sentinel:sentinel@localhost:5432/sentinel"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_SECRET: str = ""
    JWT_ACCESS_MIN: int = 30
    JWT_REFRESH_HOURS: int = 12
    TENANT_DEFAULT: str = "tenant_demo"
    REPORTING_THRESHOLD: int = 50000
    CYCLE_MIN_AMOUNT: int = 500000

    @model_validator(mode="after")
    def _check_secret(self) -> "Settings":
        if self.ENV != "dev":
            if not self.JWT_SECRET:
                raise ValueError("JWT_SECRET is required when ENV != dev")
            if self.ENV == "production" and len(self.JWT_SECRET) < 32:
                raise ValueError("JWT_SECRET must be at least 32 characters in production")
        elif not self.JWT_SECRET:
            self.JWT_SECRET = DEV_JWT_SECRET
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
