# 清唱音高算法对比

这个目录保存 2026-08-09 清唱音高实验、浏览器模型导出和锁定依赖。生产实现采用本轮收敛的 MPM-C 与三算法融合规则，但实验缓存、图表和报告仍只写入被 Git 忽略的 `analysis/output/`；原始音频继续作为事实来源。

## 运行

```powershell
uv sync --directory analysis\pitch
uv run --directory analysis\pitch python compare.py --refresh
```

不带 `--refresh` 会复用 `analysis/output/vocal-pitch-algorithms-2026-08-09/cache/` 中的逐算法结果，只重建指标、报告和图表。

每首音频生成一张八行分面图：前六行固定为 pYIN、MPM-C、PESTO、CREPE、FCPE、SwiftF0；第七行是共识锚定 FCPE；第八行是 MPM-C、SwiftF0、FCPE 三算法共识。每个算法子图标出有声覆盖、相邻八度跳变、短缺口和处理当前文件的实测耗时；图中只有一种背景标记，以淡绿色表示最接近三算法共识的 subplot。完整结果见运行后生成的 `analysis/output/vocal-pitch-algorithms-2026-08-09/report.md` 和 `metrics.csv`。

## 本轮结果

本轮共分析 16 个文件、517.16 秒音频，使用本机 CPU：

| 算法 | 有声覆盖 | 八度跳变 | 短缺口 | 总耗时 | RTF |
| --- | ---: | ---: | ---: | ---: | ---: |
| pYIN | 92.6% | 0 | 54 | 269.29 s | 0.521 |
| MPM-C | 83.0% | 18 | 164 | 29.56 s | 0.057 |
| PESTO | 77.8% | 112 | 134 | 9.23 s | 0.018 |
| CREPE | 81.5% | 0 | 110 | 309.17 s | 0.598 |
| FCPE | 88.9% | 33 | 43 | 3.29 s | 0.006 |
| SwiftF0 | 85.4% | 0 | 104 | 7.30 s | 0.014 |

第八行要求三个指定算法中至少两个判断有声，且至少两个音高落入同一半音簇，否则保留断线。第七行使用同一多数簇锚定 FCPE：FCPE 通过 0 或 ±1 个整八度能落入多数簇时保留其轮廓，否则使用簇内 SwiftF0。参与投票的算法会被共识接近度奖励，所以这些结果不是人工真值准确率。

共识锚定 FCPE 在本批覆盖 88.6%：FCPE 承载 99.9% 的有声帧，其中 1043 帧由 FCPE 单独补全，60 帧做了整八度修正，37 帧回退 SwiftF0。

这些指标没有逐帧人工真值，只适合比较连续性、缺口和候选算法之间的一致性，不能直接代表音高准确率。尤其是 `他不爱我 0423d5` 的 1.80–3.15 秒长音：人工判断为 F4，PESTO、CREPE、FCPE、SwiftF0 也取 F4，但 pYIN 和 MPM-C 都稳定取 F5。该段约 343 Hz 的基频比 686 Hz 二次谐波弱 21.5 dB，说明 pYIN 的平滑轨迹仍可能整段错一个八度。

pYIN 的 HMM 有声结果覆盖率高，但在本批数据中产生 1143 个音域下限粘连帧。用 `voiced_prob >= 0.05` 后置拒绝可把它降到 11 帧，同时覆盖率降到 84.7%、短缺口从 54 增到 113；阈值越高，断线越严重。本轮不把它投入生产重新分析，只保留为实验参照。

对同一批音频进一步回放 MPM-C 检测音域后，降低下限至 46.875 Hz 会让八度跳变从 19 增至 29；仅将上限提高至 1975.5 Hz 未增加八度跳变或短缺口，耗时变化不足 0.4%。生产 MPM-C 因此固定使用 65.406–1975.5 Hz，不提供检测音域调节。

参数与接口以 [librosa pYIN](https://librosa.org/doc/latest/generated/librosa.pyin.html)、[PESTO](https://github.com/SonyCSLParis/pesto)、[CREPE](https://github.com/marl/crepe)、[torchcrepe](https://github.com/maxrmorrison/torchcrepe)、[FCPE](https://github.com/CNChTu/FCPE) 和 [SwiftF0](https://github.com/lars76/swift-f0) 的官方文档为准。本实验没有把所有算法强行限制到统一音域，而是保留各自支持范围；pYIN 因 API 必须指定范围而使用 C2–C7。
