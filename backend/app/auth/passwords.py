import re

import bcrypt

BCRYPT_ROUNDS = 12
MIN_LENGTH = 10
MAX_BYTES = 72

_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser-not-a-real-password", bcrypt.gensalt(BCRYPT_ROUNDS))


class WeakPasswordError(ValueError):
    pass


def check_policy(password: str) -> None:
    if len(password.encode()) > MAX_BYTES:
        raise WeakPasswordError(f"password must be at most {MAX_BYTES} bytes")
    classes = sum(bool(re.search(p, password)) for p in (r"[a-z]", r"[A-Z]", r"\d", r"[^A-Za-z0-9]"))
    if len(password) < MIN_LENGTH or classes < 3:
        raise WeakPasswordError(f"password must be >= {MIN_LENGTH} chars and mix at least 3 character classes")


def hash_password(password: str) -> str:
    check_policy(password)
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    candidate = password.encode()
    if password_hash is None or len(candidate) > MAX_BYTES:
        bcrypt.checkpw(b"x", _DUMMY_HASH)
        return False
    return bcrypt.checkpw(candidate, password_hash.encode())
