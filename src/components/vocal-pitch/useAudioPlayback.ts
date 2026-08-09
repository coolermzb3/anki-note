import { useCallback, useEffect, useRef, useState } from "react";
import type { VocalAudioMaterial } from "../../domain/vocalPitch";
import { decodeAudioBlob } from "../../vocal-pitch/pitchAnalysis";
import { peakNormalizationGain, playbackGainIsPreparing } from "../../vocal-pitch/playbackGain";

export function useAudioPlayback(material: VocalAudioMaterial | null, volume: number) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const normalizationGainRef = useRef(1);
  const volumeRef = useRef(volume);
  const animationRef = useRef<number | null>(null);
  const [gainPreparedForBlob, setGainPreparedForBlob] = useState<Blob | null>(null);
  volumeRef.current = volume;
  const isPreparing = playbackGainIsPreparing(material?.audioBlob ?? null, gainPreparedForBlob);

  const applyGain = useCallback(() => {
    const gainNode = gainNodeRef.current;
    if (gainNode) {
      gainNode.gain.value = normalizationGainRef.current * volumeRef.current;
    }
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const gainNode = context.createGain();
    source.connect(gainNode);
    gainNode.connect(context.destination);
    audioContextRef.current = context;
    gainNodeRef.current = gainNode;
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };
    const onPause = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    return () => {
      audio.pause();
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audioRef.current = null;
      gainNodeRef.current = null;
      audioContextRef.current = null;
      void context.close().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    applyGain();
  }, [applyGain, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    normalizationGainRef.current = 1;
    applyGain();
    if (!material) {
      setGainPreparedForBlob(null);
      audioUrlRef.current = null;
      audio.removeAttribute("src");
      audio.load();
      return undefined;
    }
    const url = URL.createObjectURL(material.audioBlob);
    audioUrlRef.current = url;
    audio.src = url;
    audio.load();
    let cancelled = false;
    void decodeAudioBlob(material.audioBlob)
      .then((decoded) => {
        if (cancelled) return;
        normalizationGainRef.current = peakNormalizationGain(decoded.samples);
        applyGain();
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setGainPreparedForBlob(material.audioBlob);
      });
    return () => {
      cancelled = true;
    };
  }, [applyGain, material?.audioBlob, material?.id]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      return undefined;
    }
    const update = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      animationRef.current = requestAnimationFrame(update);
    };
    animationRef.current = requestAnimationFrame(update);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [isPlaying]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const seek = useCallback((timeSeconds: number) => {
    const clamped = Math.max(0, Math.min(material?.durationSeconds ?? 0, timeSeconds));
    if (audioRef.current) audioRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  }, [material?.durationSeconds]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !material || isPreparing) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    await audioContextRef.current?.resume();
    if (audio.currentTime >= material.durationSeconds - 0.02) {
      audio.currentTime = 0;
      setCurrentTime(0);
    }
    await audio.play();
  }, [isPreparing, material]);

  return { currentTime, isPlaying, isPreparing, pause, seek, toggle };
}
