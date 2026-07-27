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
  enabled = true,
  reviews,
  session,
}: {
  enabled?: boolean;
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
    enabled,
    historyLimit: 10,
    mode: "actual-order",
    reviews,
    sessions: [session],
  });
  return <span>{model.selection ? "沿用答对进度的会话条件" : "暂无对应有效会话"}</span>;
}

function makeEligibleSessionData(id: string): { reviews: ReviewRecord[]; session: PracticeSessionRecordV1 } {
  const session: PracticeSessionRecordV1 = {
    completedCount: 5,
    drillNoteNames: [],
    enabledGroupIds: ["G3-F4"],
    fixedCount: 5,
    id,
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
    id: `${id}-review-${index}`,
    sessionId: session.id,
    targetNoteId: targetNoteId as "C4" | "D4" | "E4" | "F4" | "G4",
  }));
  return { reviews, session };
}

it("renders the statistics shell before heavy content", () => {
  const markup = renderToStaticMarkup(
    <StatsView
      onSettingsSaved={() => undefined}
      reviews={[]}
      sessions={[]}
      settings={makeDefaultSettings()}
    />,
  );

  expect(markup).toContain("<h1>统计</h1>");
  expect(markup).toContain("aria-label=\"正在生成统计内容\"");
  expect(markup).not.toContain("stats-card-carousel-slide");
  expect(markup).not.toContain("stats-range-staff");
});

it("uses the latest eligible session conditions in the first render", () => {
  const { reviews, session } = makeEligibleSessionData("eligible-session");

  const markup = renderToStaticMarkup(<SessionProgressSelectionProbe reviews={reviews} session={session} />);

  expect(markup).toContain("沿用答对进度的会话条件");
  expect(markup).not.toContain("暂无对应有效会话");
});

it("defers session comparison work while statistics content is not ready", () => {
  const { reviews, session } = makeEligibleSessionData("deferred-session");

  const markup = renderToStaticMarkup(
    <SessionProgressSelectionProbe enabled={false} reviews={reviews} session={session} />,
  );

  expect(markup).toContain("暂无对应有效会话");
  expect(markup).not.toContain("沿用答对进度的会话条件");
});
