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
