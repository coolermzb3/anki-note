# Raw reviews as the source of truth

Practice analytics and adaptive queue weights are derived from raw review records, not treated as independent facts. Cached daily or per-note statistics may be added for performance, but they must remain rebuildable from reviews so chart definitions, weighting formulas, and storage optimizations can evolve without losing historical data.
