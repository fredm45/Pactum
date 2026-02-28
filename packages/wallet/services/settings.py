"""
用户限额管理
"""
from db.client import get_supabase
from api.models import UpdateSettingsRequest


def get_settings(user: dict) -> dict:
    return {
        "per_transaction_limit": str(user["per_transaction_limit"]),
        "daily_limit": str(user["daily_limit"]),
        "require_confirmation_above": str(user["require_confirmation_above"]),
    }


def update_settings(user: dict, req: UpdateSettingsRequest) -> dict:
    updates = {}
    if req.per_transaction_limit is not None:
        updates["per_transaction_limit"] = float(req.per_transaction_limit)
    if req.daily_limit is not None:
        updates["daily_limit"] = float(req.daily_limit)
    if req.require_confirmation_above is not None:
        updates["require_confirmation_above"] = float(req.require_confirmation_above)

    if not updates:
        raise ValueError("No settings to update")

    db = get_supabase()
    db.table("wallet_users").update(updates).eq("id", user["id"]).execute()

    # 返回更新后的值
    result = db.table("wallet_users").select("per_transaction_limit, daily_limit, require_confirmation_above").eq("id", user["id"]).execute()
    row = result.data[0]
    return {
        "per_transaction_limit": str(row["per_transaction_limit"]),
        "daily_limit": str(row["daily_limit"]),
        "require_confirmation_above": str(row["require_confirmation_above"]),
    }
