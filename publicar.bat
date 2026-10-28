@echo off
chcp 65001 >nul
title Publicar Sistema de Marcaje en Netlify
cd /d "%~dp0"
echo.
echo  [1/2] Instalando dependencias...
call npm install
echo.
echo  [2/2] Publicando en Netlify. La primera vez se abrira el navegador para iniciar sesion.
call npx -y netlify-cli@latest deploy --prod --site-name marcaje-facial-luna
echo.
echo  Listo. El link aparece arriba como "Production URL" o "Deployed to production URL".
pause
