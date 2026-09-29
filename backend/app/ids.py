from ulid import ULID

PREFIXES = {"cust", "acct", "tx", "emp", "act", "sess", "ar", "alert", "case", "usr", "rule", "ev", "note", "fail"}


def new_id(prefix: str) -> str:
    if prefix not in PREFIXES:
        raise ValueError(f"unknown id prefix: {prefix}")
    return f"{prefix}_{str(ULID()).lower()}"
