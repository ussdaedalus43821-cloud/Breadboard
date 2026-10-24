// Dense linear solve for nodal analysis: G · v = i. Gaussian elimination with
// partial pivoting. Circuits here have tens of nodes, so dense is fine.

export function solveLinear(g: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = g.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    if (a[pivot]![col] === 0) throw new Error('singular nodal matrix');
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = a[r]!;
      const f = row[col]! / p[col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) row[c]! -= f * p[c]!;
    }
  }
  const v = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = a[r]!;
    let s = row[n]!;
    for (let c = r + 1; c < n; c++) s -= row[c]! * v[c]!;
    v[r] = s / row[r]!;
  }
  return v;
}
