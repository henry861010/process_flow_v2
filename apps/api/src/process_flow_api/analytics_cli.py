"""Maintenance: python -m process_flow_api.analytics_cli --help."""
from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .analytics import SCHEMA_VERSION, consistent_backup


def open_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        row = connection.execute("SELECT value FROM analytics_metadata WHERE key='schema_version'").fetchone()
        if row is None or row[0] != str(SCHEMA_VERSION):
            raise ValueError("Unsupported analytics schema version")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Analytics integrity check failed")
        return connection
    except BaseException:
        connection.close()
        raise


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Analytics backup, offline restore and capacity inspection")
    parser.add_argument("--db", required=True, type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("backup", help="Consistent backup of a running SQLite database")
    backup.add_argument("--output", required=True, type=Path)
    restore = commands.add_parser("restore", help="Restore after stopping the API process")
    restore.add_argument("--source", required=True, type=Path)
    restore.add_argument("--offline", action="store_true", required=True,
                         help="Assert the API process has been stopped")
    restore.add_argument("--replace", action="store_true", help="Allow replacing an existing database")
    commands.add_parser("inspect", help="Read-only integrity, size and row count inspection")
    args = parser.parse_args(argv)
    if args.command == "restore":
        if args.source.resolve() == args.db.resolve():
            parser.error("Source and destination must differ")
        if args.db.exists() and not args.replace:
            parser.error("Destination exists; use --replace for an offline restore")
        if any(Path(str(args.db) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
            parser.error("SQLite sidecars exist; shut down the API and checkpoint the database before restore")
        with closing(open_readonly(args.source)) as source:
            consistent_backup(source, args.db)
        return
    with closing(open_readonly(args.db)) as connection:
        if args.command == "backup":
            if args.db.resolve() == args.output.resolve():
                parser.error("Source and destination must differ")
            consistent_backup(connection, args.output)
        else:
            report = {"schema_version": SCHEMA_VERSION, "integrity": "ok",
                      "database_bytes": args.db.stat().st_size,
                      "wal_bytes": Path(str(args.db) + "-wal").stat().st_size if Path(str(args.db) + "-wal").exists() else 0}
            for table in ("api_requests", "usage_events"):
                row = connection.execute(f"SELECT count(*), min(occurred_at), max(occurred_at) FROM {table}").fetchone()
                report[table] = {"rows": row[0], "oldest": row[1], "newest": row[2]}
            print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
