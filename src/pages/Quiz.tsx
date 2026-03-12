import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Trophy, Zap, SkipForward } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../supabase';

// ─── Config ───────────────────────────────────────────────────────────
const QUESTION_TIMER_SECONDS = 8;

// ─── Types ────────────────────────────────────────────────────────────
interface RawQuestion {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}

interface QuizOption {
  displayLetter: 'A' | 'B' | 'C' | 'D';  // What the user sees
  originalLetter: 'A' | 'B' | 'C' | 'D'; // Original DB letter (used for scoring)
  text: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: QuizOption[]; // Shuffled
}

// ─── Helpers ──────────────────────────────────────────────────────────
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildShuffledQuestions(raw: RawQuestion[]): QuizQuestion[] {
  const shuffledRaw = shuffleArray(raw);
  return shuffledRaw.map((q) => {
    const origOptions: Omit<QuizOption, 'displayLetter'>[] = [
      { originalLetter: 'A', text: q.option_a },
      { originalLetter: 'B', text: q.option_b },
      { originalLetter: 'C', text: q.option_c },
      { originalLetter: 'D', text: q.option_d },
    ];
    const shuffledOpts = shuffleArray(origOptions);
    const labels: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    return {
      id: q.id,
      question: q.question,
      options: shuffledOpts.map((opt, i) => ({
        displayLetter: labels[i],
        originalLetter: opt.originalLetter,
        text: opt.text,
      })),
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────
export default function Quiz() {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedThisQ, setSelectedThisQ] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIMER_SECONDS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number; totalTime: number } | null>(null);

  const navigate = useNavigate();
  const participantId = localStorage.getItem('participantId');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);
  const currentIdxRef = useRef(0);
  const questionsRef = useRef<QuizQuestion[]>([]);
  const questionStartTimeRef = useRef<number>(Date.now());

  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  // ── Submit Quiz ──────────────────────────────────────────────────────
  // Strategy:
  //  1. Always compute score client-side (guarantees correct display).
  //  2. Try calculate_score() RPC (preferred — updates DB atomically).
  //  3. If RPC fails (e.g. RLS blocks UPDATE), fall back to direct update.
  //  4. Show client-computed score immediately — no extra DB round-trip.
  const submitQuiz = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      // 1. Fetch all questions + this participant's saved answers
      const [{ data: allQuestions }, { data: participantAnswers }] = await Promise.all([
        supabase.from('questions').select('id, correct_option'),
        supabase
          .from('answers')
          .select('question_id, selected_option, answer_time')
          .eq('participant_id', participantId),
      ]);

      // 2. Client-side score: 10 base + speed bonus (8 - time) for correct answers
      let finalScore = 0;
      let totalTime = 0;
      const total = allQuestions?.length ?? 0;

      if (allQuestions && participantAnswers) {
        const correctMap = new Map(allQuestions.map(q => [q.id, q.correct_option]));
        participantAnswers.forEach(ans => {
          const t: number = ans.answer_time ?? QUESTION_TIMER_SECONDS;
          totalTime += t;
          if (correctMap.get(ans.question_id) === ans.selected_option) {
            finalScore += 10 + Math.max(0, QUESTION_TIMER_SECONDS - t);
          }
        });
      }

      // 3. Try calculate_score() RPC (uses SECURITY DEFINER if configured, else anon perms)
      const { error: rpcError } = await supabase.rpc('calculate_score', {
        p_id: participantId,
      });

      if (rpcError) {
        // RPC failed — try direct UPDATE as fallback
        console.warn('calculate_score RPC failed, using direct update:', rpcError.message);
        await supabase
          .from('participants')
          .update({
            score: finalScore,
            total_time: totalTime,
            completed_at: new Date().toISOString(),
            submitted: true,
            status: 'completed',
          })
          .eq('id', participantId);
      }

      // 4. Show result using locally computed values (always correct)
      setResult({ score: finalScore, total, totalTime });
      localStorage.removeItem('participantId');
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('startedAt');
      setTimeout(() => navigate('/leaderboard'), 4000);

    } catch (err: any) {
      setError(err.message || 'Failed to submit quiz. Please try again.');
      setSubmitting(false);
      submittingRef.current = false;
    }
  }, [participantId, navigate]);

  // ── Save answer + answer_time to Supabase ─────────────────────────
  const saveAnswer = useCallback(async (questionId: string, originalLetter: string, answerTime: number) => {
    try {
      await supabase.from('answers').upsert(
        {
          participant_id: participantId,
          question_id: questionId,
          selected_option: originalLetter,
          answer_time: answerTime,
        },
        { onConflict: 'participant_id,question_id' }
      );
    } catch (err) {
      console.error('Failed to save answer:', err);
    }
  }, [participantId]);

  // ── Move to next question (or submit if last) ─────────────────────
  const moveToNext = useCallback(() => {
    const qs = questionsRef.current;
    const idx = currentIdxRef.current;
    if (idx >= qs.length - 1) {
      submitQuiz();
    } else {
      setCurrentIdx(idx + 1);
      setSelectedThisQ(null);
      setTimeLeft(QUESTION_TIMER_SECONDS);
      questionStartTimeRef.current = Date.now();
    }
  }, [submitQuiz]);

  // ── Handle option click ───────────────────────────────────────────
  const handleAnswer = useCallback(async (option: QuizOption) => {
    if (selectedThisQ !== null || submittingRef.current) return;
    const q = questionsRef.current[currentIdxRef.current];
    if (!q) return;

    const answerTime = Math.min(
      QUESTION_TIMER_SECONDS,
      Math.floor((Date.now() - questionStartTimeRef.current) / 1000)
    );

    setSelectedThisQ(option.displayLetter);
    await saveAnswer(q.id, option.originalLetter, answerTime);
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeout(() => moveToNext(), 600);
  }, [selectedThisQ, saveAnswer, moveToNext]);

  // ── 8-second per-question countdown ────────────────────────────────
  useEffect(() => {
    if (loading || result !== null || submitting || questions.length === 0) return;

    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(QUESTION_TIMER_SECONDS);
    questionStartTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          moveToNext();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, loading, submitting, questions.length]);

  // ── Initial data fetch ────────────────────────────────────────────
  useEffect(() => {
    if (!participantId) { navigate('/'); return; }

    const fetchQuizData = async () => {
      try {
        const { data: participant, error: pError } = await supabase
          .from('participants').select('*').eq('id', participantId).single();

        if (pError || !participant) {
          localStorage.removeItem('participantId');
          navigate('/');
          return;
        }
        if (participant.completed_at || participant.submitted) {
          navigate('/leaderboard');
          return;
        }

        const { data: session } = await supabase
          .from('quiz_sessions').select('id').eq('is_active', true).maybeSingle();

        if (!session) {
          setError('The quiz session has ended. Please contact the administrator.');
          setLoading(false);
          return;
        }

        const { data: rawQuestions, error: qError } = await supabase
          .from('questions')
          .select('id, question, option_a, option_b, option_c, option_d');

        if (qError) throw qError;
        if (!rawQuestions || rawQuestions.length === 0) {
          setError('No questions available. Contact the administrator.');
          setLoading(false);
          return;
        }

        const shuffled = buildShuffledQuestions(rawQuestions);
        setQuestions(shuffled);
        questionsRef.current = shuffled;
        setLoading(false);
      } catch (err: any) {
        setError(err.message || 'Failed to load quiz');
        setLoading(false);
      }
    };

    fetchQuizData();

    const channel = supabase
      .channel('quiz-session-stop')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quiz_sessions' },
        (payload) => {
          const updated = payload.new as { is_active: boolean };
          if (!updated.is_active && !submittingRef.current) submitQuiz();
        }
      )
      .subscribe();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [participantId, navigate, submitQuiz]);

  // ── Loading screen ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex flex-col items-center justify-center gap-6">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#FF5722]" />
        <p className="font-black text-gray-500 text-lg animate-pulse">Loading questions...</p>
      </div>
    );
  }

  // ── Error screen ──────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-[2rem] shadow-brutal-lg border-4 border-black max-w-md w-full text-center">
          <AlertCircle className="mx-auto text-[#FF5252] mb-4" size={64} strokeWidth={2.5} />
          <h2 className="text-3xl font-black text-black mb-4">Oops!</h2>
          <p className="text-gray-600 mb-8 font-medium text-lg">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-8 py-4 bg-[#FF5722] text-white rounded-full font-black text-lg border-2 border-black shadow-brutal hover:-translate-y-1 transition-transform"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // ── Result screen ─────────────────────────────────────────────────
  if (result !== null) {
    const maxPossible = result.total * (10 + QUESTION_TIMER_SECONDS);
    const mins = Math.floor(result.totalTime / 60);
    const secs = result.totalTime % 60;
    const timeDisplay = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex items-center justify-center p-6">
        <motion.div
          initial={{ scale: 0.8, opacity: 0, rotate: -5 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="bg-white p-10 rounded-[2.5rem] shadow-brutal-lg border-4 border-black max-w-md w-full text-center relative overflow-hidden"
        >
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#FFC107] rounded-full mix-blend-multiply opacity-50" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-[#4CAF50] rounded-full mix-blend-multiply opacity-50" />
          <Trophy className="mx-auto text-[#FFC107] mb-4 relative z-10" size={72} strokeWidth={2} />
          <h2 className="text-4xl font-black text-black mb-1 relative z-10">Quiz Complete! 🎉</h2>
          <p className="text-gray-500 mb-6 font-bold relative z-10">Great job competing!</p>
          <div className="bg-[#FFF9F0] border-4 border-black rounded-3xl p-5 mb-4 shadow-brutal-sm relative z-10 transform rotate-1">
            <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total Score</div>
            <div className="text-6xl font-black text-[#FF5722]">{result.score}</div>
            <div className="text-sm font-bold text-gray-400 mt-1">out of {maxPossible} possible pts</div>
          </div>
          <div className="grid grid-cols-2 gap-3 relative z-10 mb-6">
            <div className="bg-[#E8F5E9] border-2 border-black rounded-2xl p-3 text-center">
              <div className="text-xs font-black text-gray-500 uppercase tracking-wide mb-1">Questions</div>
              <div className="text-2xl font-black text-[#4CAF50]">{result.total}</div>
            </div>
            <div className="bg-[#FFF3E0] border-2 border-black rounded-2xl p-3 text-center">
              <div className="text-xs font-black text-gray-500 uppercase tracking-wide mb-1">Time Used</div>
              <div className="text-2xl font-black text-[#FF9800]">{timeDisplay}</div>
            </div>
          </div>
          <p className="text-sm font-bold text-gray-400 animate-pulse relative z-10">
            Heading to leaderboard in a moment...
          </p>
        </motion.div>
      </div>
    );
  }

  // ── Submitting overlay ────────────────────────────────────────────
  if (submitting) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex flex-col items-center justify-center gap-6">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#4CAF50]" />
        <p className="font-black text-gray-500 text-lg animate-pulse">Calculating your score...</p>
      </div>
    );
  }

  // ── Main Quiz UI ──────────────────────────────────────────────────
  const currentQuestion = questions[currentIdx];
  if (!currentQuestion) return null;

  const progress = questions.length > 0 ? ((currentIdx + 1) / questions.length) * 100 : 0;
  const timerPercent = (timeLeft / QUESTION_TIMER_SECONDS) * 100;
  const timerColor = timeLeft <= 3 ? '#FF5252' : timeLeft <= 5 ? '#FFC107' : '#4CAF50';

  return (
    <div className="min-h-screen bg-[#FFF9F0] flex flex-col font-sans">
      {/* ── Top Bar ── */}
      <header className="bg-white border-b-4 border-black sticky top-0 z-20 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          {/* Question progress */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-[#FFC107] text-black border-2 border-black rounded-xl px-3 py-1.5 font-black text-sm whitespace-nowrap shadow-brutal-sm">
              {currentIdx + 1} / {questions.length}
            </div>
            {/* Progress bar */}
            <div className="hidden sm:block w-32 h-3 bg-gray-200 rounded-full border border-black overflow-hidden">
              <div
                className="h-full bg-[#4CAF50] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Per-question countdown */}
          <div className="flex flex-col items-center gap-1">
            <div
              className={clsx(
                'text-3xl font-black w-16 h-16 rounded-full border-4 border-black flex items-center justify-center shadow-brutal-sm transition-colors',
                timeLeft <= 3 ? 'bg-[#FF5252] text-white animate-pulse' :
                timeLeft <= 5 ? 'bg-[#FFC107] text-black' :
                'bg-white text-black'
              )}
            >
              {timeLeft}
            </div>
          </div>
        </div>

        {/* Timer progress bar */}
        <div className="h-2 bg-gray-200 w-full">
          <div
            className="h-full transition-all duration-1000 ease-linear"
            style={{ width: `${timerPercent}%`, backgroundColor: timerColor }}
          />
        </div>
      </header>

      {/* ── Question + Options ── */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 md:px-6 py-8 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIdx}
            initial={{ x: 60, opacity: 0, rotate: 1 }}
            animate={{ x: 0, opacity: 1, rotate: 0 }}
            exit={{ x: -60, opacity: 0, rotate: -1 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            className="flex flex-col gap-6"
          >
            {/* Question card */}
            <div className="bg-white p-7 md:p-10 rounded-[2rem] shadow-brutal-lg border-4 border-black relative">
              <div className="absolute -top-5 -left-5 bg-[#FFC107] w-12 h-12 rounded-full border-4 border-black flex items-center justify-center font-black text-xl shadow-brutal-sm transform -rotate-12">
                ?
              </div>
              <h2 className="text-xl md:text-2xl font-black text-black leading-tight">
                {currentQuestion.question}
              </h2>
            </div>

            {/* Options grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentQuestion.options.map((option) => {
                const isSelected = selectedThisQ === option.displayLetter;
                const isAnySelected = selectedThisQ !== null;

                return (
                  <motion.button
                    key={option.displayLetter}
                    onClick={() => handleAnswer(option)}
                    disabled={isAnySelected}
                    whileHover={!isAnySelected ? { scale: 1.02, y: -3 } : {}}
                    whileTap={!isAnySelected ? { scale: 0.98 } : {}}
                    className={clsx(
                      'p-5 text-left rounded-[1.5rem] border-4 transition-all duration-200 relative overflow-hidden group',
                      isSelected
                        ? 'border-black bg-[#4CAF50] text-white shadow-brutal'
                        : isAnySelected
                        ? 'border-gray-300 bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'border-black bg-white hover:bg-[#FFF3E0] text-black shadow-brutal-sm hover:shadow-brutal'
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={clsx(
                        'w-11 h-11 rounded-full flex items-center justify-center font-black text-lg border-2 shrink-0 transition-colors',
                        isSelected
                          ? 'bg-white text-[#4CAF50] border-white'
                          : isAnySelected
                          ? 'bg-gray-200 text-gray-400 border-gray-300'
                          : 'bg-gray-100 text-gray-600 border-gray-300 group-hover:bg-[#FFC107] group-hover:text-black group-hover:border-black'
                      )}>
                        {option.displayLetter}
                      </div>
                      <span className="text-base md:text-lg font-bold leading-snug">{option.text}</span>
                    </div>

                    {isSelected && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute top-3 right-3 bg-white rounded-full p-1"
                      >
                        <Zap size={16} className="text-[#4CAF50] fill-current" />
                      </motion.div>
                    )}
                  </motion.button>
                );
              })}
            </div>

            {/* Skip hint */}
            {selectedThisQ === null && (
              <div className="flex items-center justify-center gap-2 text-gray-400 text-sm font-bold mt-2">
                <SkipForward size={14} />
                <span>Auto-advances in {timeLeft}s · Click an option to answer</span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
