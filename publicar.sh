#!/usr/bin/env bash
# Publica el Sistema de Marcaje en Netlify (Ubuntu / Linux / Mac)
cd "$(dirname "$0")"
echo "[1/2] Instalando dependencias..."
npm install
echo "[2/2] Publicando en Netlify (la primera vez se abre el navegador para iniciar sesión)..."
npx -y netlify-cli@latest deploy --prod --site-name marcaje-facial-luna
