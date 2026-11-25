# Quant-Sherlocks
Explainable AI trading terminal: a calibrated ML model gives the chance a price rises, shows why, and never trades without your approval. Stocks and 24/7 crypto on Alpaca paper trading. FastAPI + JS dashboard.

User interface of **ASTB**, an explainable AI trading terminal (paper trading only), built by Team Quant Sherlocks (RVITM) for wHACKiest 2026.

**Frontend only.** This repo contains the UI in `static/`. The trading and ML backend (FastAPI) is kept private, so the UI needs that API to show live data. See the demo video for the full working app: <add YouTube link>.

## What the UI has
- Live candlestick chart with drawing tools, buy/sell arrows, stocks and crypto side by side
- AI signal gauge and "Why this signal" factor bars
- Safety gate and risk limits panel, Manual / Auto bot switch, crypto bot panel
- World markets map with open/close countdowns
- Chat assistant and login page

Stack: HTML, JavaScript, CSS, lightweight-charts. Not financial advice.
