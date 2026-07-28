import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HistoryLimitControl, resolveHistoryLimit } from "./HistoryLimitControl";

describe("history limit control", () => {
  it("shows the all-history count and disables editing while selected", () => {
    const markup = renderToStaticMarkup(
      <HistoryLimitControl
        allHistory
        allHistoryCount={37}
        ariaLabel="测试历史次数"
        historyLimit={12}
        onAllHistoryChange={() => undefined}
        onHistoryLimitChange={() => undefined}
      />,
    );

    expect(markup).toContain('type="number"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('value="37"');
    expect(markup).toContain('aria-label="测试历史次数全部"');
    expect(markup).toContain('type="checkbox" checked=""');
  });

  it("uses the saved number again when all history is not selected", () => {
    const markup = renderToStaticMarkup(
      <HistoryLimitControl
        allHistory={false}
        allHistoryCount={37}
        ariaLabel="测试历史次数"
        historyLimit={12}
        onAllHistoryChange={() => undefined}
        onHistoryLimitChange={() => undefined}
      />,
    );

    expect(markup).toContain('value="12"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain('type="checkbox" checked=""');
  });

  it("resolves all history without overwriting the saved numeric limit", () => {
    expect(resolveHistoryLimit(12, true, 37)).toBe(37);
    expect(resolveHistoryLimit(12, false, 37)).toBe(12);
  });
});
