#!/usr/bin/env python3
"""Normalize, merge, and exactly deduplicate audited Chinese-database exports."""

from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path


OUTPUT_FIELDS = [
    "canonical_id", "source_databases", "search_families", "source_files",
    "source_record_ids", "title", "authors", "year", "journal", "doi",
    "abstract", "keywords", "url", "publication_type", "occurrence_count",
    "duplicate_status", "dedupe_basis",
]


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", "" if value is None else str(value)).strip()


def norm_title(value: str) -> str:
    value = unicodedata.normalize("NFKC", clean(value)).lower()
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value)


def norm_doi(value: str) -> str:
    value = clean(value).lower()
    value = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi\s*:\s*)", "", value)
    return value.rstrip(" .;,)。；，")


def norm_year(value: str) -> str:
    match = re.search(r"(?:19|20)\d{2}", clean(value))
    return match.group(0) if match else ""


def join_unique(values, separator: str = "; ") -> str:
    output = []
    seen = set()
    for value in values:
        text = clean(value)
        if text and text not in seen:
            seen.add(text)
            output.append(text)
    return separator.join(output)


def family_from_name(name: str) -> str:
    match = re.search(r"_([A-Za-z]+\d+)(?:_|\b)", name)
    return match.group(1).upper() if match else "unclassified"


def parse_tagged_records(path: Path, database: str) -> list[dict[str, str]]:
    records: list[dict[str, list[str]]] = []
    current: dict[str, list[str]] = {}
    last_tag = ""
    tag_re = re.compile(r"^([A-Z][A-Z0-9])(?:[\s\u00a0]+(.*))?$")
    for raw_line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        match = tag_re.match(raw_line)
        if match:
            tag, value = match.groups()
            if tag == "RT" and current:
                records.append(current)
                current = {}
            current.setdefault(tag, []).append(clean(value or ""))
            last_tag = tag
        elif raw_line.strip() and last_tag and current.get(last_tag):
            current[last_tag][-1] = clean(current[last_tag][-1] + " " + raw_line)
    if current:
        records.append(current)

    output = []
    for data in records:
        def first(*tags: str) -> str:
            return next((data[tag][0] for tag in tags if data.get(tag)), "")

        title = first("T1", "TI", "CT")
        url = first("UL", "LK", "UR")
        source_id = first("ID", "AN") or url
        if not source_id:
            source_id = hashlib.sha1((title + first("YR", "PY", "Y1")).encode("utf-8")).hexdigest()[:16]
        output.append({
            "database": database,
            "family": family_from_name(path.name),
            "source_file": path.name,
            "source_record_id": source_id,
            "title": title,
            "authors": join_unique(data.get("A1", []) + data.get("AU", [])),
            "year": norm_year(first("YR", "PY", "Y1")),
            "journal": first("JF", "JO", "T2", "PB"),
            "doi": norm_doi(first("DO")),
            "abstract": first("AB", "N2"),
            "keywords": join_unique(data.get("K1", []) + data.get("KW", [])),
            "url": url,
            "publication_type": first("RT", "CL"),
        })
    return output


def node_text(node: ET.Element | None) -> str:
    return clean("".join(node.itertext())) if node is not None else ""


def parse_vip_xml(path: Path) -> list[dict[str, str]]:
    root = ET.parse(path).getroot()
    output = []
    for paper in root.findall(".//PeriodicalPaper"):
        source_id = node_text(paper.find("ID"))
        title = node_text(paper.find("Titles/Title/Text"))
        if not source_id:
            source_id = hashlib.sha1((title + node_text(paper.find("PublishDate"))).encode("utf-8")).hexdigest()[:16]
        output.append({
            "database": "VIP",
            "family": family_from_name(path.name),
            "source_file": path.name,
            "source_record_id": source_id,
            "title": title,
            "authors": join_unique(node_text(node.find("Name")) for node in paper.findall("Creators/Creator")),
            "year": norm_year(node_text(paper.find("PublishDate"))),
            "journal": node_text(paper.find("Periodical/Name")),
            "doi": norm_doi(node_text(paper.find("DOI")) or node_text(paper.find("Doi"))),
            "abstract": join_unique((node_text(node.find("Text")) for node in paper.findall("Abstracts/Abstract")), " "),
            "keywords": join_unique(node_text(node) for node in paper.findall("Keywords/Keyword")),
            "url": node_text(paper.find("URL")),
            "publication_type": "PeriodicalPaper",
        })
    return output


