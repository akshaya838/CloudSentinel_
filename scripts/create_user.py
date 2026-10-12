"""
Create a user from the command line. Use this instead of demo seeding in a real
deployment (demo users are never seeded when ENVIRONMENT=production).

    python scripts/create_user.py --email jane@yourco.com --name "Jane Doe" --role analyst

The password is read from the NEW_USER_PASSWORD environment variable if set,
otherwise prompted for (never passed on the command line, so it stays out of
shell history).
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import models  # noqa: E402,F401
from app.database.connection import Base, SessionLocal, engine  # noqa: E402
from app.services import auth_service  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a CloudSentinel user")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--role", required=True, choices=["admin", "analyst", "viewer"])
    args = parser.parse_args()

    password = os.getenv("NEW_USER_PASSWORD") or getpass.getpass("Password: ")
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        try:
            user = auth_service.create_user(db, args.email, args.name, args.role, password)
        except auth_service.AuthError as e:
            print(f"Error: {e.message}")
            return 1
    print(f"Created {user.role} user {user.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
