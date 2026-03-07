#!/usr/bin/env pwsh
# ============================================================
# API Auth Coverage Test
# Tests every endpoint for 401 when called with no auth token
# Expected: 401 on everything except /api/auth/* (which may 200/302)
# Usage: .\scripts\test-auth-coverage.ps1
# Usage (quiet): .\scripts\test-auth-coverage.ps1 -Quiet
# Usage (fail-fast): .\scripts\test-auth-coverage.ps1 -FailFast
# ============================================================

param(
    [string]$BaseUrl = "https://dashboard-eta-lime-45.vercel.app",
    [switch]$Quiet,
    [switch]$FailFast
)

$ErrorActionPreference = "Continue"

# --- Route definitions ---
# Format: @{ Path="..."; Methods=@("GET","POST",...); Category="..." }
# Category: "auth" = expected to NOT return 401 (public endpoint)
#           "cron" = uses CRON_SECRET, not session
#           "webhook" = uses signature, not session
#           "protected" = must return 401

$Routes = @(
    # ── Public Auth (expect 200/302/400, NOT 401) ──────────────────────
    @{ Path="/api/auth/forgot-password";             Methods=@("POST");              Category="auth" }
    @{ Path="/api/auth/reset-password";              Methods=@("GET","POST");        Category="auth" }
    @{ Path="/api/auth/signin";                      Methods=@("GET","POST");        Category="auth" }
    @{ Path="/api/auth/signout";                     Methods=@("GET","POST");        Category="auth" }
    @{ Path="/api/auth/session";                     Methods=@("GET");               Category="auth" }
    @{ Path="/api/auth/csrf";                        Methods=@("GET");               Category="auth" }
    @{ Path="/api/auth/providers";                   Methods=@("GET");               Category="auth" }

    # ── Cron (uses CRON_SECRET Bearer, not session — expect 401 without it) ─
    @{ Path="/api/cron/gc-hub-sync";                 Methods=@("GET");               Category="cron" }
    @{ Path="/api/cron/geocode-advisors";            Methods=@("GET");               Category="cron" }
    @{ Path="/api/cron/refresh-cache";               Methods=@("GET");               Category="cron" }
    @{ Path="/api/cron/trigger-transfer";            Methods=@("GET");               Category="cron" }

    # ── Webhooks (uses signature, not session — should 401/400/403) ────
    @{ Path="/api/webhooks/wrike";                   Methods=@("POST","GET");        Category="webhook" }

    # ── Admin ───────────────────────────────────────────────────────────
    @{ Path="/api/admin/refresh-cache";              Methods=@("POST");              Category="protected" }
    @{ Path="/api/admin/sga-overview";               Methods=@("GET");               Category="protected" }
    @{ Path="/api/admin/trigger-transfer";           Methods=@("GET","POST");        Category="protected" }

    # ── Advisor Map ─────────────────────────────────────────────────────
    @{ Path="/api/advisor-map/locations";            Methods=@("GET","POST");        Category="protected" }
    @{ Path="/api/advisor-map/overrides";            Methods=@("GET","POST","DELETE"); Category="protected" }

    # ── Agent / AI ──────────────────────────────────────────────────────
    @{ Path="/api/agent/query";                      Methods=@("POST");              Category="protected" }

    # ── Auth (protected) ────────────────────────────────────────────────
    @{ Path="/api/auth/permissions";                 Methods=@("GET");               Category="protected" }

    # ── Dashboard ───────────────────────────────────────────────────────
    @{ Path="/api/dashboard/conversion-rates";       Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/data-freshness";         Methods=@("GET");               Category="protected" }
    @{ Path="/api/dashboard/detail-records";         Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/export-sheets";          Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/filters";                Methods=@("GET");               Category="protected" }
    @{ Path="/api/dashboard/forecast";               Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/funnel-metrics";         Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/open-pipeline";          Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/pipeline-by-sgm";        Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/pipeline-drilldown";     Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/pipeline-drilldown-sgm"; Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/pipeline-sgm-options";   Methods=@("GET");               Category="protected" }
    @{ Path="/api/dashboard/pipeline-summary";       Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/record-detail/test-id";  Methods=@("GET");               Category="protected" }
    @{ Path="/api/dashboard/sgm-conversion-drilldown"; Methods=@("POST");            Category="protected" }
    @{ Path="/api/dashboard/sgm-conversions";        Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard/source-performance";     Methods=@("POST");              Category="protected" }

    # ── Dashboard Requests ──────────────────────────────────────────────
    @{ Path="/api/dashboard-requests";               Methods=@("GET","POST");        Category="protected" }
    @{ Path="/api/dashboard-requests/analytics";     Methods=@("GET");               Category="protected" }
    @{ Path="/api/dashboard-requests/kanban";        Methods=@("POST");              Category="protected" }
    @{ Path="/api/dashboard-requests/recent";        Methods=@("GET");               Category="protected" }
    @{ Path="/api/dashboard-requests/test-id/archive";     Methods=@("POST");        Category="protected" }
    @{ Path="/api/dashboard-requests/test-id/attachments"; Methods=@("GET","POST");  Category="protected" }
    @{ Path="/api/dashboard-requests/test-id/comments";    Methods=@("GET","POST");  Category="protected" }
    @{ Path="/api/dashboard-requests/test-id/status";      Methods=@("PATCH");       Category="protected" }
    @{ Path="/api/dashboard-requests/test-id/unarchive";   Methods=@("POST");        Category="protected" }

    # ── Explore ─────────────────────────────────────────────────────────
    @{ Path="/api/explore/feedback";                 Methods=@("POST");              Category="protected" }

    # ── Games ───────────────────────────────────────────────────────────
    @{ Path="/api/games/pipeline-catcher/leaderboard"; Methods=@("GET","POST");      Category="protected" }
    @{ Path="/api/games/pipeline-catcher/levels";    Methods=@("GET");               Category="protected" }
    @{ Path="/api/games/pipeline-catcher/play/2025-Q1"; Methods=@("GET");            Category="protected" }

    # ── GC Hub ──────────────────────────────────────────────────────────
    @{ Path="/api/gc-hub/advisor-detail";            Methods=@("POST");              Category="protected" }
    @{ Path="/api/gc-hub/advisors";                  Methods=@("POST");              Category="protected" }
    @{ Path="/api/gc-hub/filters";                   Methods=@("POST");              Category="protected" }
    @{ Path="/api/gc-hub/manual-sync";               Methods=@("POST");              Category="protected" }
    @{ Path="/api/gc-hub/override";                  Methods=@("PUT");               Category="protected" }
    @{ Path="/api/gc-hub/period";                    Methods=@("POST","DELETE");      Category="protected" }
    @{ Path="/api/gc-hub/summary";                   Methods=@("POST");              Category="protected" }
    @{ Path="/api/gc-hub/sync-status";               Methods=@("GET");               Category="protected" }

    # ── Metabase ─────────────────────────────────────────────────────────
    @{ Path="/api/metabase/content";                 Methods=@("GET");               Category="protected" }

    # ── Notifications ────────────────────────────────────────────────────
    @{ Path="/api/notifications";                    Methods=@("GET");               Category="protected" }
    @{ Path="/api/notifications/mark-all-read";      Methods=@("POST");              Category="protected" }
    @{ Path="/api/notifications/unread-count";       Methods=@("GET");               Category="protected" }
    @{ Path="/api/notifications/test-id/read";       Methods=@("POST");              Category="protected" }

    # ── Recruiter Hub ────────────────────────────────────────────────────
    @{ Path="/api/recruiter-hub/external-agencies";  Methods=@("GET");               Category="protected" }
    @{ Path="/api/recruiter-hub/opportunities";      Methods=@("GET","POST");        Category="protected" }
    @{ Path="/api/recruiter-hub/prospects";          Methods=@("POST");              Category="protected" }

    # ── Saved Reports ────────────────────────────────────────────────────
    @{ Path="/api/saved-reports";                    Methods=@("GET","POST");        Category="protected" }
    @{ Path="/api/saved-reports/default";            Methods=@("GET");               Category="protected" }
    @{ Path="/api/saved-reports/test-id";            Methods=@("GET","PUT","DELETE"); Category="protected" }
    @{ Path="/api/saved-reports/test-id/duplicate";  Methods=@("POST");              Category="protected" }
    @{ Path="/api/saved-reports/test-id/set-default"; Methods=@("POST");             Category="protected" }

    # ── SGA Activity ─────────────────────────────────────────────────────
    @{ Path="/api/sga-activity/activity-records";    Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-activity/dashboard";           Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-activity/filters";             Methods=@("GET");               Category="protected" }
    @{ Path="/api/sga-activity/scheduled-calls";     Methods=@("POST");              Category="protected" }

    # ── SGA Hub ──────────────────────────────────────────────────────────
    @{ Path="/api/sga-hub/admin-quarterly-progress"; Methods=@("GET");               Category="protected" }
    @{ Path="/api/sga-hub/closed-lost";              Methods=@("GET");               Category="protected" }
    @{ Path="/api/sga-hub/drill-down/initial-calls"; Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-hub/drill-down/qualification-calls"; Methods=@("POST");        Category="protected" }
    @{ Path="/api/sga-hub/drill-down/sqos";          Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-hub/leaderboard";              Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-hub/leaderboard-sga-options";  Methods=@("GET");               Category="protected" }
    @{ Path="/api/sga-hub/manager-quarterly-goal";   Methods=@("GET","POST");        Category="protected" }
    @{ Path="/api/sga-hub/quarterly-goals";          Methods=@("GET","POST");        Category="protected" }
    @{ Path="/api/sga-hub/quarterly-progress";       Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-hub/re-engagement";            Methods=@("GET");               Category="protected" }
    @{ Path="/api/sga-hub/sqo-details";              Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-hub/weekly-actuals";           Methods=@("POST");              Category="protected" }
    @{ Path="/api/sga-hub/weekly-goals";             Methods=@("GET","POST");        Category="protected" }

    # ── Users ────────────────────────────────────────────────────────────
    @{ Path="/api/users";                            Methods=@("GET","POST");        Category="protected" }
    @{ Path="/api/users/me/change-password";         Methods=@("POST");              Category="protected" }
    @{ Path="/api/users/taggable";                   Methods=@("GET");               Category="protected" }
    @{ Path="/api/users/test-id";                    Methods=@("GET","PUT","DELETE"); Category="protected" }
    @{ Path="/api/users/test-id/reset-password";     Methods=@("POST");              Category="protected" }
)

# ── Helpers ────────────────────────────────────────────────────────────────────

function Write-Header {
    Write-Host ""
    Write-Host "=" * 70 -ForegroundColor Cyan
    Write-Host "  API Auth Coverage Test" -ForegroundColor Cyan
    Write-Host "  Target: $BaseUrl" -ForegroundColor Cyan
    Write-Host "  Routes: $($Routes.Count) route definitions" -ForegroundColor Cyan
    Write-Host "=" * 70 -ForegroundColor Cyan
    Write-Host ""
}

function Invoke-RouteTest {
    param(
        [string]$Url,
        [string]$Method,
        [string]$Category
    )

    $body = $null
    $contentType = $null

    # Provide minimal JSON body for POST/PUT/PATCH so we get auth error, not 400
    if ($Method -in @("POST","PUT","PATCH")) {
        $body = "{}"
        $contentType = "application/json"
    }

    try {
        $params = @{
            Uri             = $Url
            Method          = $Method
            TimeoutSec      = 15
            ErrorAction     = "Stop"
            UseBasicParsing = $true
        }
        if ($body) {
            $params.Body        = $body
            $params.ContentType = $contentType
        }

        $response = Invoke-WebRequest @params
        return $response.StatusCode
    }
    catch [System.Net.WebException] {
        $statusCode = [int]$_.Exception.Response.StatusCode
        return $statusCode
    }
    catch {
        return "ERR:$($_.Exception.Message.Substring(0, [Math]::Min(40,$_.Exception.Message.Length)))"
    }
}

function Get-ResultColor {
    param([string]$Category, [string]$Status)

    if ($Category -eq "auth") {
        # Public endpoints — any non-500 is acceptable
        if ($Status -match "^[2345]\d\d$") { return "Green" }
        return "Yellow"
    }

    # Protected, cron, webhook — must be 401 or 403
    if ($Status -in @("401","403")) { return "Green" }
    if ($Status -in @("400")) { return "Yellow" }   # Might mean auth check passed, body invalid
    return "Red"
}

function Get-PassFail {
    param([string]$Category, [string]$Status)

    if ($Category -eq "auth") {
        if ($Status -notmatch "^5\d\d$") { return "PASS" }
        return "WARN"
    }

    if ($Status -in @("401","403")) { return "PASS" }
    if ($Status -in @("400")) { return "WARN" }
    return "FAIL"
}

# ── Main ───────────────────────────────────────────────────────────────────────

Write-Header

$results  = [System.Collections.Generic.List[PSObject]]::new()
$failures = [System.Collections.Generic.List[PSObject]]::new()
$warnings = [System.Collections.Generic.List[PSObject]]::new()

foreach ($route in $Routes) {
    foreach ($method in $route.Methods) {
        $url    = "$BaseUrl$($route.Path)"
        $status = Invoke-RouteTest -Url $url -Method $method -Category $route.Category
        $pf     = Get-PassFail  -Category $route.Category -Status "$status"
        $color  = Get-ResultColor -Category $route.Category -Status "$status"

        $row = [PSCustomObject]@{
            Method   = $method
            Path     = $route.Path
            Category = $route.Category
            Status   = "$status"
            Result   = $pf
        }

        $results.Add($row)

        if ($pf -eq "FAIL") { $failures.Add($row) }
        if ($pf -eq "WARN") { $warnings.Add($row) }

        if (-not $Quiet) {
            $symbol = switch ($pf) { "PASS" { "[+]" }; "WARN" { "[~]" }; default { "[!]" } }
            Write-Host ("{0} {1,-7} {2,-55} {3} {4}" -f $symbol, $method, $route.Path, $status, $pf) -ForegroundColor $color
        }

        if ($FailFast -and $pf -eq "FAIL") {
            Write-Host "`nFAIL-FAST triggered. Stopping." -ForegroundColor Red
            break
        }
    }
    if ($FailFast -and $failures.Count -gt 0) { break }
}

# ── Summary ────────────────────────────────────────────────────────────────────

$total   = $results.Count
$passed  = ($results | Where-Object { $_.Result -eq "PASS" }).Count
$warned  = ($results | Where-Object { $_.Result -eq "WARN" }).Count
$failed  = ($results | Where-Object { $_.Result -eq "FAIL" }).Count

Write-Host ""
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host ("  Total checks : {0}" -f $total)
Write-Host ("  PASS (401/403): {0}" -f $passed) -ForegroundColor Green
Write-Host ("  WARN (400/other expected): {0}" -f $warned) -ForegroundColor Yellow
Write-Host ("  FAIL (leaked data / no auth): {0}" -f $failed) -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "  UNPROTECTED ROUTES (returned 200/non-401):" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host ("    {0,-7} {1,-50} => HTTP {2}" -f $f.Method, $f.Path, $f.Status) -ForegroundColor Red
    }
}

if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "  WARNINGS (returned 400 — auth may be working, verify manually):" -ForegroundColor Yellow
    foreach ($w in $warnings) {
        Write-Host ("    {0,-7} {1,-50} => HTTP {2}" -f $w.Method, $w.Path, $w.Status) -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "  NOTE: /api/auth/* endpoints are intentionally public." -ForegroundColor DarkGray
Write-Host "  NOTE: 400 on POST endpoints may indicate auth passed but body was invalid." -ForegroundColor DarkGray
Write-Host "  NOTE: Cron routes use CRON_SECRET, not session — 401 is expected without it." -ForegroundColor DarkGray
Write-Host "  NOTE: Webhook route uses HMAC signature — 401/400/403 expected without sig." -ForegroundColor DarkGray
Write-Host ""

# Export CSV
$csvPath = Join-Path $PSScriptRoot "auth-test-results.csv"
$results | Export-Csv -Path $csvPath -NoTypeInformation
Write-Host "  Results exported to: $csvPath" -ForegroundColor DarkGray
Write-Host ""

# Exit with error code if failures exist
if ($failed -gt 0) { exit 1 } else { exit 0 }
