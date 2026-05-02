$ErrorActionPreference = "Stop"

$cloudflaredPath = ".\cloudflared.exe"

# Download cloudflared if it doesn't exist
if (-not (Test-Path $cloudflaredPath)) {
    Write-Host "Downloading cloudflared (Cloudflare Tunnels) for free secure internet access..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cloudflaredPath
    Write-Host "Download complete." -ForegroundColor Green
}

Write-Host "Starting Cloudflare Tunnel for your local server (Port 5000)..." -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "Please wait a few seconds. A URL ending in '.trycloudflare.com' will appear below." -ForegroundColor Yellow
Write-Host "Copy that URL and paste it into Vercel as your VITE_API_URL environment variable." -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Yellow

# Start the tunnel
& $cloudflaredPath tunnel --url http://localhost:5000
