#!/bin/bash
set -e

mkdir -p my-garden/src/lib my-garden/supabase/migrations
cd my-garden

cat > package.json <<'JSON'
{
  "name": "my-garden",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "jspdf": "^3.0.1",
    "lucide-react": "^0.525.0",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^5.0.2",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.11",
    "typescript": "^5.9.2",
    "vite": "^7.1.2"
  }
}
JSON

cat > index.html <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Garden</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
HTML

cat > vite.config.ts <<'TS'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
TS

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
JSON

cat > postcss.config.js <<'JS'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
JS

cat > src/styles.css <<'CSS'
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  margin: 0;
  font-family: system-ui, sans-serif;
}

body {
  background: #f4fbf4;
}
CSS

cat > src/main.tsx <<'TS'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
TS

cat > src/lib/pdf.ts <<'TS'
import { jsPDF } from 'jspdf'

export function exportGardenPDF(title: string, plants: Array<{ name: string; x: number; y: number; color: string }>) {
  const doc = new jsPDF()
  doc.setFontSize(18)
  doc.text(title, 14, 20)
  doc.setFontSize(12)
  plants.forEach((plant, i) => {
    doc.text(`${i + 1}. ${plant.name} (${plant.x}, ${plant.y}) ${plant.color}`, 14, 35 + i * 8)
  })
  doc.save('my-garden-report.pdf')
}
TS

cat > src/App.tsx <<'TS'
import { useMemo, useState } from 'react'
import { Download, Leaf, Plus } from 'lucide-react'
import { exportGardenPDF } from './lib/pdf'

type Plant = {
  id: string
  name: string
  x: number
  y: number
  color: string
}

export default function App() {
  const [plants, setPlants] = useState<Plant[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [yardImage, setYardImage] = useState<string | null>(null)

  const selectedPlant = useMemo(
    () => plants.find((p) => p.id === selectedId) ?? null,
    [plants, selectedId],
  )

  function addPlantAt(x: number, y: number) {
    const plant: Plant = {
      id: crypto.randomUUID(),
      name: `Plant ${plants.length + 1}`,
      x,
      y,
      color: '#22c55e',
    }
    setPlants((prev) => [...prev, plant])
    setSelectedId(plant.id)
  }

  function updateSelected(updater: (p: Plant) => Plant) {
    if (!selectedPlant) return
    setPlants((prev) => prev.map((p) => (p.id === selectedPlant.id ? updater(p) : p)))
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="rounded-3xl bg-green-700 p-6 text-white shadow-lg">
          <div className="flex items-center gap-3">
            <Leaf />
            <h1 className="text-3xl font-bold">My Garden</h1>
          </div>
          <p className="mt-2 text-green-100">Click the yard to add plants.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl bg-white p-4 shadow">
            <div className="mb-3 flex items-center justify-between">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-green-100 px-4 py-2 font-medium text-green-800">
                Upload Yard Image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setYardImage(URL.createObjectURL(file))
                  }}
                />
              </label>

              <button
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-white"
                onClick={() => exportGardenPDF('My Garden', plants)}
              >
                <Download size={18} />
                PDF Report
              </button>
            </div>

            <div
              className="relative h-[600px] overflow-hidden rounded-2xl border-2 border-dashed border-green-200 bg-green-50"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const x = Math.round(((e.clientX - rect.left) / rect.width) * 100)
                const y = Math.round(((e.clientY - rect.top) / rect.height) * 100)
                addPlantAt(x, y)
              }}
            >
              {yardImage ? (
                <img src={yardImage} alt="Yard" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-green-700">
                  Click anywhere to place a plant
                </div>
              )}

              {plants.map((plant) => (
                <button
                  key={plant.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedId(plant.id)
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                  style={{
                    left: `${plant.x}%`,
                    top: `${plant.y}%`,
                    width: 18,
                    height: 18,
                    background: plant.color,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-3xl bg-white p-4 shadow">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Plus size={18} />
              Plant Editor
            </div>

            {selectedPlant ? (
              <div className="space-y-3">
                <input
                  className="w-full rounded-xl border p-2"
                  value={selectedPlant.name}
                  onChange={(e) => updateSelected((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Name"
                />
                <input
                  className="w-full rounded-xl border p-2"
                  type="number"
                  value={selectedPlant.x}
                  onChange={(e) => updateSelected((p) => ({ ...p, x: Number(e.target.value) }))}
                  placeholder="X"
                />
                <input
                  className="w-full rounded-xl border p-2"
                  type="number"
                  value={selectedPlant.y}
                  onChange={(e) => updateSelected((p) => ({ ...p, y: Number(e.target.value) }))}
                  placeholder="Y"
                />
                <input
                  className="h-12 w-full rounded-xl border p-2"
                  type="color"
                  value={selectedPlant.color}
                  onChange={(e) => updateSelected((p) => ({ ...p, color: e.target.value }))}
                />
              </div>
            ) : (
              <p className="text-sm text-gray-500">Select a plant to edit it.</p>
            )}

            <div className="space-y-2">
              {plants.map((p) => (
                <button
                  key={p.id}
                  className={`w-full rounded-xl border p-3 text-left ${p.id === selectedId ? 'border-green-500 bg-green-50' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-sm text-gray-500">
                    X: {p.x} Y: {p.y}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
TS

cat > supabase/migrations/001_init.sql <<'SQL'
create table if not exists yards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists plants (
  id uuid primary key default gen_random_uuid(),
  yard_id uuid not null references yards(id) on delete cascade,
  name text not null,
  x integer not null,
  y integer not null,
  color text not null default '#22c55e',
  created_at timestamptz not null default now()
);
SQL

npm install
echo "Done. Run: cd my-garden && npm run dev"
