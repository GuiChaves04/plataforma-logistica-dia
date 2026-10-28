@echo off
chcp 65001 >nul
echo ===================================================
echo CONFIGURACAO DO NGROK PARA ACESSO EXTERNO 24/7
echo ===================================================
echo.
echo 1. Crie uma conta gratuita em: https://dashboard.ngrok.com/signup
echo 2. Pegue seu Authtoken em: https://dashboard.ngrok.com/get-started/your-authtoken
echo 3. (Opcional) Pegue seu Dominio Fixo (Domains) em: https://dashboard.ngrok.com/cloud-edge/domains
echo.
set /p authtoken="Cole seu Authtoken do Ngrok (ou aperte Enter para pular): "
set /p domain="Cole seu Dominio Fixo (ex: seu-app.ngrok-free.app) (ou aperte Enter para pular): "

echo.
echo Salvando configuracoes em .env...
> .env echo NGROK_AUTHTOKEN=%authtoken%
if not "%domain%"=="" (
    >> .env echo NGROK_DOMAIN=%domain%
)
echo.
echo ===================================================
echo CONFIGURACAO SALVA COM SUCESSO! 
echo A partir de agora, a sua plataforma usara esta URL fixa.
echo Voce pode rodar o instalar_servidor.bat (para atualizar dependencias) 
echo e depois iniciar o seu aplicativo normalmente.
echo ===================================================
pause
