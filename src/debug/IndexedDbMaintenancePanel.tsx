import { useEffect, useState } from "react";
import { deleteEmptySessions, listEmptySessions, type EmptySessionReport } from "./indexedDbMaintenance";

type DebugStatus = "idle" | "busy" | "ready" | "deleted" | "error";

function summarizeReport(report: EmptySessionReport): string {
  return `共 ${report.totalSessionCount} 个 session，候选空 session ${report.candidateCount} 个，关联 review ${report.candidateReviewCount} 个。`;
}

export function IndexedDbMaintenancePanel(): JSX.Element {
  const [status, setStatus] = useState<DebugStatus>("idle");
  const [message, setMessage] = useState("尚未扫描");
  const [report, setReport] = useState<EmptySessionReport | null>(null);
  const [output, setOutput] = useState("");

  const scan = async (): Promise<void> => {
    setStatus("busy");
    try {
      const nextReport = await listEmptySessions();
      setReport(nextReport);
      setOutput(JSON.stringify(nextReport, null, 2));
      setMessage(summarizeReport(nextReport));
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  };

  const remove = async (): Promise<void> => {
    setStatus("busy");
    try {
      const result = await deleteEmptySessions();
      const remainingReport = await listEmptySessions();
      setReport(remainingReport);
      setOutput(JSON.stringify({ result, remainingReport }, null, 2));
      setMessage(
        `已删除 ${result.deletedSessionCount} 个 session、${result.deletedReviewCount} 个 review；剩余候选 ${remainingReport.candidateCount} 个。`,
      );
      setStatus("deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  };

  useEffect(() => {
    void scan();
  }, []);

  return (
    <section className="debug-maintenance" data-testid="indexeddb-maintenance">
      <h1>IndexedDB 维护</h1>
      <div className="debug-maintenance-actions">
        <button disabled={status === "busy"} onClick={() => void scan()}>
          扫描空 session
        </button>
        <button
          className="primary"
          disabled={status === "busy" || !report || report.candidateCount === 0}
          onClick={() => void remove()}
        >
          删除候选
        </button>
      </div>
      <p data-testid="debug-status">{message}</p>
      <textarea data-testid="debug-report" readOnly value={output} />
    </section>
  );
}
