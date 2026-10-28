@echo off
echo ===================================================
echo INSTALADOR AUTOMATICO - PLATAFORMA DE LOGISTICA
echo ===================================================
echo.

echo 1. Criando Ambiente Virtual (venv)...
python -m venv venv

echo.
echo 2. Instalando as bibliotecas necessarias...
call .\venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
call .\venv\Scripts\python.exe -m pip install Flask waitress oracledb qrcode pyngrok python-dotenv

echo.
echo 3. Gerando requirements.txt...
call .\venv\Scripts\python.exe -m pip freeze > requirements.txt

echo.
echo 4. Configurando VS Code...
if not exist ".vscode" mkdir .vscode
echo { > .vscode\settings.json
echo     "python.defaultInterpreterPath": ".\\venv\\Scripts\\python.exe" >> .vscode\settings.json
echo } >> .vscode\settings.json

echo.
echo ===================================================
echo INSTALACAO CONCLUIDA COM SUCESSO!
echo ===================================================
echo Para iniciar o servidor, basta rodar o comando:
echo .\venv\Scripts\python.exe Backend\app.py
echo.
pause
