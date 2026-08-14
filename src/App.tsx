/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Plus, Minus } from 'lucide-react';

type Phase = 'WORK' | 'REST' | 'COOLDOWN' | 'READY' | 'CYCLE_BREAK';

const STORAGE_KEY = 'hiit-timer-settings';

interface Settings {
  workTime: number;
  restTime: number;
  sets: number;
  cycles: number;
  cycleBreak: number;
}

const loadSettings = (): Settings => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        workTime: parsed.workTime ?? 20,
        restTime: parsed.restTime ?? 10,
        sets: parsed.sets ?? 8,
        cycles: parsed.cycles ?? 1,
        cycleBreak: parsed.cycleBreak ?? 120,
      };
    }
  } catch {}
  return { workTime: 20, restTime: 10, sets: 8, cycles: 1, cycleBreak: 120 };
};

const READY_COUNTDOWN = 5;

// 1秒の無音WAVをBlob URLとして生成する。
// iOSでは再生中の<audio>要素があるとaudio sessionがメディア再生扱いになり、
// サイレントスイッチON（マナーモード）でもWeb Audioのビープが鳴るようになる。
const createSilentWavUrl = () => {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1秒
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmtチャンクサイズ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // バイトレート
  view.setUint16(32, 2, true); // ブロックアライン
  view.setUint16(34, 16, true); // ビット深度
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  // データ部はゼロのまま = 無音
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

export default function App() {
  const initial = loadSettings();

  // Settings
  const [workTime, setWorkTime] = useState(initial.workTime);
  const [restTime, setRestTime] = useState(initial.restTime);
  const [sets, setSets] = useState(initial.sets);
  const [cycles, setCycles] = useState(initial.cycles);
  const [cycleBreak, setCycleBreak] = useState(initial.cycleBreak);

  // Timer State
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(READY_COUNTDOWN);
  const [currentPhase, setCurrentPhase] = useState<Phase>('READY');
  const [currentSet, setCurrentSet] = useState(1);
  const [currentCycle, setCurrentCycle] = useState(1);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const silentLoopWantedRef = useRef(false);
  const activeBeepNodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);
  // 音声セッションの世代。開始/解放のたびに進め、旧世代の非同期完了処理
  // （resume/suspend/ビープ予約）が現行セッションの状態を書き換えないようにする
  const audioGenRef = useRef(0);
  // AudioContextのresume/suspendを直列化するキュー
  const audioOpChainRef = useRef<Promise<void>>(Promise.resolve());

  // Save settings to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ workTime, restTime, sets, cycles, cycleBreak }));
  }, [workTime, restTime, sets, cycles, cycleBreak]);

  // Format time MM:SS（0.5秒の端数がある場合は MM:SS.5）
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const secsStr = Number.isInteger(secs)
      ? secs.toString().padStart(2, '0')
      : secs.toFixed(1).padStart(4, '0');
    return `${mins.toString().padStart(2, '0')}:${secsStr}`;
  };

  // Total time calculation
  const totalSeconds = (workTime + restTime) * sets * cycles - (restTime * cycles) + cycleBreak * (cycles - 1);

  // Calculate total remaining time (counts down during workout)
  const totalRemaining = (() => {
    const fullCycleTime = sets * workTime + (sets - 1) * restTime;
    if (currentPhase === 'READY') return totalSeconds;
    if (currentPhase === 'COOLDOWN') return 0;
    let remaining = timeLeft;
    if (currentPhase === 'WORK') {
      remaining += (sets - currentSet) * (restTime + workTime);
    } else if (currentPhase === 'REST') {
      remaining += workTime + (sets - currentSet) * (restTime + workTime);
    } else if (currentPhase === 'CYCLE_BREAK') {
      remaining += fullCycleTime;
    }
    remaining += (cycles - currentCycle) * (cycleBreak + fullCycleTime);
    return remaining;
  })();

  const isRunning = isActive || currentPhase !== 'READY';

  // AudioContextのresume/suspendを直列化する単一経路。キューの実行時に毎回
  // desired状態（silentLoopWantedRef）を再評価してそちらへ収束させるため、
  // 完了前の公開stateの読み違いや、旧い操作による新セッションの巻き戻しが起きない。
  // statechangeからの再帰的な再試行はせず、ティック・復帰イベント等の外部契機からのみ呼ぶ
  const reconcileAudioState = useCallback(() => {
    audioOpChainRef.current = audioOpChainRef.current.then(() => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const state = ctx.state as string;
      if (state === 'closed') return;
      if (silentLoopWantedRef.current) {
        if (state !== 'running') return ctx.resume().catch(() => {});
      } else {
        if (state !== 'suspended') return ctx.suspend().catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Audio notification
  const initAudio = () => {
    // iOS: audio sessionをメディア再生カテゴリへ（サイレントスイッチONでも音が鳴る）
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {}
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
  };

  // 無音ループの開始/停止。iOSではこれが再生中の間メディア再生扱いが維持され、
  // マナーモードでもビープが聞こえる（AudioSession API非対応環境向けの保険も兼ねる）
  const startSilentLoop = useCallback(() => {
    audioGenRef.current += 1;
    silentLoopWantedRef.current = true;
    if (!silentAudioRef.current) {
      const el = new Audio(createSilentWavUrl());
      el.loop = true;
      // 通知等の割り込みでOSに止められた場合、タイマー動作中なら再開を試みる
      el.onpause = () => {
        if (silentLoopWantedRef.current) {
          el.play().catch(() => {});
        }
      };
      silentAudioRef.current = el;
    }
    silentAudioRef.current.play().catch(() => {});
    reconcileAudioState();
  }, [reconcileAudioState]);

  // 音声セッションの解放。一時停止・リセット・完了後に playback セッションを
  // 保持し続けないよう、無音ループ停止 + AudioContext suspend + audio session 復元を行う
  const releaseAudio = useCallback(() => {
    audioGenRef.current += 1;
    silentLoopWantedRef.current = false;
    silentAudioRef.current?.pause();
    // 予約済み・再生途中のビープをonendedを待たずに即座に破棄する
    // （suspend後の再開時に古いビープが鳴る・ノードが残留するのを防ぐ）
    activeBeepNodesRef.current.forEach(({ osc, gain }) => {
      osc.onended = null;
      try {
        osc.stop();
      } catch {}
      osc.disconnect();
      gain.disconnect();
    });
    activeBeepNodesRef.current = [];
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'auto';
      } catch {}
    }
    // 直列化キュー経由でsuspendedへ収束させる
    reconcileAudioState();
  }, [reconcileAudioState]);

  // アンマウント時に音声リソースを完全解放する（audio sessionの復元含む）
  useEffect(() => {
    return () => {
      releaseAudio();
      const el = silentAudioRef.current;
      if (el) {
        el.onpause = null;
        URL.revokeObjectURL(el.src);
        silentAudioRef.current = null;
      }
      const ctx = audioCtxRef.current;
      if (ctx) {
        ctx.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [releaseAudio]);

  const playBeep = useCallback((frequency: number, duration: number, count: number = 1) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const schedule = () => {
      for (let i = 0; i < count; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = frequency;
        gain.gain.value = 0.3;
        const startTime = ctx.currentTime + i * (duration / 1000 + 0.1);
        osc.start(startTime);
        osc.stop(startTime + duration / 1000);
        // 解放時に予約済みビープを破棄できるよう組で追跡する
        const entry = { osc, gain };
        activeBeepNodesRef.current.push(entry);
        osc.onended = () => {
          activeBeepNodesRef.current = activeBeepNodesRef.current.filter(e => e !== entry);
          osc.disconnect();
          gain.disconnect();
        };
      }
    };
    if ((ctx.state as string) === 'running') {
      schedule();
    } else {
      // 直列化キューでresumeを確定させてからscheduleする。
      // 世代が進んでいたら旧セッションのビープとして破棄（遅延再生しない）
      const gen = audioGenRef.current;
      reconcileAudioState();
      audioOpChainRef.current = audioOpChainRef.current.then(() => {
        if (audioGenRef.current !== gen) return;
        if (silentLoopWantedRef.current && (ctx.state as string) === 'running') {
          schedule();
        }
      }).catch(() => {});
    }
  }, [reconcileAudioState]);

  const vibrate = useCallback((pattern: number | number[]) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }, []);

  const notify = useCallback((phase: Phase) => {
    if (phase === 'WORK') {
      playBeep(880, 200);
      vibrate(200);
    } else if (phase === 'REST') {
      playBeep(440, 200);
      vibrate([100, 50, 100]);
    } else if (phase === 'CYCLE_BREAK') {
      playBeep(550, 200, 2);
      vibrate([200, 100, 200]);
    } else if (phase === 'COOLDOWN') {
      playBeep(660, 300, 3);
      vibrate([300, 100, 300, 100, 300]);
    }
  }, [playBeep, vibrate]);

  const resetTimer = useCallback(() => {
    setIsActive(false);
    setCurrentPhase('READY');
    setTimeLeft(READY_COUNTDOWN);
    setCurrentSet(1);
    setCurrentCycle(1);
    releaseAudio();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, [releaseAudio]);

  const nextPhase = useCallback(() => {
    if (currentPhase === 'READY' || currentPhase === 'REST' || currentPhase === 'CYCLE_BREAK') {
      setCurrentPhase('WORK');
      setTimeLeft(workTime);
      notify('WORK');
    } else if (currentPhase === 'WORK') {
      if (currentSet < sets) {
        setCurrentPhase('REST');
        setTimeLeft(restTime);
        setCurrentSet(prev => prev + 1);
        notify('REST');
      } else {
        if (currentCycle < cycles) {
          setCurrentSet(1);
          setCurrentCycle(prev => prev + 1);
          if (cycleBreak > 0) {
            setCurrentPhase('CYCLE_BREAK');
            setTimeLeft(cycleBreak);
            notify('CYCLE_BREAK');
          } else {
            setCurrentPhase('WORK');
            setTimeLeft(workTime);
            notify('WORK');
          }
        } else {
          setIsActive(false);
          setCurrentPhase('COOLDOWN');
          setTimeLeft(0);
          notify('COOLDOWN');
        }
      }
    }
  }, [currentPhase, currentSet, currentCycle, workTime, restTime, sets, cycles, cycleBreak, notify]);

  useEffect(() => {
    if (isActive && timeLeft > 0) {
      // 割り込み（通知・Siri等）後の自動復帰ハートビート: 毎ティック音声の復帰を試みる
      reconcileAudioState();
      if (silentLoopWantedRef.current && silentAudioRef.current?.paused) {
        silentAudioRef.current.play().catch(() => {});
      }
      // カウントダウン 3, 2, 1 でビープ音（0.5秒の端数では鳴らさない）
      if (timeLeft <= 3 && Number.isInteger(timeLeft) && currentPhase !== 'COOLDOWN') {
        playBeep(600, 100);
      }
      // WORK中はフェーズ残り時間が10の倍数、REST/CYCLE_BREAK中は残り20秒・10秒のみビープ音（フェーズ開始時はスキップ）
      const isPhaseStart = (currentPhase === 'WORK' && timeLeft === workTime)
        || (currentPhase === 'REST' && timeLeft === restTime)
        || (currentPhase === 'CYCLE_BREAK' && timeLeft === cycleBreak);
      const shouldIntervalBeep = currentPhase === 'WORK'
        ? timeLeft % 10 === 0
        : (currentPhase === 'REST' || currentPhase === 'CYCLE_BREAK') && (timeLeft === 20 || timeLeft === 10);
      if (shouldIntervalBeep && !isPhaseStart) {
        playBeep(500, 150);
      }
      // 0.5秒の端数がある間は500msティック、それ以外は1秒ティック
      const hasHalfStep = !Number.isInteger(timeLeft);
      timerRef.current = setTimeout(() => {
        setTimeLeft(prev => prev - (hasHalfStep ? 0.5 : 1));
      }, hasHalfStep ? 500 : 1000);
    } else if (isActive && timeLeft === 0) {
      nextPhase();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isActive, timeLeft, nextPhase, currentPhase, playBeep, workTime, restTime, cycleBreak, reconcileAudioState]);

  // アプリ復帰時に音声を再開（通知・アプリ切替・画面ロック後の復帰対策。タイマー動作中のみ）
  useEffect(() => {
    const resumeAudio = () => {
      if (document.hidden) return;
      if (!silentLoopWantedRef.current) return;
      reconcileAudioState();
      silentAudioRef.current?.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', resumeAudio);
    window.addEventListener('focus', resumeAudio);
    window.addEventListener('pageshow', resumeAudio);
    return () => {
      document.removeEventListener('visibilitychange', resumeAudio);
      window.removeEventListener('focus', resumeAudio);
      window.removeEventListener('pageshow', resumeAudio);
    };
  }, [reconcileAudioState]);

  // 完了後は完了ビープを鳴らし切ってから音声セッションを解放する
  useEffect(() => {
    if (currentPhase !== 'COOLDOWN') return;
    const t = setTimeout(releaseAudio, 3000);
    return () => clearTimeout(t);
  }, [currentPhase, releaseAudio]);

  const toggleTimer = () => {
    // 完了後のSTARTは新しいワークアウトとして最初からやり直す
    if (currentPhase === 'COOLDOWN') {
      initAudio();
      startSilentLoop();
      setCurrentPhase('READY');
      setCurrentSet(1);
      setCurrentCycle(1);
      setTimeLeft(READY_COUNTDOWN);
      setIsActive(true);
      return;
    }
    if (currentPhase === 'READY' && !isActive) {
      initAudio();
      startSilentLoop();
      setTimeLeft(READY_COUNTDOWN);
      setIsActive(true);
      return;
    }
    // 一時停止時は音声セッションを解放して他アプリの音声を妨げない。再開時に再取得する
    if (isActive) {
      releaseAudio();
    } else {
      initAudio();
      startSilentLoop();
    }
    setIsActive(!isActive);
  };

  const adjustValue = (setter: Dispatch<SetStateAction<number>>, val: number, min: number = 1) => {
    setter(prev => Math.max(min, prev + val));
  };

  // Progress percentage for circular bar
  const maxTime = currentPhase === 'WORK' ? workTime
    : currentPhase === 'REST' ? restTime
    : currentPhase === 'CYCLE_BREAK' ? cycleBreak
    : (currentPhase === 'READY' && isActive) ? READY_COUNTDOWN
    : 0;
  const progress = maxTime > 0 ? (timeLeft / maxTime) : 1;

  return (
    <div className="h-dvh bg-[#121212] text-white font-sans flex flex-col items-center px-5 pb-6 select-none overflow-hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
      <header className="w-full max-w-md text-center mb-5">
        <h1 className="text-xl font-bold tracking-tight text-white/80">HIIT Timer</h1>
      </header>

      <main className="flex-1 w-full max-w-md flex flex-col min-h-0">
        {/* Settings Panel */}
        <div className={`bg-white/[0.02] rounded-2xl p-3.5 pb-3 transition-opacity ${isRunning ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-6 gap-x-3 gap-y-3.5">
            <div className="col-span-3 space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Work</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setWorkTime, -1, 1)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{formatTime(workTime)}</div>
                <button onClick={() => adjustValue(setWorkTime, 1)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>

            <div className="col-span-3 space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Rest</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setRestTime, -0.5, 0.5)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{formatTime(restTime)}</div>
                <button onClick={() => adjustValue(setRestTime, 0.5)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Sets</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setSets, -1)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{sets}</div>
                <button onClick={() => adjustValue(setSets, 1)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Cycles</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setCycles, -1)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{cycles}</div>
                <button onClick={() => adjustValue(setCycles, 1)} className="px-3 h-full hover:bg-white/10 transition-colors cursor-pointer">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>

            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">C.Break</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setCycleBreak, -1, 0)} className="px-1.5 h-full hover:bg-white/10 transition-colors flex-shrink-0 cursor-pointer">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-sm">{formatTime(cycleBreak)}</div>
                <button onClick={() => adjustValue(setCycleBreak, 1)} className="px-1.5 h-full hover:bg-white/10 transition-colors flex-shrink-0 cursor-pointer">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* Circular Timer */}
        <div className="flex-1 flex flex-col justify-center items-center min-h-0 my-4">
          {/* Total Time */}
          <div className="text-center text-base font-bold text-white/90 tracking-wider mb-2">
            Total: {formatTime(totalRemaining)}
          </div>
          <div className="relative w-full aspect-square max-w-xs">
            <svg viewBox="0 0 256 256" overflow="visible" className="w-full h-full transform -rotate-90">
              <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle
                cx="128"
                cy="128"
                r="120"
                stroke="currentColor"
                strokeWidth="8"
                fill="transparent"
                className="text-white/5"
              />
              <motion.circle
                key={`${currentPhase}-${currentSet}-${currentCycle}`}
                cx="128"
                cy="128"
                r="120"
                stroke="currentColor"
                strokeWidth="8"
                fill="transparent"
                strokeDasharray={2 * Math.PI * 120}
                initial={{ strokeDashoffset: 0 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 120 * (1 - progress) }}
                transition={{ duration: 0.5, ease: "linear" }}
                className={currentPhase === 'WORK' ? 'text-[#39FF14]' : currentPhase === 'CYCLE_BREAK' ? 'text-amber-400' : currentPhase === 'READY' ? 'text-white/60' : 'text-blue-400'}
                filter="url(#glow)"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentPhase}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="text-xs font-bold uppercase tracking-[0.2em] text-white/40 mb-1"
                >
                  {currentPhase}
                </motion.div>
              </AnimatePresence>
              <div className="text-5xl font-bold font-mono tabular-nums">
                {formatTime(timeLeft)}
              </div>
              {currentPhase === 'COOLDOWN' && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-lg font-bold text-[#39FF14] mt-2"
                >
                  COMPLETE!
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* Progress Info */}
        <div className="flex justify-center items-center space-x-4 text-[15px] font-bold uppercase tracking-wide mb-5">
          <div className="flex items-center">
            <span className="text-white/40 mr-2">{currentPhase === 'REST' ? 'NEXT SET:' : 'SET:'}</span>
            <span className="text-[#39FF14]">{currentSet}</span>
            <span className="text-white/20 mx-1">/</span>
            <span className="text-white/60">{sets}</span>
          </div>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center">
            <span className="text-white/40 mr-2">{currentPhase === 'CYCLE_BREAK' ? 'NEXT CYCLE:' : 'CYCLE:'}</span>
            <span className="text-[#39FF14]">{currentCycle}</span>
            <span className="text-white/20 mx-1">/</span>
            <span className="text-white/60">{cycles}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex space-x-3 mt-auto">
          <button
            onClick={toggleTimer}
            className={`flex-1 flex items-center justify-center space-x-2 h-14 rounded-xl font-bold text-base transition-all active:scale-95 cursor-pointer ${
              isActive
                ? 'bg-white/10 text-white hover:bg-white/20'
                : 'bg-[#39FF14] text-black hover:bg-[#32e612] shadow-[0_0_20px_rgba(57,255,20,0.3)]'
            }`}
          >
            {isActive ? (
              <>
                <Pause fill="currentColor" size={20} />
                <span>PAUSE</span>
              </>
            ) : (
              <>
                <Play fill="currentColor" size={20} />
                <span>START</span>
              </>
            )}
          </button>

          <button
            onClick={resetTimer}
            className="w-14 h-14 flex items-center justify-center bg-white/[0.04] text-white/60 rounded-xl hover:bg-white/10 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </main>
    </div>
  );
}
