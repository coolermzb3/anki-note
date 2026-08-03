# Audio as the source of truth for pitch analysis

Saved source audio is the durable fact, while the current pitch track is a rebuildable cache tagged with its detector, version, and parameters. Capture and decoding feed a replaceable stateful pitch detector, optional offline post-processing consumes the detector output, and both real-time and offline paths expose the same time, fundamental-frequency-or-unvoiced, and confidence frame contract to the UI. Reanalysis replaces the previous cache only after success; detector intermediates and past analysis versions are not persisted.
