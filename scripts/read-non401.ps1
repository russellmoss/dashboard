$data = Get-Content "$PSScriptRoot\auth-test-raw.json" -Raw | ConvertFrom-Json
$data | Where-Object { $_.Status -ne "401" } | ConvertTo-Json -Depth 3
