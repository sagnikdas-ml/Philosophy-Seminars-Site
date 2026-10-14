$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

Write-Host 'Set a new admin password for the Pages site.' -ForegroundColor Cyan
$pagesPasswordSecure = Read-Host 'New ADMIN_PASSWORD' -AsSecureString
$pagesPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pagesPasswordSecure)
try {
    $pagesPasswordText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pagesPasswordPointer)
    if ([string]::IsNullOrWhiteSpace($pagesPasswordText)) { throw 'The admin password cannot be empty.' }
    $pagesPasswordText | & npx.cmd wrangler pages secret put ADMIN_PASSWORD --project-name philosophy-seminars-site
    if ($LASTEXITCODE -ne 0) { throw 'Could not save ADMIN_PASSWORD.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pagesPasswordPointer)
    $pagesPasswordText = $null
    $pagesPasswordSecure.Dispose()
}

$pagesSecretBytes = New-Object byte[] 32
$pagesSecretGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $pagesSecretGenerator.GetBytes($pagesSecretBytes) }
finally { $pagesSecretGenerator.Dispose() }
$pagesBridgeSecret = ([BitConverter]::ToString($pagesSecretBytes)).Replace('-', '').ToLowerInvariant()
$pagesBridgeSecret | & npx.cmd wrangler pages secret put APPS_SCRIPT_SECRET --project-name philosophy-seminars-site
if ($LASTEXITCODE -ne 0) { throw 'Could not save APPS_SCRIPT_SECRET.' }

Write-Host ''
Write-Host 'Both new secrets have been saved to Cloudflare Pages.' -ForegroundColor Green
Write-Host 'Copy this new shared secret to your password manager and Google Apps Script:' -ForegroundColor Cyan
Write-Host $pagesBridgeSecret
Write-Host ''
Write-Host 'In the EXISTING Apps Script project, open Project Settings > Script Properties.'
Write-Host 'Set API_SECRET to the exact shared secret above, and save the properties.'
Write-Host 'The existing Apps Script code reads this property on each request.'
Write-Host 'Tell Codex when API_SECRET has been saved, so it can finish the deployment.'
$pagesBridgeSecret = $null
[Array]::Clear($pagesSecretBytes, 0, $pagesSecretBytes.Length)
