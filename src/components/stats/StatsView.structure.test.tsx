import "fake-indexeddb/auto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { makeDefaultSettings } from "../../data/db";
import { getNotesForGroups } from "../../domain/notes";
import { makeReview } from "../../domain/testFactories";
import type { PracticeSessionRecordV1, ReviewRecord } from "../../domain/types";
import { StatsView } from "./StatsView";
import { useSessionProgressComparison } from "./useSessionProgressComparison";

function SessionProgressSelectionProbe({
  reviews,
  session,
}: {
  reviews: ReviewRecord[];
  session: PracticeSessionRecordV1;
}): JSX.Element {
  const settings = makeDefaultSettings();
  const activeNotes = getNotesForGroups(
    settings.enabledGroupIds,
    settings.includeInterStaffLedgerSpellings,
    settings.staffNotationMode,
  );
  const model = useSessionProgressComparison({
    activeNotes,
    historyLimit: 10,
    mode: "actual-order",
    reviews,
    sessions: [session],
  });
  return <span>{model.selection ? "沿用答对进度的会话条件" : "暂无对应有效会话"}</span>;
}

it("renders one instance of each heavy statistics card", () => {
  const markup = renderToStaticMarkup(
    <StatsView
      onSettingsSaved={() => undefined}
      reviews={[]}
      sessions={[]}
      settings={makeDefaultSettings()}
    />,
  );

  expect(markup.match(/class="stats-card-carousel-slide"/g)).toHaveLength(3);
  expect(markup.match(/<h2>识别趋势<\/h2>/g)).toHaveLength(1);
  expect(markup.match(/<h2>答对进度<\/h2>/g)).toHaveLength(1);
  expect(markup.match(/<h2>音域分布<\/h2>/g)).toHaveLength(1);
  expect(markup.match(/class="stats-range-staff"/g)).toHaveLength(2);
});

it("uses the latest eligible session conditions in the first render", () => {
  const session: PracticeSessionRecordV1 = {
    completedCount: 5,
    drillNoteNames: [],
    enabledGroupIds: ["G3-F4"],
    fixedCount: 5,
    id: "eligible-session",
    includeLedgerVariants: false,
    interruptedCount: 0,
    mode: "fixed-count",
    promptDisplayMode: "staff-page",
    queueStrategy: "adaptive",
    schemaVersion: 1,
    startedAt: "2026-07-04T10:00:00.000+08:00",
  };
  const reviews = ["C4", "D4", "E4", "F4", "G4"].map((targetNoteId, index) => makeReview({
    answeredAt: `2026-07-04T10:00:0${index + 1}.000+08:00`,
    endedAt: `2026-07-04T10:00:0${index + 1}.000+08:00`,
    id: `eligible-review-${index}`,
    sessionId: session.id,
    targetNoteId: targetNoteId as "C4" | "D4" | "E4" | "F4" | "G4",
  }));

  const markup = renderToStaticMarkup(<SessionProgressSelectionProbe reviews={reviews} session={session} />);

  expect(markup).toContain("沿用答对进度的会话条件");
  expect(markup).not.toContain("暂无对应有效会话");
});
