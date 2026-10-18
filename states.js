// Zuordnung australischer Postleitzahlen zu Bundesstaaten nach den
// offiziellen Nummernbereichen von Australia Post.
// Wird sowohl im Browser (window.AUState) als auch im Build-Skript genutzt.
(function (root) {
  const RANGES = [
    ['ACT', 200, 299], ['ACT', 2600, 2618], ['ACT', 2900, 2920],
    ['NT', 800, 999],
    ['NSW', 1000, 2599], ['NSW', 2619, 2899], ['NSW', 2921, 2999],
    ['VIC', 3000, 3999], ['VIC', 8000, 8999],
    ['QLD', 4000, 4999], ['QLD', 9000, 9999],
    ['SA', 5000, 5999],
    ['WA', 6000, 6999],
    ['TAS', 7000, 7999],
  ];

  function stateOf(code) {
    const n = parseInt(code, 10);
    if (Number.isNaN(n)) return null;
    for (const [state, lo, hi] of RANGES) {
      if (n >= lo && n <= hi) return state;
    }
    return null;
  }

  const api = { stateOf, RANGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AUState = api;
})(typeof self !== 'undefined' ? self : this);
