@echo off
chcp 65001 >nul
echo ========================================================
echo   Running Numbers - Synchronisation des fichiers .TCX
echo ========================================================
python "%~dp0actualiser_dossier_tcx.py"
echo.
echo Vous pouvez maintenant ouvrir ou rafraichir index.html !
pause