class UnionFind:
    def __init__(self, count: int):
        self.parent = list(range(count))

    def find(self, value: int) -> int:
        while self.parent[value] != value:
            self.parent[value] = self.parent[self.parent[value]]
            value = self.parent[value]
        return value

    def union(self, left: int, right: int) -> None:
        a, b = self.find(left), self.find(right)
        if a != b:
            self.parent[b] = a


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--fuzzy-threshold", type=float, default=0.92)
    parser.add_argument("--allow-unregistered", action="store_true")
    args = parser.parse_args()

    project = args.project.resolve()
    audit_path = project / "logs" / "v1_export_audit.json"
    if not audit_path.exists():
        raise SystemExit("Run audit_exports.py before merge_deduplicate.py")
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    allowed = {"pass"}
    if args.allow_unregistered:
        allowed.add("unregistered")
    accepted_files = {item["relative_path"] for item in audit.get("files", []) if item.get("status") in allowed}
    rejected = [item for item in audit.get("files", []) if item.get("status") not in allowed]
    if rejected and not args.allow_unregistered:
        raise SystemExit("Audit contains files that are not pass; correct the ledger or use --allow-unregistered for an exploratory run")

    records: list[dict[str, str]] = []
    for relative in sorted(accepted_files):
        path = project / Path(relative)
        database = path.parent.name.upper()
        parsed = parse_vip_xml(path) if path.suffix.lower() == ".xml" else parse_tagged_records(path, database)
        records.extend(parsed)

    for index, record in enumerate(records, start=1):
        record["occurrence_id"] = f"O{index:07d}"
        record["normalized_title"] = norm_title(record["title"])

    union = UnionFind(len(records))
    seen_ids: dict[tuple[str, str], int] = {}
    seen_dois: dict[str, int] = {}
    seen_titles: dict[str, int] = {}
    basis: dict[tuple[int, int], str] = {}
    for index, record in enumerate(records):
        sid_key = (record["database"], record["source_record_id"])
        if record["source_record_id"] and sid_key in seen_ids:
            union.union(index, seen_ids[sid_key])
            basis[(index, seen_ids[sid_key])] = "database_record_id"
        else:
            seen_ids[sid_key] = index
        if record["doi"]:
            if record["doi"] in seen_dois:
                union.union(index, seen_dois[record["doi"]])
                basis[(index, seen_dois[record["doi"]])] = "exact_doi"
            else:
                seen_dois[record["doi"]] = index
        if record["normalized_title"]:
            if record["normalized_title"] in seen_titles:
                union.union(index, seen_titles[record["normalized_title"]])
                basis[(index, seen_titles[record["normalized_title"]])] = "exact_normalized_title"
            else:
                seen_titles[record["normalized_title"]] = index

    groups: dict[int, list[int]] = defaultdict(list)
    for index in range(len(records)):
        groups[union.find(index)].append(index)

    all_rows = []
    canonical_rows = []
    mapping_rows = []
    root_to_canonical = {}
    for number, (root, indexes) in enumerate(sorted(groups.items(), key=lambda item: min(item[1])), start=1):
        canonical_id = f"CN{number:07d}"
        root_to_canonical[root] = canonical_id
        items = [records[index] for index in indexes]
        preferred = max(items, key=lambda item: (bool(item["abstract"]), len(item["abstract"]), bool(item["doi"]), len(item["title"])))
        group_basis = []
        if len(items) > 1:
            if len({item["doi"] for item in items if item["doi"]}) == 1 and any(item["doi"] for item in items):
                group_basis.append("exact_doi")
            if len({item["normalized_title"] for item in items if item["normalized_title"]}) == 1:
                group_basis.append("exact_normalized_title")
        canonical_rows.append({
            "canonical_id": canonical_id,
            "source_databases": join_unique(item["database"] for item in items),
            "search_families": join_unique(item["family"] for item in items),
            "source_files": join_unique(item["source_file"] for item in items),
            "source_record_ids": join_unique(item["source_record_id"] for item in items),
            "title": preferred["title"],
            "authors": join_unique(item["authors"] for item in items),
            "year": preferred["year"],
            "journal": preferred["journal"],
            "doi": preferred["doi"],
            "abstract": preferred["abstract"],
            "keywords": join_unique(item["keywords"] for item in items),
            "url": preferred["url"],
            "publication_type": join_unique(item["publication_type"] for item in items),
            "occurrence_count": len(items),
            "duplicate_status": "duplicate_group" if len(items) > 1 else "unique",
            "dedupe_basis": join_unique(group_basis) if group_basis else "none",
        })
        for item in items:
            row = dict(item)
            row["canonical_id"] = canonical_id
            all_rows.append(row)
            mapping_rows.append({
                "canonical_id": canonical_id,
                "occurrence_id": item["occurrence_id"],
                "database": item["database"],
                "search_family": item["family"],
                "source_file": item["source_file"],
                "source_record_id": item["source_record_id"],
                "title": item["title"],
                "doi": item["doi"],
            })

    fuzzy_rows = []
    candidates = [(row["canonical_id"], norm_title(row["title"]), row["title"], row["year"]) for row in canonical_rows]
    for left_index, left in enumerate(candidates):
        for right in candidates[left_index + 1:]:
            if not left[1] or not right[1] or left[1] == right[1]:
                continue
            if left[3] and right[3] and left[3] != right[3]:
                continue
            if left[1][0] != right[1][0]:
                continue
            length_ratio = min(len(left[1]), len(right[1])) / max(len(left[1]), len(right[1]))
            if length_ratio < 0.80:
                continue
            similarity = difflib.SequenceMatcher(None, left[1], right[1]).ratio()
            if similarity >= args.fuzzy_threshold:
                fuzzy_rows.append({
                    "left_canonical_id": left[0], "right_canonical_id": right[0],
                    "left_title": left[2], "right_title": right[2],
                    "similarity": f"{similarity:.4f}", "human_decision": "", "notes": "",
                })

    tables = project / "tables"
    tables.mkdir(parents=True, exist_ok=True)
    all_fields = [
        "occurrence_id", "canonical_id", "database", "family", "source_file", "source_record_id",
        "title", "authors", "year", "journal", "doi", "abstract", "keywords", "url", "publication_type",
    ]
    write_csv(tables / "v1_all_records.csv", all_rows, all_fields)
    write_csv(tables / "v1_deduplicated_records.csv", canonical_rows, OUTPUT_FIELDS)
    write_csv(tables / "v1_duplicate_source_mapping.csv", mapping_rows, [
        "canonical_id", "occurrence_id", "database", "search_family", "source_file", "source_record_id", "title", "doi",
    ])
    write_csv(tables / "v1_fuzzy_review_candidates.csv", fuzzy_rows, [
        "left_canonical_id", "right_canonical_id", "left_title", "right_title", "similarity", "human_decision", "notes",
    ])
    screening = [{
        "canonical_id": row["canonical_id"], "title": row["title"], "abstract": row["abstract"],
        "year": row["year"], "source_databases": row["source_databases"],
        "search_families": row["search_families"], "ai_suggestion": "", "human_decision": "",
        "exclusion_reason": "", "reviewer": "", "review_date": "", "notes": "",
    } for row in canonical_rows]
    write_csv(tables / "v1_title_abstract_screening_ledger.csv", screening, [
        "canonical_id", "title", "abstract", "year", "source_databases", "search_families",
        "ai_suggestion", "human_decision", "exclusion_reason", "reviewer", "review_date", "notes",
    ])

    summary = {
        "raw_occurrences": len(records),
        "exact_unique_records": len(canonical_rows),
        "removed_exact_duplicate_occurrences": len(records) - len(canonical_rows),
        "duplicate_groups": sum(1 for row in canonical_rows if row["occurrence_count"] > 1),
        "fuzzy_review_candidates": len(fuzzy_rows),
    }
    (project / "logs" / "v1_merge_deduplication_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

