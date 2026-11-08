#!/usr/bin/env python3
"""Audit original Chinese-database exports without modifying them."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime
from pathlib import Path


SUPPORTED_DATABASES = {"cnki", "wanfang", "vip", "sinomed"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_refworks(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n")
    types = [match.group(1).strip() for match in re.finditer(r"^RT\s+(.+)$", text, re.M)]
    titles = re.findall(r"^(?:T1|TI)\s+.+$", text, re.M)
    return {
        "record_count": len(types),
        "title_count": len(titles),
        "abstract_count": len(re.findall(r"^AB\s+.+$", text, re.M)),
        "record_types": dict(Counter(types)),
    }


def parse_vip_xml(path: Path) -> dict:
    root = ET.parse(path).getroot()
    papers = root.findall(".//PeriodicalPaper")
    title_count = 0
    abstract_count = 0
    for paper in papers:
        title = paper.find("Titles/Title/Text")
        if title is not None and "".join(title.itertext()).strip():
            title_count += 1
        if paper.find("Abstracts/Abstract") is not None:
            abstract_count += 1
    return {
        "record_count": len(papers),
        "title_count": title_count,
        "abstract_count": abstract_count,
        "record_types": {"PeriodicalPaper": len(papers)},
    }


def database_from_path(path: Path, raw_root: Path) -> str:
    relative = path.relative_to(raw_root)
    first = relative.parts[0].lower() if relative.parts else "unknown"
    return first if first in SUPPORTED_DATABASES else "unknown"


def family_from_name(name: str) -> str:
    match = re.search(r"_([A-Za-z]+\d+)(?:_|\b)", name)
    return match.group(1).upper() if match else "unclassified"


def read_ledger(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    return {row.get("export_file", "").strip().lower(): row for row in rows if row.get("export_file", "").strip()}


def int_or_none(value: str | None) -> int | None:
    text = (value or "").strip()
    return int(text) if text.isdigit() else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    args = parser.parse_args()

    project = args.project.resolve()
    raw_root = project / "imports" / "raw"
    tables = project / "tables"
    logs = project / "logs"
    reports = project / "reports"
    for directory in (tables, logs, reports):
        directory.mkdir(parents=True, exist_ok=True)
    if not raw_root.exists():
        raise SystemExit(f"Missing raw input directory: {raw_root}")

    ledger = read_ledger(tables / "v1_search_run_ledger.csv")
    files = sorted([p for p in raw_root.rglob("*") if p.is_file() and p.suffix.lower() in {".txt", ".xml"}])
    rows: list[dict] = []
    errors: list[dict] = []
    for path in files:
        try:
            parsed = parse_vip_xml(path) if path.suffix.lower() == ".xml" else parse_refworks(path)
            registered = ledger.get(path.name.lower())
            expected = int_or_none(registered.get("expected_records")) if registered else None
            selected = int_or_none(registered.get("selected_count")) if registered else None
            if parsed["record_count"] <= 0:
                status = "fail"
                reason = "zero_records"
            elif parsed["title_count"] != parsed["record_count"]:
                status = "fail"
                reason = "title_record_mismatch"
            elif expected is not None and expected != parsed["record_count"]:
                status = "fail"
                reason = "expected_record_mismatch"
            elif selected is not None and selected != parsed["record_count"]:
                status = "fail"
                reason = "selected_record_mismatch"
            elif not registered:
                status = "unregistered"
                reason = "missing_ledger_row"
            else:
                status = "pass"
                reason = ""
            rows.append({
                "database": database_from_path(path, raw_root).upper(),
                "search_family": family_from_name(path.name),
                "file": path.name,
                "relative_path": path.relative_to(project).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
                "record_count": parsed["record_count"],
                "title_count": parsed["title_count"],
                "abstract_count": parsed["abstract_count"],
                "expected_records": expected if expected is not None else "",
                "selected_count": selected if selected is not None else "",
                "status": status,
                "reason": reason,
                "record_types": json.dumps(parsed["record_types"], ensure_ascii=False, sort_keys=True),
            })
        except Exception as exc:  # preserve failure evidence
            errors.append({"file": path.relative_to(project).as_posix(), "error": type(exc).__name__, "message": str(exc)})

    fields = [
        "database", "search_family", "file", "relative_path", "bytes", "sha256",
        "record_count", "title_count", "abstract_count", "expected_records",
        "selected_count", "status", "reason", "record_types",
    ]
    csv_path = tables / "v1_export_batch_audit.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    status_counts = Counter(row["status"] for row in rows)
    audit = {
        "schema_version": "1.0",
        "generated_at": datetime.now().astimezone().isoformat(),
        "project": str(project),
        "file_count": len(rows),
        "parsed_record_occurrences": sum(row["record_count"] for row in rows),
        "status_counts": dict(status_counts),
        "errors": errors,
        "files": rows,
        "formal_merge_ready": bool(rows) and not errors and all(row["status"] == "pass" for row in rows),
    }
    json_path = logs / "v1_export_audit.json"
    json_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report = [
        "# 中文数据库原始导出审计报告",
        "",
        f"生成时间：{audit['generated_at']}",
        "",
        "## 执行摘要",
        "",
        f"本次检查 {len(rows)} 个原始文件，共解析 {audit['parsed_record_occurrences']} 条题录出现次数。",
        f"状态统计：{json.dumps(dict(status_counts), ensure_ascii=False)}。",
        f"正式合并就绪：{'是' if audit['formal_merge_ready'] else '否'}。",
        "",
        "## 判定边界",
        "",
        "本报告只核查本地导出文件、台账数量和文件哈希；数据库页面显示总数仍需在正式检索记录中单独核对。",
    ]
    if errors:
        report.extend(["", "## 解析错误", ""] + [f"- `{e['file']}`：{e['error']} — {e['message']}" for e in errors])
    (reports / "v1_retrieval_audit_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(json.dumps({"audit": str(json_path), "batch_table": str(csv_path), "formal_merge_ready": audit["formal_merge_ready"]}, ensure_ascii=False))
    return 0 if audit["formal_merge_ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

