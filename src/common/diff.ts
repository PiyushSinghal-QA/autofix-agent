/** Extract the changed file paths (the "b/" side) from a unified/git diff. */
export function parseDiffPaths(diff: string): string[] {
  const paths = new Set<string>();
  const gitRe = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = gitRe.exec(diff))) paths.add(m[2].trim());
  if (paths.size === 0) {
    const plusRe = /^\+\+\+ b\/(.+)$/gm;
    while ((m = plusRe.exec(diff))) {
      const p = m[1].trim();
      if (p && p !== '/dev/null') paths.add(p);
    }
  }
  return [...paths];
}

/** Pull a git-apply-compatible diff out of an LLM response (handles ``` fences). */
export function extractUnifiedDiff(text: string): string {
  const fenced = text.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const idx = body.search(/^diff --git |^--- /m);
  const out = idx >= 0 ? body.slice(idx) : body;
  return out.trimEnd() + '\n';
}

export function countChanges(diff: string): { additions: number; deletions: number } {
  const additions = (diff.match(/^\+(?!\+\+)/gm) || []).length;
  const deletions = (diff.match(/^-(?!--)/gm) || []).length;
  return { additions, deletions };
}
