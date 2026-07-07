#!/usr/bin/env python3
"""טיוב אוטומטי של קובץ לקוחות: השלמת מספר ח"פ מרשם החברות הישראלי (data.gov.il).

הרצה בסיסית:
    python enrich_companies.py --input customers.csv --output customers_enriched.csv

לקבלת כל האפשרויות:
    python enrich_companies.py --help
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Optional

import pandas as pd
import requests
from rapidfuzz import fuzz

DATASTORE_SEARCH_URL = "https://data.gov.il/api/3/action/datastore_search"
RESOURCE_ID = "f00517d5-6f43-474c-879e-5a1e74b1267b"
REQUEST_TIMEOUT = 15

GENERIC_EMAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "yahoo.com",
    "walla.co.il", "walla.com", "icloud.com", "aol.com", "live.com", "msn.com",
    "protonmail.com", "zoho.com", "mail.com", "015.net.il", "013.net",
    "bezeqint.net", "yandex.com",
}

LEGAL_SUFFIXES = [
    'בע"מ', "בעמ", "בע''מ", "ltd.", "ltd", "inc.", "inc", "corp.", "corp",
    "llc", "co.", "company",
]

COLUMN_ALIASES = {
    "company_name": ["שם חברה", "שם החברה", "שם לקוח", "לקוח", "company", "company_name", "customer", "name"],
    "email": ["אימייל", "מייל", "email", "e-mail"],
}


def find_column(df: pd.DataFrame, aliases: list[str]) -> Optional[str]:
    lowered = {c.lower().strip(): c for c in df.columns}
    for alias in aliases:
        key = alias.lower().strip()
        if key in lowered:
            return lowered[key]
    return None


def normalize_company_name(name: str) -> str:
    if not isinstance(name, str):
        return ""
    text = name.strip()
    text = re.sub(r'["\'׳״]', "", text)
    for suffix in LEGAL_SUFFIXES:
        text = re.compile(re.escape(suffix), re.IGNORECASE).sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_domain(email: Optional[str]) -> Optional[str]:
    if not isinstance(email, str) or "@" not in email:
        return None
    domain = email.strip().lower().split("@")[-1]
    return domain or None


def is_corporate_domain(domain: Optional[str]) -> bool:
    return bool(domain) and domain not in GENERIC_EMAIL_DOMAINS


def domain_to_name_guess(domain: str) -> str:
    return domain.split(".")[0]


@dataclass
class FieldMap:
    hp_field: str
    name_fields: list[str]


def discover_field_map(session: requests.Session) -> FieldMap:
    """שולף פעם אחת את רשימת השדות האמיתית מה-API, במקום להניח שמות שדות קבועים."""
    resp = session.get(
        DATASTORE_SEARCH_URL,
        params={"resource_id": RESOURCE_ID, "limit": 1},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    fields = [f["id"] for f in resp.json()["result"]["fields"] if f["id"] != "_id"]

    hp_field = next(
        (f for f in fields if 'מספר חברה' in f or 'ח"פ' in f or f.lower() in {"company_id", "companyid", "hp"}),
        None,
    )
    if hp_field is None:
        hp_field = next((f for f in fields if "מספר" in f), fields[0])

    name_fields = [f for f in fields if "שם" in f or "name" in f.lower()]
    if not name_fields:
        name_fields = fields

    return FieldMap(hp_field=hp_field, name_fields=name_fields)


def search_company(session: requests.Session, query: str, limit: int, retries: int = 2) -> list[dict]:
    if not query:
        return []
    params = {"resource_id": RESOURCE_ID, "q": query, "limit": limit}
    last_exc = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(DATASTORE_SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            payload = resp.json()
            return payload["result"].get("records", []) if payload.get("success") else []
        except (requests.RequestException, ValueError) as exc:
            last_exc = exc
            time.sleep(1 + attempt)
    print(f"שגיאת API עבור השאילתה '{query}': {last_exc}", file=sys.stderr)
    return []


def score_candidates(query_name: str, records: list[dict], field_map: FieldMap) -> list[tuple[float, dict]]:
    normalized_query = normalize_company_name(query_name)
    scored = []
    for record in records:
        candidate_names = [normalize_company_name(record.get(f, "")) for f in field_map.name_fields]
        candidate_names = [c for c in candidate_names if c]
        if not candidate_names:
            continue
        score = max(fuzz.WRatio(normalized_query, c) for c in candidate_names)
        scored.append((score, record))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored


def ai_disambiguate(row_info: dict, candidates: list[dict], field_map: FieldMap, api_key: str, model: str) -> Optional[str]:
    """הכרעה בעזרת קלוד כאשר יש כמה מועמדים קרובים בציון ההתאמה."""
    try:
        import anthropic
    except ImportError:
        print("החבילה anthropic אינה מותקנת (pip install anthropic) - מדלג על הכרעת AI", file=sys.stderr)
        return None

    client = anthropic.Anthropic(api_key=api_key)

    row_summary = "\n".join(f"{k}: {v}" for k, v in row_info.items() if pd.notna(v) and str(v).strip())
    candidates_text = "\n".join(
        f"{i}) ח\"פ={c.get(field_map.hp_field)} | " + " / ".join(str(c.get(f, "")) for f in field_map.name_fields if c.get(f))
        for i, c in enumerate(candidates, start=1)
    )

    prompt = (
        "אתה מסייע להתאים רשומת לקוח מה-CRM לחברה הנכונה ברשם החברות הישראלי.\n\n"
        f"נתוני הלקוח:\n{row_summary}\n\n"
        f"מועמדים אפשריים מרשם החברות:\n{candidates_text}\n\n"
        'החזר אך ורק JSON תקני, ללא טקסט נוסף, בפורמט: {"חפ": "מספר ח\\"פ" | null}'
    )

    response = client.messages.create(
        model=model,
        max_tokens=60,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(getattr(block, "text", "") for block in response.content).strip()

    try:
        data = json.loads(text)
        hp = data.get("חפ")
        return str(hp) if hp else None
    except (json.JSONDecodeError, AttributeError):
        match = re.search(r"\d{7,9}", text)
        return match.group(0) if match else None


def read_input(path: str, sheet_name=None) -> pd.DataFrame:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xls"):
        return pd.read_excel(path, sheet_name=sheet_name or 0, dtype=str)
    return pd.read_csv(path, dtype=str, encoding="utf-8-sig")


def write_output(df: pd.DataFrame, path: str) -> None:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xls"):
        df.to_excel(path, index=False)
    else:
        df.to_csv(path, index=False, encoding="utf-8-sig")


def enrich(df: pd.DataFrame, session: requests.Session, field_map: FieldMap, args: argparse.Namespace) -> pd.DataFrame:
    name_col = find_column(df, COLUMN_ALIASES["company_name"])
    email_col = find_column(df, COLUMN_ALIASES["email"])
    if name_col is None:
        raise SystemExit("לא נמצאה עמודת שם חברה בקובץ הקלט (למשל: 'שם חברה' או 'company')")

    api_key = args.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
    use_ai = args.use_ai and bool(api_key)
    if args.use_ai and not api_key:
        print("--use-ai הופעל אך לא סופק מפתח API (--anthropic-api-key או משתנה סביבה ANTHROPIC_API_KEY) - מדלג על AI", file=sys.stderr)

    cache: dict[str, tuple[str, str, str, str]] = {}
    hp_col, status_col, matched_col, score_col, domain_col = [], [], [], [], []

    for idx, row in df.iterrows():
        raw_name = row[name_col]
        company_name = str(raw_name).strip() if pd.notna(raw_name) else ""
        email = row[email_col] if email_col and pd.notna(row[email_col]) else None
        domain = extract_domain(email)
        domain_col.append(domain or "")

        if not company_name:
            hp_col.append("")
            status_col.append("לבדיקה - אין שם חברה")
            matched_col.append("")
            score_col.append("")
            continue

        cache_key = normalize_company_name(company_name)
        if cache_key in cache:
            hp, status, matched_name, score = cache[cache_key]
        else:
            records = search_company(session, company_name, limit=args.max_candidates)
            time.sleep(args.request_delay)

            if not records and is_corporate_domain(domain):
                records = search_company(session, domain_to_name_guess(domain), limit=args.max_candidates)
                time.sleep(args.request_delay)

            scored = score_candidates(company_name, records, field_map)
            hp, status, matched_name, score = "", "לא נמצא", "", ""

            if scored:
                top_score, top_record = scored[0]
                second_score = scored[1][0] if len(scored) > 1 else 0
                ambiguous = len(scored) > 1 and (top_score - second_score) < args.ambiguity_gap

                if top_score >= args.auto_accept_threshold and not ambiguous:
                    hp = str(top_record.get(field_map.hp_field, ""))
                    status = "אוטומטי"
                    matched_name = str(top_record.get(field_map.name_fields[0], ""))
                    score = round(top_score, 1)
                elif top_score >= args.review_threshold:
                    matched_name = str(top_record.get(field_map.name_fields[0], ""))
                    score = round(top_score, 1)
                    if use_ai:
                        ai_hp = ai_disambiguate(row.to_dict(), [r for _, r in scored[:3]], field_map, api_key, args.ai_model)
                        hp, status = (ai_hp, 'הוכרע ע"י AI') if ai_hp else ("", "לבדיקה - ספק")
                    else:
                        status = "לבדיקה - ספק"

            cache[cache_key] = (hp, status, matched_name, score)

        hp_col.append(hp)
        status_col.append(status)
        matched_col.append(matched_name)
        score_col.append(score)

    df['ח"פ'] = hp_col
    df["סטטוס_התאמה"] = status_col
    df["שם_חברה_תואם_ברשם"] = matched_col
    df["ציון_התאמה"] = score_col
    df["דומיין_אימייל"] = domain_col
    return df


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='טיוב קובץ לקוחות עם מספר ח"פ מרשם החברות הישראלי')
    parser.add_argument("--input", default="customers.csv", help="קובץ קלט (CSV או Excel)")
    parser.add_argument("--output", default="customers_enriched.csv", help="קובץ פלט")
    parser.add_argument("--sheet", default=None, help='שם/אינדקס הגיליון עבור קובצי Excel')
    parser.add_argument("--use-ai", action="store_true", help="הפעלת הכרעת AI (Anthropic) במקרי ספק")
    parser.add_argument("--anthropic-api-key", default=None, help="מפתח API של Anthropic (או משתנה סביבה ANTHROPIC_API_KEY)")
    parser.add_argument("--ai-model", default="claude-sonnet-5", help="מודל Claude להכרעה")
    parser.add_argument("--auto-accept-threshold", type=float, default=90.0, help="ציון התאמה מינימלי לקבלה אוטומטית")
    parser.add_argument("--review-threshold", type=float, default=65.0, help="ציון התאמה מינימלי לסימון 'לבדיקה'/AI")
    parser.add_argument("--ambiguity-gap", type=float, default=8.0, help="פער ציון מינימלי בין מועמד ראשון לשני כדי לא להיחשב מעורער")
    parser.add_argument("--max-candidates", type=int, default=5, help="מספר מועמדים מקסימלי לבקש מה-API בכל חיפוש")
    parser.add_argument("--request-delay", type=float, default=0.15, help="השהיה בשניות בין קריאות API")
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()

    if not os.path.exists(args.input):
        raise SystemExit(f"קובץ הקלט לא נמצא: {args.input}")

    df = read_input(args.input, sheet_name=args.sheet)

    session = requests.Session()
    field_map = discover_field_map(session)
    print(f'שדה ח"פ שזוהה אוטומטית: {field_map.hp_field}')
    print(f"שדות שם שזוהו אוטומטית: {', '.join(field_map.name_fields)}")

    enriched = enrich(df, session, field_map, args)
    write_output(enriched, args.output)

    total = len(enriched)
    found = int((enriched['ח"פ'] != "").sum())
    print(f'הושלם: {found}/{total} רשומות קיבלו ח"פ. הקובץ נשמר ב-{args.output}')


if __name__ == "__main__":
    main()
