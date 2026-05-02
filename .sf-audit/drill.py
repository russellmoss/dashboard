"""Drill into top 2 offenders: Kenji + Jed."""
import csv
from collections import Counter

PATH = "./.sf-audit/api_usage_2026-04-21.csv"

users_of_interest = {
    "kenji.miyashiro@savvywealth.com": Counter(),
    "jed.entin+integration@savvywealth.com": Counter(),
}
resource_by_user = {k: Counter() for k in users_of_interest}
version_by_user = {k: Counter() for k in users_of_interest}
method_by_user = {k: Counter() for k in users_of_interest}
ip_by_user = {k: Counter() for k in users_of_interest}
app_by_user = {k: Counter() for k in users_of_interest}

with open(PATH, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        uname = row.get("USER_NAME") or ""
        if uname not in users_of_interest:
            continue
        res = row.get("API_RESOURCE") or "(none)"
        resource_by_user[uname][res] += 1
        # Parse version
        ver = "(other)"
        if res.startswith("/v"):
            parts = res.split("/")
            if len(parts) > 1:
                ver = parts[1]
        version_by_user[uname][ver] += 1
        method_by_user[uname][row.get("HTTP_METHOD") or "(none)"] += 1
        ip_by_user[uname][row.get("CLIENT_IP") or "(none)"] += 1
        app = row.get("CONNECTED_APP_NAME") or row.get("CLIENT_NAME") or "(unknown)"
        app_by_user[uname][app] += 1

for u in users_of_interest:
    print(f"\n========== {u} ==========")
    print(f"-- API version --")
    for k,v in version_by_user[u].most_common(10): print(f"  {v:>6}  {k}")
    print(f"-- HTTP method --")
    for k,v in method_by_user[u].most_common(10): print(f"  {v:>6}  {k}")
    print(f"-- Source IP --")
    for k,v in ip_by_user[u].most_common(10): print(f"  {v:>6}  {k}")
    print(f"-- Connected app / client --")
    for k,v in app_by_user[u].most_common(10): print(f"  {v:>6}  {k}")
    print(f"-- Top resources --")
    for k,v in resource_by_user[u].most_common(20): print(f"  {v:>6}  {k}")
