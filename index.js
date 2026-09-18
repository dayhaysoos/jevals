export function accuracy(results) {
  if (!results.length) return null;
  return results.filter(({ expected, actual }) => expected === actual).length
    / results.length;
}
