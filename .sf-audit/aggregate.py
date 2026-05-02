"""Aggregate ApiTotalUsage log to identify top API consumers."""
import csv
from collections import Counter, defaultdict

PATH = "./.sf-audit/api_usage_2026-04-21.csv"

total = 0
counting = 0  # rows where COUNTS_AGAINST_API_LIMIT == '1' or 'true'
by_user = Counter()
by_app = Counter()
by_ip = Counter()
by_client_name = Counter()
by_user_app = Counter()
by_resource = Counter()
by_method = Counter()
by_family = Counter()
by_category = Counter()
hourly = Counter()

# Only count rows that count against limit, for the "offender" rankings
by_user_counted = Counter()
by_app_counted = Counter()
by_ip_counted = Counter()

with open(PATH, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        total += 1
        counts_raw = (row.get("COUNTS_AGAINST_API_LIMIT") or "").strip().lower()
        counts = counts_raw in ("1", "true", "yes")
        if counts:
            counting += 1

        user = f"{row.get('USER_NAME','')} ({row.get('USER_ID','')[:15]})"
        app = row.get("CONNECTED_APP_NAME") or row.get("CLIENT_NAME") or "(unknown)"
        ip = row.get("CLIENT_IP") or "(unknown)"
        client_name = row.get("CLIENT_NAME") or "(unknown)"

        by_user[user] += 1
        by_app[app] += 1
        by_ip[ip] += 1
        by_client_name[client_name] += 1
        by_user_app[(user, app)] += 1
        by_resource[row.get("API_RESOURCE") or "(unknown)"] += 1
        by_method[row.get("HTTP_METHOD") or "(unknown)"] += 1
        by_family[row.get("API_FAMILY") or "(unknown)"] += 1
        by_category[row.get("API_CLIENT_CATEGORY") or "(unknown)"] += 1

        ts = row.get("TIMESTAMP_DERIVED") or ""
        # e.g. 2026-04-21T15:00:00.000Z
        hour = ts[:13]
        hourly[hour] += 1

        if counts:
            by_user_counted[user] += 1
            by_app_counted[app] += 1
            by_ip_counted[ip] += 1

def show(title, counter, n=10):
    print(f"\n=== {title} (top {n}) ===")
    for k, v in counter.most_common(n):
        if isinstance(k, tuple):
            print(f"  {v:>7}  {k[0]}  ||  {k[1]}")
        else:
            print(f"  {v:>7}  {k}")

print(f"Total rows in log: {total:,}")
print(f"Rows counting against limit: {counting:,}")
print(f"Rows NOT counting (free): {total-counting:,}")

show("By USER (all calls)", by_user, 10)
show("By USER (calls that count against limit)", by_user_counted, 10)
show("By CONNECTED APP (all calls)", by_app, 10)
show("By CONNECTED APP (counted)", by_app_counted, 10)
show("By CLIENT NAME", by_client_name, 10)
show("By CLIENT IP (counted)", by_ip_counted, 10)
show("By USER × APP", by_user_app, 10)
show("By API FAMILY", by_family, 10)
show("By API CLIENT CATEGORY", by_category, 10)
show("By HTTP METHOD", by_method, 10)
show("By API RESOURCE", by_resource, 15)

print("\n=== Hourly distribution ===")
for h, v in sorted(hourly.items()):
    print(f"  {h}: {v:>5} ({'#' * min(80, v // 200)})")
