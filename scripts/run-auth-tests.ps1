param([string]$BaseUrl = "https://dashboard-eta-lime-45.vercel.app")

$routes = @(
  # path | method | category
  "/api/auth/forgot-password|POST|auth",
  "/api/auth/reset-password|GET|auth",
  "/api/auth/reset-password|POST|auth",
  "/api/auth/session|GET|auth",
  "/api/auth/csrf|GET|auth",
  "/api/auth/providers|GET|auth",
  "/api/auth/permissions|GET|protected",
  "/api/cron/gc-hub-sync|GET|cron",
  "/api/cron/geocode-advisors|GET|cron",
  "/api/cron/refresh-cache|GET|cron",
  "/api/cron/trigger-transfer|GET|cron",
  "/api/webhooks/wrike|POST|webhook",
  "/api/webhooks/wrike|GET|webhook",
  "/api/admin/refresh-cache|POST|protected",
  "/api/admin/sga-overview|GET|protected",
  "/api/admin/trigger-transfer|GET|protected",
  "/api/admin/trigger-transfer|POST|protected",
  "/api/advisor-map/locations|GET|protected",
  "/api/advisor-map/locations|POST|protected",
  "/api/advisor-map/overrides|GET|protected",
  "/api/advisor-map/overrides|POST|protected",
  "/api/advisor-map/overrides|DELETE|protected",
  "/api/agent/query|POST|protected",
  "/api/dashboard/conversion-rates|POST|protected",
  "/api/dashboard/data-freshness|GET|protected",
  "/api/dashboard/detail-records|POST|protected",
  "/api/dashboard/export-sheets|POST|protected",
  "/api/dashboard/filters|GET|protected",
  "/api/dashboard/forecast|POST|protected",
  "/api/dashboard/funnel-metrics|POST|protected",
  "/api/dashboard/open-pipeline|POST|protected",
  "/api/dashboard/pipeline-by-sgm|POST|protected",
  "/api/dashboard/pipeline-drilldown|POST|protected",
  "/api/dashboard/pipeline-drilldown-sgm|POST|protected",
  "/api/dashboard/pipeline-sgm-options|GET|protected",
  "/api/dashboard/pipeline-summary|POST|protected",
  "/api/dashboard/record-detail/test-id|GET|protected",
  "/api/dashboard/sgm-conversion-drilldown|POST|protected",
  "/api/dashboard/sgm-conversions|POST|protected",
  "/api/dashboard/source-performance|POST|protected",
  "/api/dashboard-requests|GET|protected",
  "/api/dashboard-requests|POST|protected",
  "/api/dashboard-requests/analytics|GET|protected",
  "/api/dashboard-requests/kanban|POST|protected",
  "/api/dashboard-requests/recent|GET|protected",
  "/api/dashboard-requests/test-id/archive|POST|protected",
  "/api/dashboard-requests/test-id/attachments|GET|protected",
  "/api/dashboard-requests/test-id/attachments|POST|protected",
  "/api/dashboard-requests/test-id/comments|GET|protected",
  "/api/dashboard-requests/test-id/comments|POST|protected",
  "/api/dashboard-requests/test-id/status|PATCH|protected",
  "/api/dashboard-requests/test-id/unarchive|POST|protected",
  "/api/explore/feedback|POST|protected",
  "/api/games/pipeline-catcher/leaderboard|GET|protected",
  "/api/games/pipeline-catcher/leaderboard|POST|protected",
  "/api/games/pipeline-catcher/levels|GET|protected",
  "/api/games/pipeline-catcher/play/2025-Q1|GET|protected",
  "/api/gc-hub/advisor-detail|POST|protected",
  "/api/gc-hub/advisors|POST|protected",
  "/api/gc-hub/filters|POST|protected",
  "/api/gc-hub/manual-sync|POST|protected",
  "/api/gc-hub/override|PUT|protected",
  "/api/gc-hub/period|POST|protected",
  "/api/gc-hub/period|DELETE|protected",
  "/api/gc-hub/summary|POST|protected",
  "/api/gc-hub/sync-status|GET|protected",
  "/api/metabase/content|GET|protected",
  "/api/notifications|GET|protected",
  "/api/notifications/mark-all-read|POST|protected",
  "/api/notifications/unread-count|GET|protected",
  "/api/notifications/test-id/read|POST|protected",
  "/api/recruiter-hub/external-agencies|GET|protected",
  "/api/recruiter-hub/opportunities|GET|protected",
  "/api/recruiter-hub/opportunities|POST|protected",
  "/api/recruiter-hub/prospects|POST|protected",
  "/api/saved-reports|GET|protected",
  "/api/saved-reports|POST|protected",
  "/api/saved-reports/default|GET|protected",
  "/api/saved-reports/test-id|GET|protected",
  "/api/saved-reports/test-id|PUT|protected",
  "/api/saved-reports/test-id|DELETE|protected",
  "/api/saved-reports/test-id/duplicate|POST|protected",
  "/api/saved-reports/test-id/set-default|POST|protected",
  "/api/sga-activity/activity-records|POST|protected",
  "/api/sga-activity/dashboard|POST|protected",
  "/api/sga-activity/filters|GET|protected",
  "/api/sga-activity/scheduled-calls|POST|protected",
  "/api/sga-hub/admin-quarterly-progress|GET|protected",
  "/api/sga-hub/closed-lost|GET|protected",
  "/api/sga-hub/drill-down/initial-calls|POST|protected",
  "/api/sga-hub/drill-down/qualification-calls|POST|protected",
  "/api/sga-hub/drill-down/sqos|POST|protected",
  "/api/sga-hub/leaderboard|POST|protected",
  "/api/sga-hub/leaderboard-sga-options|GET|protected",
  "/api/sga-hub/manager-quarterly-goal|GET|protected",
  "/api/sga-hub/manager-quarterly-goal|POST|protected",
  "/api/sga-hub/quarterly-goals|GET|protected",
  "/api/sga-hub/quarterly-goals|POST|protected",
  "/api/sga-hub/quarterly-progress|POST|protected",
  "/api/sga-hub/re-engagement|GET|protected",
  "/api/sga-hub/sqo-details|POST|protected",
  "/api/sga-hub/weekly-actuals|POST|protected",
  "/api/sga-hub/weekly-goals|GET|protected",
  "/api/sga-hub/weekly-goals|POST|protected",
  "/api/users|GET|protected",
  "/api/users|POST|protected",
  "/api/users/me/change-password|POST|protected",
  "/api/users/taggable|GET|protected",
  "/api/users/test-id|GET|protected",
  "/api/users/test-id|PUT|protected",
  "/api/users/test-id|DELETE|protected",
  "/api/users/test-id/reset-password|POST|protected"
)

