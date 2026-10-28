@echo off
REM Grava NGROK_AUTHTOKEN e NGROK_DOMAIN no .env SEM apagar as outras chaves (Oracle, Gmail, Fulltrack).
REM Arquivo em ASCII com quebra de linha CRLF.
cd /d "%~dp0"
echo ===================================================
echo CONFIGURACAO DO NGROK PARA ACESSO EXTERNO 24/7
echo ===================================================
echo.
echo 1. Crie uma conta gratuita em: https://dashboard.ngrok.com/signup
echo 2. Pegue seu Authtoken em: https://dashboard.ngrok.com/get-started/your-authtoken
echo 3. (Opcional) Pegue seu Dominio Fixo em: https://dashboard.ngrok.com/cloud-edge/domains
echo.
set /p authtoken="Cole seu Authtoken do Ngrok (ou aperte Enter para pular): "
set /p domain="Cole seu Dominio Fixo (ex: seu-app.ngrok-free.app) (ou aperte Enter para pular): "

if "%authtoken%"=="" if "%domain%"=="" goto fim
if not exist .env if exist .env.example copy .env.example .env >nul
if not exist .env type nul > .env

REM Mantem todas as linhas do .env, menos as do ngrok que estao sendo trocadas
if not "%authtoken%"=="" (
    findstr /v /b "NGROK_AUTHTOKEN=" .env > .env.tmp
    move /y .env.tmp .env >nul
    >> .env echo NGROK_AUTHTOKEN=%authtoken%
)
if not "%domain%"=="" (
    findstr /v /b "NGROK_DOMAIN=" .env > .env.tmp
    move /y .env.tmp .env >nul
    >> .env echo NGROK_DOMAIN=%domain%
)
echo.
echo Configuracao do ngrok salva no .env (as demais chaves foram mantidas).

:fim
echo.
pause
