import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, User, Building2, ArrowRight, AlertCircle, BookOpen, Phone } from 'lucide-react';
import { supabase } from '../supabase';

export default function Home() {
  const [name, setName] = useState('');
  const [college, setCollege] = useState('');
  const [dept, setDept] = useState('');
  const [phone, setPhone] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const checkExisting = async () => {
      const participantId = localStorage.getItem('participantId');

      // Always check session status first
      const { data: activeSession } = await supabase
        .from('quiz_sessions')
        .select('is_active')
        .eq('is_active', true)
        .maybeSingle();

      if (!participantId) {
        setIsActive(!!activeSession);
        setLoading(false);
        return;
      }

      // Check if stored participant ID is still valid and in-progress
      const { data, error } = await supabase
        .from('participants')
        .select('completed_at')
        .eq('id', participantId)
        .single();

      const shouldClear =
        error ||            // ID not found in DB
        !data ||            // fetch problem
        !!data.completed_at || // quiz already completed
        !activeSession;     // quiz session ended / not started

      if (shouldClear) {
        localStorage.removeItem('participantId');
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('startedAt');
        setIsActive(!!activeSession);
        setLoading(false);
      } else {
        // Active session + participant still in progress → resume quiz
        navigate('/quiz');
      }
    };

    checkExisting();


    // Realtime: listen for session changes
    const channel = supabase
      .channel('quiz-session-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_sessions' },
        (payload) => {
          const updated = payload.new as { is_active: boolean };
          if (updated?.is_active !== undefined) {
            setIsActive(updated.is_active);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim() || !college.trim() || !dept.trim() || !phone.trim()) {
      setError('Please fill in all fields');
      return;
    }
    if (!/^[0-9]{10}$/.test(phone.trim())) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }

    setSubmitting(true);

    try {
      // Check if quiz is still active
      const { data: session } = await supabase
        .from('quiz_sessions')
        .select('is_active')
        .eq('is_active', true)
        .maybeSingle();

      if (!session) {
        setError('Quiz is not active. Please wait for the administrator.');
        setSubmitting(false);
        return;
      }

      // Generate a unique session token
      const sessionToken = crypto.randomUUID();

      const { data, error: insertError } = await supabase
        .from('participants')
        .insert({
          name: name.trim(),
          college: college.trim(),
          dept: dept.trim(),
          phone: phone.trim(),
          session_token: sessionToken,
          score: 0,
        })
        .select('id, session_token')
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          setError('This name + college combination is already registered. If this is you, please contact an admin.');
        } else {
          setError(insertError.message || 'Registration failed. Please try again.');
        }
        setSubmitting(false);
        return;
      }

      localStorage.setItem('participantId', data.id);
      localStorage.setItem('sessionToken', data.session_token);
      localStorage.setItem('startedAt', new Date().toISOString());
      navigate('/quiz');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#FF5722]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF9F0] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute top-10 left-10 w-32 h-32 bg-[#FFC107] rounded-full mix-blend-multiply filter blur-2xl opacity-50 animate-blob"></div>
      <div className="absolute top-10 right-10 w-32 h-32 bg-[#4CAF50] rounded-full mix-blend-multiply filter blur-2xl opacity-50 animate-blob animation-delay-2000"></div>
      <div className="absolute -bottom-8 left-20 w-32 h-32 bg-[#FF5722] rounded-full mix-blend-multiply filter blur-2xl opacity-50 animate-blob animation-delay-4000"></div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="bg-white p-8 md:p-12 rounded-[2rem] shadow-brutal-lg border-4 border-black max-w-md w-full relative z-10"
      >
        <div className="flex justify-center mb-6">
          <div className="bg-[#FFC107] p-4 rounded-2xl shadow-brutal border-2 border-black transform -rotate-6">
            <Sparkles size={40} className="text-black" />
          </div>
        </div>

        <h1 className="text-4xl md:text-5xl font-black text-center text-black mb-2 tracking-tight leading-none">
          College Quiz
        </h1>
        <p className="text-center text-[#FF5722] font-black text-xl mb-4">Quiz Challenge 🎓</p>
        <p className="text-center text-gray-500 mb-8 font-medium text-sm">
          Test your knowledge and compete for the top spot on the leaderboard!
        </p>

        {!isActive ? (
          <div className="bg-[#FFEBEE] border-2 border-[#FF5252] text-[#D32F2F] p-4 rounded-2xl text-center font-bold shadow-brutal-sm flex items-center justify-center gap-3">
            <AlertCircle size={20} />
            <span>Quiz hasn't started yet. Please wait for the administrator.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-100 border-2 border-red-500 text-red-700 p-3 rounded-xl text-sm text-center font-bold flex items-center justify-center gap-2">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-black">
                  <User size={20} className="opacity-50" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="block w-full pl-12 pr-4 py-4 bg-[#F5F5F5] border-2 border-black rounded-2xl focus:bg-white focus:ring-0 focus:border-[#FF5722] transition-colors text-lg font-semibold placeholder-gray-400 shadow-brutal-sm outline-none"
                  placeholder="Your Full Name"
                  required
                />
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Building2 size={20} className="opacity-50" />
                </div>
                <input
                  type="text"
                  value={college}
                  onChange={(e) => setCollege(e.target.value)}
                  className="block w-full pl-12 pr-4 py-4 bg-[#F5F5F5] border-2 border-black rounded-2xl focus:bg-white focus:ring-0 focus:border-[#FF5722] transition-colors text-lg font-semibold placeholder-gray-400 shadow-brutal-sm outline-none"
                  placeholder="College Name"
                  required
                />
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <BookOpen size={20} className="opacity-50" />
                </div>
                <input
                  type="text"
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="block w-full pl-12 pr-4 py-4 bg-[#F5F5F5] border-2 border-black rounded-2xl focus:bg-white focus:ring-0 focus:border-[#FF5722] transition-colors text-lg font-semibold placeholder-gray-400 shadow-brutal-sm outline-none"
                  placeholder="Department (e.g. CSE, ECE)"
                  required
                />
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Phone size={20} className="opacity-50" />
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="block w-full pl-12 pr-4 py-4 bg-[#F5F5F5] border-2 border-black rounded-2xl focus:bg-white focus:ring-0 focus:border-[#FF5722] transition-colors text-lg font-semibold placeholder-gray-400 shadow-brutal-sm outline-none"
                  placeholder="Phone Number (10 digits)"
                  required
                />
              </div>

            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-between py-4 px-6 border-2 border-black rounded-full text-lg font-black text-white bg-[#FF5722] hover:bg-[#E64A19] hover:-translate-y-1 hover:shadow-brutal transition-all active:translate-y-0 active:shadow-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span>{submitting ? 'Registering...' : 'Start Quiz'}</span>
              <div className="bg-white text-[#FF5722] p-2 rounded-full">
                <ArrowRight size={20} strokeWidth={3} />
              </div>
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
