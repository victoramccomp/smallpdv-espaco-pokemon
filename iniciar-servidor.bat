@echo off
cd /d "%~dp0"
echo SmallPDVMobile em http://localhost:5660  (feche esta janela para parar)
start "" http://localhost:5660
python -m http.server 5660
