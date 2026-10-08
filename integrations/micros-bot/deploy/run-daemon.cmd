@echo off
REM Windows: HotelCost Micros botunu surekli calisan modda baslatir (Gorev Zamanlayici "Bilgisayar acildiginda" icin).
REM Loglar: logs\daemon.log  -  Calisma kayitlari ve hata ekran goruntuleri: runs\
cd /d "%~dp0\.."
if not exist logs mkdir logs
node --import tsx src\cli.ts daemon >> logs\daemon.log 2>&1
