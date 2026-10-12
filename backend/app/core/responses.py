"""
Consistent API response envelope, used by every route so the frontend
never has to guess the shape of a response.
"""

from typing import Any


def success(data: Any, message: str = "Request completed successfully") -> dict:
    return {"success": True, "data": data, "message": message}


def error(code: str, message: str) -> dict:
    return {"success": False, "error": {"code": code, "message": message}}
