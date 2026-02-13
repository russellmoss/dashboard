# Run this after adding your SSH key to GitHub at https://github.com/settings/ssh/new
# Your public key is in clipboard (or in ~/.ssh/id_ed25519.pub)
Set-Location $PSScriptRoot
git push origin main
if ($LASTEXITCODE -eq 0) { Write-Host "Push succeeded." } else { Write-Host "If Permission denied: add the key from .ssh\id_ed25519.pub at https://github.com/settings/ssh/new then run this again." }
