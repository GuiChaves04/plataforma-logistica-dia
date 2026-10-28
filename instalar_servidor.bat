@echo off
REM Cria o venv e instala as dependencias fixadas em requirements.txt.
REM Arquivo em ASCII com quebra de linha CRLF.
cd /d "%~dp0"
echo ===================================================
echo INSTALADOR - PLATAFORMA DE LOGISTICA
echo ===================================================
echo.

echo 1. Criando ambiente virtual (venv)...
if not exist venv python -m venv venv

echo.
echo 2. Instalando as bibliotecas de requirements.txt...
call .\venv\Scripts\python.exe -m pip install --upgrade pip
call .\venv\Scripts\python.exe -m pip install -r requirements.txt

echo.
echo 3. Preparando arquivos de configuracao local...
if not exist .env copy .env.example .env >nul
if not exist Backend\config_local.json copy Backend\config_local.example.json Backend\config_local.json >nul

echo.
echo 4. Configurando VS Code...
if not exist ".vscode" mkdir .vscode
echo { > .vscode\settings.json
echo     "python.defaultInterpreterPath": ".\\venv\\Scripts\\python.exe" >> .vscode\settings.json
echo } >> .vscode\settings.json

echo.
echo ===================================================
echo INSTALACAO CONCLUIDA
echo ===================================================
echo Preencha o .env e o Backend\config_local.json e depois rode iniciar_servidor.bat
echo.
pause