$results = @()

foreach ($entry in $routes) {
  $parts    = $entry -split "\|"
  $path     = $parts[0]
  $method   = $parts[1]
  $category = $parts[2]
  $url      = "$BaseUrl$path"

  $status = "ERR"
  $snippet = ""

  try {
    $params = @{
      Uri             = $url
      Method          = $method
      TimeoutSec      = 20
      UseBasicParsing = $true
    }
    if ($method -in @("POST","PUT","PATCH","DELETE")) {
      $params.Body        = "{}"
      $params.ContentType = "application/json"
    }

    $r       = Invoke-WebRequest @params -ErrorAction Stop
    $status  = [int]$r.StatusCode
    $snippet = ($r.Content -replace '\s+',' ').Substring(0, [Math]::Min(200, $r.Content.Length))
  }
  catch [System.Net.WebException] {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $body   = $reader.ReadToEnd()
        $snippet = ($body -replace '\s+',' ').Substring(0, [Math]::Min(200, $body.Length))
      } catch {}
    } else {
      $status = "CONN_ERR"
    }
  }
  catch {
    $status = "ERR:$($_.Exception.Message.Substring(0,[Math]::Min(60,$_.Exception.Message.Length)))"
  }

  $results += [PSCustomObject]@{
    Path     = $path
    Method   = $method
    Category = $category
    Status   = "$status"
    Snippet  = $snippet
  }

  Write-Host "$method $path => $status"
}

$results | ConvertTo-Json -Depth 3 | Out-File -FilePath "$PSScriptRoot\auth-test-raw.json" -Encoding UTF8
Write-Host "Done. Results written to scripts\auth-test-raw.json"
