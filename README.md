# EcoSense AQI Dashboard

Real-time Air Quality Index (AQI) monitoring dashboard featuring half-circle gas gauges (CO₂, CO, NO₂) with fluid easing transitions and visual alerts (pulse & gentle shake animations on safe limit violations), rolling line charts for Temperature and Humidity with integer Y-axis and 2-decimal hover tooltips, and Start/Stop controls.

---

## How to Run on Your System After Downloading

You have **two simple ways** to run this dashboard:

### Method 1: Instant Zero-Dependency Run (No Node.js or Installation Needed)
If you do not have Node.js or prefer not to install any dependencies:
1. Double-click **`standalone.html`** in this folder (or right-click -> Open with Chrome / Edge / Firefox / Safari).
2. The dashboard will run immediately with 100% functionality:
   - Full live 5-second polling loop & simulation fallback
   - Half-circle gas gauges with animated needles
   - Safe limit visual alerts (shake & pulse)
   - Temperature & Humidity rolling line charts with whole-number Y-axis & 2-decimal hover tooltips
   - Start/Stop Dashboard controls
   - Bright Mode / Dark Mode toggle

---

### Method 2: Standard React Application (Node.js)
All unnecessary dependencies have been removed. The repository contains only the lean essentials:
1. Open terminal in this folder and install dependencies:
   ```bash
   npm install
   ```
2. Start the local development server:
   ```bash
   npm run dev
   ```
3. Open your browser at **`http://localhost:3000`**.
