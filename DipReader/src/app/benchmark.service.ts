import { Injectable } from '@angular/core';

export interface BenchmarkResult {
  engine: string;   // 'SQLite' | 'Tantivy'
  operation: string; // es. 'search', 'populate'
  durationMs: number;
  details?: string;  // es. 'Query: "fattura" - Risultati: 50'
  timestamp: Date;
}

@Injectable({ providedIn: 'root' })
export class BenchmarkService {
  private results: BenchmarkResult[] = [];

  // Mappa per tracciare i timer attivi
  private timers = new Map<string, number>();

  /**
   * Avvia il cronometro per un'operazione.
   * Restituisce una funzione da chiamare per fermarlo (utile per async/await).
   */
  startTimer(engine: string, operation: string) {
    const start = performance.now();
    
    // Ritorna una funzione "stop" da chiamare alla fine
    return (details?: string) => {
      const end = performance.now();
      const duration = parseFloat((end - start).toFixed(2)); // Arrotonda a 2 decimali
      
      const result: BenchmarkResult = {
        engine,
        operation,
        durationMs: duration,
        details,
        timestamp: new Date()
      };
      
      this.results.unshift(result); // Aggiunge in cima
      console.log(`[Benchmark] ${engine}::${operation} -> ${duration}ms (${details || ''})`);
    };
  }

  getResults(): BenchmarkResult[] {
    return this.results;
  }

  clear(): void {
    this.results = [];
  }
  
  // Calcola la media per una specifica operazione/motore
  getAverage(engine: string, operation: string): string {
    const items = this.results.filter(r => r.engine === engine && r.operation === operation);
    if (items.length === 0) return 'N/A';
    const sum = items.reduce((acc, curr) => acc + curr.durationMs, 0);
    return (sum / items.length).toFixed(2) + 'ms';
  }
}