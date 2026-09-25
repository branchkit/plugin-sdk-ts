/**
 * Does `eventType` match a subscription `pattern`, in the platform's topic
 * grammar? A topic is dot-separated segments (so `a..b` has an empty middle
 * one); in a pattern, `*` is exactly one whole segment, `**` is zero or more
 * whole segments, and anything else is literal text (`write_*` and `a**`
 * included). A pattern equal to the topic always matches. Because `**` may
 * match nothing, `a.**` matches `a` itself and `a.**.b` matches `a.b`.
 *
 * The platform's delivery gate uses the same grammar to decide what reaches
 * the plugin at all, so the two must agree or a plugin's own routing
 * disagrees with what it receives. `__tests__/testdata/topic-match-conformance.json`
 * is a byte-identical copy of the platform's conformance table, and
 * `__tests__/topic.test.ts` runs its subscription column against this.
 *
 * Internal: `onPattern` is the public surface that uses it.
 */
export function matchesTopic(pattern: string, eventType: string): boolean {
  if (pattern === eventType) return true;
  // With no `*` anywhere every segment is literal, so the pattern names
  // exactly one topic, which the equality above already tested.
  if (!pattern.includes("*")) return false;
  const pat = pattern.split(".");
  const evt = eventType.split(".");
  // Greedy, backtracking to the most recent `**`: what lies between two `**`
  // has a fixed length, so the latest one is the only one worth retrying, and
  // the match is O(pat × evt) at worst.
  let p = 0;
  let e = 0;
  let resumeP = -1;
  let resumeE = -1;
  while (e < evt.length) {
    if (p < pat.length && pat[p] === "**") {
      resumeP = p + 1;
      resumeE = e;
      p++;
    } else if (p < pat.length && (pat[p] === "*" || pat[p] === evt[e])) {
      p++;
      e++;
    } else if (resumeP >= 0) {
      resumeE++;
      p = resumeP;
      e = resumeE;
    } else {
      return false;
    }
  }
  for (; p < pat.length; p++) {
    if (pat[p] !== "**") return false;
  }
  return true;
}
