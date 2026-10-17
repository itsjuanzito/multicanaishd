# mobile/restart-dev.ps1
# Mata processos node.exe orfaos do Metro/Watchman (problema comum no Windows
# quando o servidor Expo e parado com Ctrl+C e os workers nao encerram junto)
# antes de subir o Expo do zero com cache limpo.

Write-Host "Encerrando processos node.exe orfaos..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

Start-Sleep -Seconds 1

$remaining = Get-Process node -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "Aviso: ainda ha processos node.exe rodando." -ForegroundColor Red
} else {
    Write-Host "Nenhum processo node.exe residual. Iniciando Expo..." -ForegroundColor Green
}

npx expo start -c
