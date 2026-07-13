# Session progress comparison

The statistics page first derives the target-note set from its global range and staff controls, then initializes `答对进度` from the latest eligible finite practice session within that set. An eligible session contains at least five statistical reviews. The condition selection and time-benchmark group last only for the current statistics-page visit; the progress-calculation mode and history-N preference remain persisted presentation settings.

## Conditions and selection

The statistics page's global range and staff controls define the effective target-note set. Within that set, exact groups form a sparse valid-combination cube over prompt display mode, effective queue algorithm, and prompt note duration. Three selectors expose these coordinates. A single selection is one occupied cell; a multi-selection is an axis-aligned slice with several values on at most one coordinate and occupied cells for every requested value.

The latest user edit is authoritative. The resolver changes the fewest other coordinates needed to reach a valid point or slice, then breaks ties with the candidate whose time-benchmark group has the most recent eligible session. An impossible slice is rejected with an explanation. Clicking an option body replaces the current selection and closes the menu; its separate checkbox adds or removes that value for comparison without closing the menu. Menus also close after an outside click, Escape, or opening another selector. When a new multi-selection dimension replaces an existing one, a temporary inline notice explains that only one dimension may be multi-selected.

Effective algorithm versions retain distinct record scopes. When only one melody version has history it is labeled `旋律生成`; when old and current versions coexist, the selector distinguishes them. Multi-note drill history remains valid only when its effective target-note set equals the set produced by the current global controls. The statistics page does not reproduce the drill note-name editor.

## Curves and time benchmark

Each selected group contributes its latest N eligible curves plus the newest session tied for that group's all-history best, deduplicated by session. N limits ordinary recent curves only; record calculations use all qualifying history. Single-group charts use the app green, while a multi-group chart uses a stable four-color palette bound to values within the active comparison dimension. The best session uses a higher-opacity dashed line, the newest session remains emphasized, and ordinary older curves use the same group hue with lower opacity. When the newest session is also best, its single curve is both thick and dashed.

One selected group supplies the chart window. Its newest fixed-duration session uses the configured duration; its newest fixed-count session uses the accumulated statistical-review time. Every visible curve is truncated to that window regardless of source mode. A session with no completed-review segment inside the window remains omitted instead of being interpolated. Switching the time-benchmark group redraws the window without changing any group's record summary.

The chart uses the existing ECharts dependency with a custom accessible React legend rather than the built-in legend. The compact, translucent legend floats over the chart's upper-left area without shrinking the plot; each whole row is an accessible radio control for the time benchmark. Multi-group display uses overlaid curves; faceted charts remain deferred.

## Group records

Every exact group owns its recent, best, and new-record claim. The genuinely newest eligible session sets that group's record metric: fixed-duration uses completed reviews within its configured duration, while fixed-count uses active time to its configured count. Both finite modes may contribute when their data fully covers that metric; an incomplete session remains visible as a partial curve but has no numeric value for that metric.

The custom multi-group legend shows each group's metric, recent value, and best value without adding `新纪录` labels. Single-group progress and the practice-completion summary may show `新纪录` only when the newest session strictly improves all earlier metric-covering sessions; an equal best is not a new record. The time-benchmark control is available only in multi-group display.

The practice-completion summary remains single-group and centered on the session that just ended. It shares the ECharts renderer and also keeps the all-history best session visible beyond its ordinary history-N limit, but does not expose statistics-page condition selection or multi-group comparison.

The statistics-page `音域分布` card normally reuses the selected exact groups. It calculates note speed and errors from the eligible finite sessions represented by those groups and then applies the page's current date range. If the global target-note set has no corresponding eligible progress group, this single-note view falls back to all long-term reviews whose target note belongs to the global set and states that fallback in the card. `识别时长` and `练习量` retain their existing app-range semantics.
