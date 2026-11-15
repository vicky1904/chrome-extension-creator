export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(x: string) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: string): string {
    this.add(x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    // Path compression.
    let c = x;
    while (this.parent.get(c) !== r) {
      const next = this.parent.get(c)!;
      this.parent.set(c, r);
      c = next;
    }
    return r;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const ka = this.rank.get(ra)!;
    const kb = this.rank.get(rb)!;
    if (ka < kb) this.parent.set(ra, rb);
    else if (kb < ka) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, ka + 1);
    }
  }

  /** Groups with at least two members. */
  groups(): string[][] {
    const by = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      const g = by.get(r);
      if (g) g.push(x);
      else by.set(r, [x]);
    }
    return [...by.values()].filter((g) => g.length > 1);
  }
}
