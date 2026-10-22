const { describe, it, expect } = require('vitest');
const path = require('path');
const pdfPath = path.join(__dirname, 'fixtures', 'danfe-incotech-2967-original.pdf');
const fs = require('fs');

if (!fs.existsSync(pdfPath)) {
  console.error('PDF NÃO EXISTE:', pdfPath);
  process.exit(1);
}

const { buildOcrTrace } = require('../lib/danfe-ocr.ts');

describe('round22 - NFE DANFE V2 - DERREPI PASSEI O THEIR CARD', () => {
  it('should be a valid PDF with DANFE final', () => {
    // Este teste é apenas para verificar o caminho do PDF
    expect(fs.existsSync(pdfPath)).toBe(true);
  });
});
