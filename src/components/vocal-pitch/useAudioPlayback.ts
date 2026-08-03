import { useCallback, useEffect, useRef, useState } from "react";
import type { VocalAudioMaterial } from "../../domain/vocalPitch";

export function useAudioPlayback(material: VocalAudioMaterial | null) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
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
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if (material) {
      const url = URL.createObjectURL(material.audioBlob);
      audioUrlRef.current = url;
      audio.src = url;
      audio.load();
    } else {
      audioUrlRef.current = null;
      audio.removeAttribute("src");
      audio.load();
    }
  }, [material?.audioBlob, material?.id]);

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
    if (!audio || !material) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.currentTime >= material.durationSeconds - 0.02) {
      audio.currentTime = 0;
      setCurrentTime(0);
    }
    await audio.play();
  }, [material]);

  return { currentTime, isPlaying, pause, seek, toggle };
}
