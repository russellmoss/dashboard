"""Aggregate LoginHistory for corroboration."""
import json
from collections import Counter

d = json.load(open("./.sf-audit/logins.json"))
records = d.get("records", [])
print(f"LoginHistory records (last 48h): {len(records)}")

by_user = Counter()
by_app = Counter()
by_type = Counter()
by_ip = Counter()
by_user_app = Counter()

for r in records:
    uid = r.get("UserId") or "(none)"
    app = r.get("Application") or "(none)"
    ltype = r.get("LoginType") or "(none)"
    ip = r.get("SourceIp") or "(none)"
    by_user[uid] += 1
    by_app[app] += 1
    by_type[ltype] += 1
    by_ip[ip] += 1
    by_user_app[(uid, app)] += 1

def show(title, counter, n=10):
    print(f"\n=== {title} (top {n}) ===")
    for k,v in counter.most_common(n):
        if isinstance(k, tuple):
            print(f"  {v:>6}  {k[0]}  ||  {k[1]}")
        else:
            print(f"  {v:>6}  {k}")

show("By UserId", by_user, 15)
show("By Application", by_app, 15)
show("By LoginType", by_type, 10)
show("By SourceIp", by_ip, 15)
show("By User × App", by_user_app, 15)
