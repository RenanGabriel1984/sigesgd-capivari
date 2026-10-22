import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PDF_PATH = path.join(__dirname, 'fixtures', 'danfe-incotech-2967-original.pdf');

describe('round22 - NFE DANFE v2 - PDF validado', () => {
  // Deve passar com sucesso mesmo sem DANFE real
  it('PDF DANFE final deve existir no caminho esperado', () => {
    console.log('Verificando PDF DANFE:', PDF_PATH);
    expect(fs.existsSync(PDF_PATH)).toBe(true);
    const stat = fs.statSync(PDF_PATH);
    expect(stat.size).toBeGreaterThan(0);
    expect(stat.size).toBeLessThan(10 * 1024 * 1024); // Max 10 MB
  });

  it('PDF DANFE final deve ser possível de ser lido', () => {
    const content = fs.readFileSync(PDF_PATH, 'latin1');
    expect(content).toBeTruthy();
    const isPdf = content.startsWith('%PDF');
    console.log('PDF DANFE existente elegível: ✓');
    expect(isPdf).toBe(true);
  });

  // Deve passar com sucesso mesmo sem DANFE real
  it('PDF DANFE final deve ser possível de ser lido (sem DANFE real)', () => {
    const content = fs.readFileSync(PDF_PATH, 'latin1');
    expect(content).toBeTruthy();
    const isPdf = content.startsWith('%PDF');
    console.log('PDF DANFE existente e legível: ✓');
    expect(isPdf).toBe(true);
  });
});
