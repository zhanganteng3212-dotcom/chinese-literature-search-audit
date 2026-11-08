#!/usr/bin/env python3
"""End-to-end smoke test using only synthetic records."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, text=True, encoding="utf-8", errors="replace", capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {command}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    temporary_root = SKILL_ROOT / "tests" / ".tmp"
    temporary_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="chinese_lit_audit_", dir=temporary_root) as temporary:
        project = Path(temporary) / "demo_project"
        shutil.copytree(SKILL_ROOT / "examples" / "demo_project", project)
        run([sys.executable, str(SKILL_ROOT / "scripts" / "audit_exports.py"), "--project", str(project)])
        run([sys.executable, str(SKILL_ROOT / "scripts" / "merge_deduplicate.py"), "--project", str(project)])
        audit = json.loads((project / "logs" / "v1_export_audit.json").read_text(encoding="utf-8"))
        summary = json.loads((project / "logs" / "v1_merge_deduplication_summary.json").read_text(encoding="utf-8"))
        assert audit["formal_merge_ready"] is True, audit
        assert audit["file_count"] == 3, audit
        assert audit["parsed_record_occurrences"] == 5, audit
        assert summary == {
            "raw_occurrences": 5,
            "exact_unique_records": 4,
            "removed_exact_duplicate_occurrences": 1,
            "duplicate_groups": 1,
            "fuzzy_review_candidates": 1,
        }, summary
        ledger_path = project / "tables" / "v1_search_run_ledger.csv"
        ledger_text = ledger_path.read_text(encoding="utf-8-sig")
        ledger_path.write_text(ledger_text.replace(",3,3,exported,synthetic demo", ",3,99,exported,synthetic demo", 1), encoding="utf-8-sig")
        negative = subprocess.run(
            [sys.executable, str(SKILL_ROOT / "scripts" / "audit_exports.py"), "--project", str(project)],
            text=True, encoding="utf-8", errors="replace", capture_output=True,
        )
        failed_audit = json.loads((project / "logs" / "v1_export_audit.json").read_text(encoding="utf-8"))
        assert negative.returncode == 2, negative
        assert failed_audit["formal_merge_ready"] is False, failed_audit
        assert failed_audit["status_counts"].get("fail") == 1, failed_audit
        payload = {
            "status": "pass",
            "positive_audit": audit["status_counts"],
            "summary": summary,
            "negative_count_mismatch_check": "pass",
        }
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(payload, ensure_ascii=False))
    try:
        temporary_root.rmdir()
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

