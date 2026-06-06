@echo off
REM ============================================================
REM  HIRE XA - Frontend preview
REM  DOUBLE-CLICK THIS FILE. It starts a local server and opens
REM  http://localhost:8000/ in your browser automatically.
REM  Keep the window open while you work; close it / Ctrl+C to stop.
REM ============================================================
cd /d "%~dp0"
python preview.py
echo.
echo If you saw a "python is not recognized" error, install Python from
echo https://www.python.org/downloads/ (tick "Add to PATH"), or use Node:
echo    npx serve -l 8000
echo and then open http://localhost:8000/ manually.
echo.
pause
