@echo off
REM Sobe a plataforma e a reinicia sozinha se cair. Rodar UMA vez so (duas copias = dois tuneis ngrok
REM no mesmo dominio = ERR_NGROK_6030). Log em logs\servidor.out.log e logs\servidor.err.log.
REM Arquivo em ASCII com quebra de linha CRLF: o cmd do Windows embaralha .bat em UTF-8/LF.
cd /d "%~dp0"
if not exist logs mkdir logs
set PYTHONIOENCODING=utf-8
set PYTHONUNBUFFERED=1

:loop
REM Um ngrok orfao de uma queda anterior manteria o dominio ocupado.
taskkill /F /IM ngrok.exe >nul 2>&1
echo [%date% %time%] Iniciando servidor >> logs\servidor.out.log
.\venv\Scripts\python.exe Backend\app.py >> logs\servidor.out.log 2>> logs\servidor.err.log
echo [%date% %time%] Servidor parou (codigo %errorlevel%); reiniciando em 5 s >> logs\servidor.out.log
REM ping espera ~5 s e funciona mesmo sem janela de console (o timeout nao).
ping -n 6 127.0.0.1 >nul
goto loop
