import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

function pattern(name: 'repository' | 'memory'): RegExp {
  return new RegExp(`^${name}-(\\d{5})\\.usearch$`);
}

export function generationFileName(name: 'repository' | 'memory', generation: number): string {
  return `${name}-${generation.toString().padStart(5, '0')}.usearch`;
}

export function listGenerations(dir: string, name: 'repository' | 'memory'): number[] {
  const re = pattern(name);
  const generations: number[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = re.exec(entry.name);
    if (match?.[1]) generations.push(Number.parseInt(match[1], 10));
  }
  return generations.sort((a, b) => a - b);
}

export function removeOtherGenerations(dir: string, name: 'repository' | 'memory', keep: number): void {
  for (const generation of listGenerations(dir, name)) {
    if (generation === keep) continue;
    unlinkSync(join(dir, generationFileName(name, generation)));
  }
}
