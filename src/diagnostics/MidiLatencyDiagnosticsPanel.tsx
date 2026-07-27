import { useEffect, useMemo, useState } from "react";
import {
  clearMidiLatencySamples,
  formatMidiLatencyCondition,
  formatMidiLatencyReport,
  getMidiLatencySamples,
  MIDI_LATENCY_DIAGNOSTICS_ENABLED,
  subscribeMidiLatencySamples,
  summarizeMidiLatencySamples,
  type MidiLatencyMetric,
  type MidiLatencyMetricSummary,
  type MidiLatencyCondition,
} from "./midiLatencyDiagnostics";

interface MidiLatencyDiagnosticsPanelProps {
  correctDelayMs: number;
}

function formatMetric(summary: MidiLatencyMetricSummary | undefined): string {
  return summary ? `${summary.median.toFixed(1)} / ${summary.max.toFixed(1)}` : "—";
}

function conditionLabel(
  condition: MidiLatencyCondition,
  outcome: "correct" | "wrong",
): string {
  const result = outcome === "correct" ? "正确" : "答错";
  return `${formatMidiLatencyCondition(condition, " · ")} · ${result}`;
}

export function MidiLatencyDiagnosticsPanel({ correctDelayMs }: MidiLatencyDiagnosticsPanelProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState(getMidiLatencySamples);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => subscribeMidiLatencySamples(() => setSamples(getMidiLatencySamples())), []);

  const groups = useMemo(() => summarizeMidiLatencySamples(samples), [samples]);
  const report = useMemo(() => formatMidiLatencyReport(samples), [samples]);

  if (!MIDI_LATENCY_DIAGNOSTICS_ENABLED) {
    return null;
  }

  const copyReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败，请长按下方文本选择复制");
    }
  };

  const downloadReport = (): void => {
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `midi-latency-${new Date().toISOString().replaceAll(":", "-")}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <>
      <button className="midi-latency-trigger" type="button" onClick={() => setOpen(true)}>
        延迟日志 · {samples.length}
      </button>
      {open ? (
        <section aria-label="MIDI 延迟诊断" aria-modal="false" className="midi-latency-panel" role="dialog">
          <header>
            <div>
              <strong>MIDI 延迟诊断</strong>
              <span>正确/答错分别分组；每组首个样本作为预热，不计入汇总</span>
            </div>
            <button type="button" onClick={() => setOpen(false)}>关闭</button>
          </header>

          {correctDelayMs < 300 ? (
            <p className="midi-latency-warning">
              当前正确后延迟为 {correctDelayMs}ms。仍可测判定，但绿色过渡可能被下一题提前清除；建议测试时统一设为 300ms。
            </p>
          ) : null}

          <div className="midi-latency-help">
            <span>中位数 / 最大值，单位 ms</span>
            <span>“原生→画面”不包含物理琴键行程和键盘内部扫描。</span>
            <span>“音频”是播放调用完成时间，不代表扬声器实际出声时刻。</span>
          </div>

          {groups.length > 0 ? (
            <div className="midi-latency-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>测试条件</th>
                    <th>样本</th>
                    <th>原生→回调</th>
                    <th>原生→按下UI</th>
                    <th>判定→画面</th>
                    <th>谱页着色</th>
                    <th>谱页重绘</th>
                    <th>音频</th>
                    <th>原生→画面</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const metric = (name: MidiLatencyMetric): string => formatMetric(group.metrics[name]);
                    return (
                      <tr key={group.key}>
                        <th>{conditionLabel(group.condition, group.outcome)}</th>
                        <td>{group.measuredCount}＋1预热</td>
                        <td>{metric("nativeToHandler")}</td>
                        <td>{metric("nativeToPressedPaint")}</td>
                        <td>{metric("verdictToPaint")}</td>
                        <td>{metric("staffColorUpdate")}</td>
                        <td>{metric("staffRender")}</td>
                        <td>{metric("audioReady")}</td>
                        <td>{metric("totalSoftware")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="midi-latency-empty">开始练习并使用 MIDI 答题后，这里会按“谱页/单音”“声音开/关”和“正确/答错”自动分组。</p>
          )}

          <div className="midi-latency-actions">
            <button type="button" onClick={() => void copyReport()}>复制日志</button>
            <button type="button" onClick={downloadReport}>下载 TXT</button>
            <button
              type="button"
              onClick={() => {
                clearMidiLatencySamples();
                setCopyStatus("");
              }}
            >
              清空
            </button>
            {copyStatus ? <span role="status">{copyStatus}</span> : null}
          </div>

          <details>
            <summary>最近样本与完整文本</summary>
            <pre>{report}</pre>
          </details>
        </section>
      ) : null}
    </>
  );
}
