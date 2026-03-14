# Portfolio Heatmap 📊

App de heatmap tipo Finviz para tu cartera personal. Diseñada para iPhone.

## Deploy en Vercel (5 minutos)

### Paso 1 — Instala Vercel CLI
```bash
npm install -g vercel
```
(necesitas Node.js instalado en Mac)

### Paso 2 — Sube el proyecto
```bash
cd portfolio-heatmap
vercel
```
Sigue las instrucciones:
- Set up and deploy? → **Y**
- Which scope? → tu cuenta
- Link to existing project? → **N**
- Project name → `portfolio-heatmap` (o el que quieras)
- In which directory is your code? → **./**
- Override settings? → **N**

### Paso 3 — Abre desde iPhone
Vercel te dará una URL como `https://portfolio-heatmap-xxx.vercel.app`

Ábrela en Safari → toca "Compartir" → "Añadir a pantalla de inicio" 🏠

---

## Uso de la app

1. Toca **✎** para añadir tus posiciones (ticker + nº acciones + precio medio de compra)
2. El mapa se refresca automáticamente cada 60 segundos
3. Toca cualquier celda para ver el detalle completo
4. Cambia la métrica temporal con los botones 1D / 5D / 1M / 6M / 1A

---

## Estructura del proyecto
```
portfolio-heatmap/
├── api/
│   └── quotes.py        ← Serverless function (Yahoo Finance)
├── src/
│   ├── main.jsx
│   └── App.jsx          ← App React completa
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

## Desarrollo local
```bash
npm install
npm run dev
```
