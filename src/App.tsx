/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Plus, Minus } from 'lucide-react';

type Phase = 'WORK' | 'REST' | 'COOLDOWN' | 'READY';

const STORAGE_KEY = 'hiit-timer-settings';

interface Settings {
  workTime: number;
  restTime: number;
  sets: number;
  cycles: number;
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
      };
    }
  } catch {}
  return { workTime: 20, restTime: 10, sets: 8, cycles: 1 };
};

export default function App() {
  const initial = loadSettings();

  // Settings
  const [workTime, setWorkTime] = useState(initial.workTime);
  const [restTime, setRestTime] = useState(initial.restTime);
  const [sets, setSets] = useState(initial.sets);
  const [cycles, setCycles] = useState(initial.cycles);

  // Timer State
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(initial.workTime);
  const [currentPhase, setCurrentPhase] = useState<Phase>('READY');
  const [currentSet, setCurrentSet] = useState(1);
  const [currentCycle, setCurrentCycle] = useState(1);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Save settings to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ workTime, restTime, sets, cycles }));
  }, [workTime, restTime, sets, cycles]);

  // Format time MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Total time calculation
  const totalSeconds = (workTime + restTime) * sets * cycles - (restTime * cycles);
  const displayTotal = formatTime(Math.max(0, totalSeconds));

  const isRunning = isActive || currentPhase !== 'READY';

  // Audio notification
  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
  };

  const playBeep = useCallback((frequency: number, duration: number, count: number = 1) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
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
    }
  }, []);

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
    } else if (phase === 'COOLDOWN') {
      playBeep(660, 300, 3);
      vibrate([300, 100, 300, 100, 300]);
    }
  }, [playBeep, vibrate]);

  const resetTimer = useCallback(() => {
    setIsActive(false);
    setCurrentPhase('READY');
    setTimeLeft(workTime);
    setCurrentSet(1);
    setCurrentCycle(1);
    if (timerRef.current) clearInterval(timerRef.current);
  }, [workTime]);

  const nextPhase = useCallback(() => {
    if (currentPhase === 'READY' || currentPhase === 'REST') {
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
          setCurrentPhase('REST');
          setTimeLeft(restTime);
          setCurrentSet(1);
          setCurrentCycle(prev => prev + 1);
          notify('REST');
        } else {
          setIsActive(false);
          setCurrentPhase('COOLDOWN');
          setTimeLeft(0);
          notify('COOLDOWN');
        }
      }
    }
  }, [currentPhase, currentSet, currentCycle, workTime, restTime, sets, cycles, notify]);

  useEffect(() => {
    if (isActive && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (isActive && timeLeft === 0) {
      nextPhase();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, timeLeft, nextPhase]);

  const toggleTimer = () => {
    initAudio();
    if (currentPhase === 'READY') {
      setCurrentPhase('WORK');
      notify('WORK');
    }
    setIsActive(!isActive);
  };

  const adjustValue = (setter: Dispatch<SetStateAction<number>>, val: number, min: number = 1) => {
    setter(prev => Math.max(min, prev + val));
  };

  // Progress percentage for circular bar
  const maxTime = currentPhase === 'WORK' ? workTime : restTime;
  const progress = maxTime > 0 ? (timeLeft / maxTime) : 0;

  return (
    <div className="h-dvh bg-[#121212] text-white font-sans flex flex-col items-center px-5 pt-4 pb-6 select-none overflow-hidden">
      <header className="w-full max-w-md text-center mb-5">
        <h1 className="text-xl font-bold tracking-tight text-white/80">HIIT Timer</h1>
      </header>

      <main className="flex-1 w-full max-w-md flex flex-col min-h-0">
        {/* Settings Panel */}
        <div className={`bg-white/[0.02] rounded-2xl p-3.5 pb-3 transition-opacity ${isRunning ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Work</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setWorkTime, -5, 5)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{formatTime(workTime)}</div>
                <button onClick={() => adjustValue(setWorkTime, 5)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Rest</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setRestTime, -5, 5)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{formatTime(restTime)}</div>
                <button onClick={() => adjustValue(setRestTime, 5)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Sets</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setSets, -1)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{sets}</div>
                <button onClick={() => adjustValue(setSets, 1)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/40 uppercase tracking-widest">Cycles</label>
              <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-11">
                <button onClick={() => adjustValue(setCycles, -1)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Minus size={14} className="text-white/50" />
                </button>
                <div className="flex-1 text-center font-mono text-base">{cycles}</div>
                <button onClick={() => adjustValue(setCycles, 1)} className="px-3 h-full hover:bg-white/10 transition-colors">
                  <Plus size={14} className="text-white/50" />
                </button>
              </div>
            </div>
          </div>

          <div className="text-center text-xs font-medium text-white/50 mt-2.5">
            Total: {displayTotal}
          </div>
        </div>

        {/* Circular Timer */}
        <div className="flex-1 flex justify-center items-center min-h-0 my-4">
          <div className="relative w-full aspect-square max-w-xs">
            <svg viewBox="0 0 256 256" className="w-full h-full transform -rotate-90">
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
                className={currentPhase === 'WORK' ? 'text-[#39FF14]' : 'text-blue-400'}
                style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
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
            <span className="text-white/40 mr-2">SET:</span>
            <span className="text-[#39FF14]">{currentSet}</span>
            <span className="text-white/20 mx-1">/</span>
            <span className="text-white/60">{sets}</span>
          </div>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center">
            <span className="text-white/40 mr-2">CYCLE:</span>
            <span className="text-[#39FF14]">{currentCycle}</span>
            <span className="text-white/20 mx-1">/</span>
            <span className="text-white/60">{cycles}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex space-x-3 mt-auto">
          <button
            onClick={toggleTimer}
            className={`flex-1 flex items-center justify-center space-x-2 h-14 rounded-xl font-bold text-base transition-all active:scale-95 ${
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
            className="w-14 h-14 flex items-center justify-center bg-white/[0.04] text-white/60 rounded-xl hover:bg-white/10 hover:text-white transition-all active:scale-95"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </main>
    </div>
  );
}
