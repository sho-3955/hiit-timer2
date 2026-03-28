/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, Dispatch, SetStateAction } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Plus, Minus } from 'lucide-react';

type Phase = 'WORK' | 'REST' | 'COOLDOWN' | 'READY';

export default function App() {
  // Settings
  const [workTime, setWorkTime] = useState(20);
  const [restTime, setRestTime] = useState(10);
  const [sets, setSets] = useState(8);
  const [cycles, setCycles] = useState(1);

  // Timer State
  const [isActive, setIsActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(workTime);
  const [currentPhase, setCurrentPhase] = useState<Phase>('READY');
  const [currentSet, setCurrentSet] = useState(1);
  const [currentCycle, setCurrentCycle] = useState(1);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Format time MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Total time calculation
  const totalSeconds = (workTime + restTime) * sets * cycles - (restTime * cycles); // Last rest of each cycle is usually skipped or different, but let's keep it simple
  const displayTotal = formatTime(Math.max(0, totalSeconds));

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
    } else if (currentPhase === 'WORK') {
      if (currentSet < sets) {
        setCurrentPhase('REST');
        setTimeLeft(restTime);
        setCurrentSet(prev => prev + 1);
      } else {
        if (currentCycle < cycles) {
          setCurrentPhase('REST');
          setTimeLeft(restTime);
          setCurrentSet(1);
          setCurrentCycle(prev => prev + 1);
        } else {
          setIsActive(false);
          setCurrentPhase('COOLDOWN');
          setTimeLeft(0);
        }
      }
    }
  }, [currentPhase, currentSet, currentCycle, workTime, restTime, sets, cycles]);

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
    if (currentPhase === 'READY') setCurrentPhase('WORK');
    setIsActive(!isActive);
  };

  const adjustValue = (setter: Dispatch<SetStateAction<number>>, val: number, min: number = 1) => {
    setter(prev => Math.max(min, prev + val));
  };

  // Progress percentage for circular bar
  const maxTime = currentPhase === 'WORK' ? workTime : restTime;
  const progress = maxTime > 0 ? (timeLeft / maxTime) : 0;

  return (
    <div className="min-h-screen bg-[#121212] text-white font-sans flex flex-col items-center p-6 select-none">
      <header className="w-full max-w-md text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white/90">HIIT Timer</h1>
      </header>

      <main className="w-full max-w-md space-y-8">
        {/* Settings Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Work</label>
            <div className="flex items-center bg-[#1a1a1a] border border-[#39FF14]/30 rounded-lg overflow-hidden h-12">
              <button onClick={() => adjustValue(setWorkTime, -5, 5)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Minus size={16} className="text-[#39FF14]" />
              </button>
              <div className="flex-1 text-center font-mono text-lg">{formatTime(workTime)}</div>
              <button onClick={() => adjustValue(setWorkTime, 5)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Plus size={16} className="text-[#39FF14]" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Rest</label>
            <div className="flex items-center bg-[#1a1a1a] border border-[#39FF14]/30 rounded-lg overflow-hidden h-12">
              <button onClick={() => adjustValue(setRestTime, -5, 5)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Minus size={16} className="text-[#39FF14]" />
              </button>
              <div className="flex-1 text-center font-mono text-lg">{formatTime(restTime)}</div>
              <button onClick={() => adjustValue(setRestTime, 5)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Plus size={16} className="text-[#39FF14]" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Sets</label>
            <div className="flex items-center bg-[#1a1a1a] border border-[#39FF14]/30 rounded-lg overflow-hidden h-12">
              <button onClick={() => adjustValue(setSets, -1)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Minus size={16} className="text-[#39FF14]" />
              </button>
              <div className="flex-1 text-center font-mono text-lg">{sets}</div>
              <button onClick={() => adjustValue(setSets, 1)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Plus size={16} className="text-[#39FF14]" />
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Cycles</label>
            <div className="flex items-center bg-[#1a1a1a] border border-[#39FF14]/30 rounded-lg overflow-hidden h-12">
              <button onClick={() => adjustValue(setCycles, -1)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Minus size={16} className="text-[#39FF14]" />
              </button>
              <div className="flex-1 text-center font-mono text-lg">{cycles}</div>
              <button onClick={() => adjustValue(setCycles, 1)} className="px-3 h-full hover:bg-[#39FF14]/10 transition-colors">
                <Plus size={16} className="text-[#39FF14]" />
              </button>
            </div>
          </div>
        </div>

        <div className="text-center text-sm font-medium text-white/60">
          Total: {displayTotal}
        </div>

        {/* Circular Timer */}
        <div className="relative flex justify-center items-center py-8">
          <svg className="w-64 h-64 transform -rotate-90">
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
              style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}
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
            <div className="text-6xl font-bold font-mono tabular-nums">
              {formatTime(timeLeft)}
            </div>
          </div>
        </div>

        {/* Progress Info */}
        <div className="flex justify-center items-center space-x-4 text-xl font-bold uppercase tracking-wide">
          <div className="flex items-center">
            <span className="text-white/40 mr-2">SET:</span>
            <span className="text-[#39FF14]">{currentSet}</span>
            <span className="text-white/20 mx-1">/</span>
            <span className="text-white/60">{sets}</span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center">
            <span className="text-white/40 mr-2">CYCLE:</span>
            <span className="text-[#39FF14]">{currentCycle}</span>
            <span className="text-white/20 mx-1">/</span>
            <span className="text-white/60">{cycles}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex space-x-4 pt-4">
          <button
            onClick={toggleTimer}
            className={`flex-1 flex items-center justify-center space-x-2 h-16 rounded-2xl font-bold text-lg transition-all active:scale-95 ${
              isActive 
                ? 'bg-white/10 text-white hover:bg-white/20' 
                : 'bg-[#39FF14] text-black hover:bg-[#32e612] shadow-[0_0_20px_rgba(57,255,20,0.3)]'
            }`}
          >
            {isActive ? (
              <>
                <Pause fill="currentColor" size={24} />
                <span>PAUSE</span>
              </>
            ) : (
              <>
                <Play fill="currentColor" size={24} />
                <span>START</span>
              </>
            )}
          </button>
          
          <button
            onClick={resetTimer}
            className="w-16 h-16 flex items-center justify-center bg-[#1a1a1a] text-white/60 rounded-2xl hover:bg-[#252525] hover:text-white transition-all active:scale-95"
          >
            <RotateCcw size={24} />
          </button>
        </div>
      </main>

      <footer className="mt-auto pt-8 text-white/20 text-[10px] uppercase tracking-widest font-mono">
        Designed for Performance
      </footer>
    </div>
  );
}
