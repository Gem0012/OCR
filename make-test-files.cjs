// One-off test file generator (not part of the service).
const fs = require("fs");

function makePdf(lines) {
  const content = lines
    .map((line, i) => `BT /F1 20 Tf 72 ${700 - i * 30} Td (${line.replace(/([()\\])/g, "\\$1")}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

fs.writeFileSync(
  "C:/OCR/test-invoice.pdf",
  makePdf([
    "INVOICE FROM ACME SUPPLIES LTD",
    "Invoice number: INV-2026-0100",
    "Date issued: 2026-10-01",
    "Vendor reference: ACME-EU",
    "Total amount due: 3,420.75 EUR",
    "Payment terms within 30 days.",
  ]),
);
fs.writeFileSync("C:/OCR/test-blank.pdf", makePdf([])); // no text -> scanned path

const XLSX = require("xlsx");
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ["Item", "Amount"],
  ["Consulting", "2500"],
  ["Travel", "920.5"],
]);
XLSX.utils.book_append_sheet(wb, ws, "Costs");
XLSX.writeFile(wb, "C:/OCR/test-sheet.xlsx");

fs.writeFileSync("C:/OCR/test-data.csv", "client_name,invoice_total,paid\nDunder Mifflin,1830.25,yes\n");

console.log("test files ready");
