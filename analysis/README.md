# Offline queue analysis

This subproject reads the app backup as immutable input and writes every generated CSV, JSON, Markdown draft, and plot to
the ignored `output/` directory. It does not import data into the app or modify files under `../backup/`.

From the repository root:

```powershell
uv sync --project analysis
uv run --project analysis anki-note-analysis
uv run --project analysis pytest
```

Optional paths can be supplied explicitly:

```powershell
uv run --project analysis anki-note-analysis --backup-dir backup --output-dir analysis/output
```

The analysis selects the latest session's effective target-note set and uses each note's latest 100 qualified scheduler
reviews for queue metrics. This keeps the evidence count equal across notes without allowing low-volume calendar days to
make one note noisier than another. Daily charts independently use the same P33/P67 review-volume levels as the app
heatmap; medium and high days are retained for robust progress summaries.

Queue backtesting is a distribution replay, not an outcome forecast. At each historical cutoff it freezes measured speed
and error statistics, continuously draws 300 notes from each policy, and updates exposure after every draw. The resulting
`output/queue_replay_*.csv` files show note allocation, tier allocation, effective note count, minimum coverage, and the
longest unseen gap. Cross-day alignment files are auxiliary diagnostics only; historical outcomes cannot reveal what
learning outcome an unchosen policy would have caused.

The production `adaptive_v2` replay reads its constants from
[`../src/domain/adaptiveV2Spec.json`](../src/domain/adaptiveV2Spec.json). Python and TypeScript both verify the shared
adjusted-score and tie-aware tier cases in [`fixtures/adaptive_v2_tiers.json`](fixtures/adaptive_v2_tiers.json).

Tracked conclusions and the offline validation procedure live in
[`../docs/queue-algorithm-analysis.md`](../docs/queue-algorithm-analysis.md).
