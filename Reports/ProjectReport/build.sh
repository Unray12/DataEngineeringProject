#!/usr/bin/env bash
set -u
B="${MIKTEX_BIN:-/d/App/Miktex/App/miktex/bin/x64}"
cd "$(dirname "$0")"
"$B/pdflatex.exe" --enable-installer -interaction=nonstopmode -halt-on-error main.tex > build-1.log 2>&1 || { echo "pass 1 failed"; grep -nE "^!" main.log | head; exit 1; }
"$B/biber.exe" main > build-biber.log 2>&1 || { echo "biber failed"; tail -20 build-biber.log; exit 1; }
"$B/pdflatex.exe" --enable-installer -interaction=nonstopmode -halt-on-error main.tex > build-2.log 2>&1 || { echo "pass 2 failed"; grep -nE "^!" main.log | head; exit 1; }
"$B/pdflatex.exe" --enable-installer -interaction=nonstopmode -halt-on-error main.tex > build-3.log 2>&1 || { echo "pass 3 failed"; grep -nE "^!" main.log | head; exit 1; }
grep -E "Output written" main.log
grep -E "Warning: (Citation|Reference|Label).*" main.log | sort | uniq | head -20
