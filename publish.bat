@echo off
cd /d "%~dp0"

REM Build the extension and publish only if build succeeds
npm run build && npx vsce publish
