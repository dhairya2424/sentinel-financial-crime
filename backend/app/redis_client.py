from redis.asyncio import Redis

from app.config import get_settings

redis = Redis.from_url(get_settings().REDIS_URL, decode_responses=True)
