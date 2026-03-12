import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Users, Database, Play, Square,
  Upload, Trash2, LogOut, Download, AlertCircle, CheckCircle2,
  LayoutDashboard, PlusCircle, X
} from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../supabase';

// Admin password stored in env — fallback to 'admin123' for dev
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'admin123';

interface Question {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
}

interface Participant {
  id: string;
  name: string;
  college: string;
  score: number;
  total_time: number;
  status: string;
  submitted: boolean;
  started_at: string;
  completed_at: string | null;
}

interface QuizSession {
  id: string;
  title: string;
  is_active: boolean;
  start_time: string | null;
  end_time: string | null;
}

export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [questions, setQuestions] = useState<Question[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [session, setSession] = useState<QuizSession | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'questions' | 'participants'>('overview');
  const [loading, setLoading] = useState(false);
  const [toggleError, setToggleError] = useState('');

  // Add question form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newQ, setNewQ] = useState({
    question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'A'
  });
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- Auth ----------
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setAuthed(true);
      sessionStorage.setItem('adminAuthed', '1');
    } else {
      setLoginError('Incorrect password. Try again.');
    }
  };

  useEffect(() => {
    if (sessionStorage.getItem('adminAuthed') === '1') setAuthed(true);
  }, []);

  // ---------- Data Fetching ----------
  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchSession(), fetchQuestions(), fetchParticipants()]);
    setLoading(false);
  };

  const fetchSession = async () => {
    const { data } = await supabase
      .from('quiz_sessions')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    setSession(data);
  };

  const fetchQuestions = async () => {
    const { data } = await supabase
      .from('questions')
      .select('*')
      .order('created_at', { ascending: true });
    setQuestions(data || []);
  };

  const fetchParticipants = async () => {
    const { data } = await supabase
      .from('participants')
      .select('*')
      .order('started_at', { ascending: false });
    setParticipants(data || []);
  };

  useEffect(() => {
    if (!authed) return;
    fetchAll();

    // Realtime: participants changes
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        fetchParticipants();
        fetchSession(); // refresh counts
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_sessions' }, () => {
        fetchSession();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authed]);

  // ---------- Quiz Session Control ----------
  const toggleQuiz = async (startIt: boolean) => {
    setToggleError('');
    let error;

    if (startIt) {
      if (session) {
        // Update existing (previously stopped) session
        const res = await supabase
          .from('quiz_sessions')
          .update({ is_active: true, start_time: new Date().toISOString(), end_time: null })
          .eq('id', session.id);
        error = res.error;
      } else {
        // Create first-ever session
        const res = await supabase.from('quiz_sessions').insert({
          title: 'College Quiz',
          is_active: true,
          start_time: new Date().toISOString(),
        });
        error = res.error;
      }
    } else {
      if (session) {
        const res = await supabase
          .from('quiz_sessions')
          .update({ is_active: false, end_time: new Date().toISOString() })
          .eq('id', session.id);
        error = res.error;
      }
    }

    if (error) {
      console.error('toggleQuiz error:', error);
      setToggleError(
        error.code === '42501'
          ? `Permission denied. Run the missing RLS policy SQL in Supabase (see setup guide). Code: ${error.code}`
          : `Failed to ${startIt ? 'start' : 'stop'} quiz: ${error.message}`
      );
      return;
    }

    await fetchSession();
  };

  // ---------- Questions ----------
  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');

    const { error } = await supabase.from('questions').insert({
      question: newQ.question.trim(),
      option_a: newQ.option_a.trim(),
      option_b: newQ.option_b.trim(),
      option_c: newQ.option_c.trim(),
      option_d: newQ.option_d.trim(),
      correct_option: newQ.correct_option,
    });

    if (error) {
      setAddError(error.message);
    } else {
      setAddSuccess('Question added!');
      setNewQ({ question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: 'A' });
      fetchQuestions();
      setTimeout(() => setAddSuccess(''), 2000);
    }
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm('Delete this question?')) return;
    await supabase.from('questions').delete().eq('id', id);
    fetchQuestions();
  };

  // Proper RFC-4180 CSV row parser — handles quoted fields with commas
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // Escaped double-quote inside quoted field
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };

  // CSV Upload — parse client-side and bulk insert
  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const rawText = await file.text();
    // Normalize line endings and split
    const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) { alert('CSV file is empty or has no data rows.'); return; }

    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g, '').trim());

    const rows = lines.slice(1).map(line => {
      const cols = parseCSVLine(line);
      const obj: Record<string, string> = {};
      header.forEach((h, i) => { obj[h] = (cols[i] || '').replace(/^"|"$/g, '').trim(); });
      return obj;
    }).filter(r => (r.question || r.text || '').trim() !== '');

    if (rows.length === 0) { alert('No valid data rows found in CSV.'); return; }

    // Normalize: support column names "text" or "question", and correct_option like "option_c" → "C"
    const mapped = rows.map(r => {
      const rawCorrect = (r.correct_option || r.answer || r.correct || 'A').trim().toUpperCase();
      // Convert "OPTION_C" → "C", or "C" stays "C"
      const correct = rawCorrect.replace(/^OPTION_/, '');
      return {
        question: r.question || r.text || '',
        option_a: r.option_a || r.a || '',
        option_b: r.option_b || r.b || '',
        option_c: r.option_c || r.c || '',
        option_d: r.option_d || r.d || '',
        correct_option: correct,
      };
    });

    const { error } = await supabase.from('questions').insert(mapped);
    if (error) {
      alert(`Upload failed: ${error.message}`);
    } else {
      alert(`Successfully uploaded ${mapped.length} questions!`);
      fetchQuestions();
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearAllQuestions = async () => {
    if (!confirm('Delete ALL questions? This cannot be undone.')) return;
    await supabase.from('questions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    fetchQuestions();
  };

  // ---------- Participants ----------
  const clearParticipants = async () => {
    if (!confirm('Delete ALL participants and answers? This cannot be undone.')) return;
    // Cascade deletes answers due to FK ON DELETE CASCADE
    await supabase.from('participants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    fetchParticipants();
  };

  const exportCSV = () => {
    if (participants.length === 0) return;
    const headers = ['Rank', 'Name', 'College', 'Score', 'Total Time (s)', 'Status', 'Started At', 'Completed At'];
    const completed = participants.filter(p => p.submitted).sort((a, b) => b.score - a.score || a.total_time - b.total_time);
    const inProgress = participants.filter(p => !p.submitted);
    const sorted = [...completed, ...inProgress];
    const rows = sorted.map((p, i) => [
      p.submitted ? i + 1 : '—',
      `"${p.name}"`,
      `"${p.college}"`,
      p.score,
      p.total_time,
      p.submitted ? 'Completed' : (p.status || 'In Progress'),
      p.started_at,
      p.completed_at || '',
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quiz_participants.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Stats ----------
  const completedCount = participants.filter(p => p.submitted).length;

  // ============================
  // LOGIN
  // ============================
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex items-center justify-center p-6 relative overflow-hidden font-sans">
        <div className="absolute top-10 left-10 w-32 h-32 bg-[#FFC107] rounded-full mix-blend-multiply filter blur-2xl opacity-50"></div>
        <div className="absolute bottom-10 right-10 w-32 h-32 bg-[#9C27B0] rounded-full mix-blend-multiply filter blur-2xl opacity-50"></div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="bg-white p-8 md:p-12 rounded-[2rem] shadow-brutal-lg border-4 border-black max-w-md w-full relative z-10"
        >
          <div className="flex justify-center mb-6">
            <div className="bg-[#9C27B0] p-4 rounded-2xl shadow-brutal border-2 border-black transform rotate-6">
              <Settings size={40} className="text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-black text-center text-black mb-8">Admin Login</h1>

          <form onSubmit={handleLogin} className="space-y-6">
            {loginError && (
              <div className="bg-[#FFEBEE] border-2 border-[#FF5252] text-[#D32F2F] p-3 rounded-xl text-sm text-center font-bold flex items-center justify-center shadow-brutal-sm">
                <AlertCircle size={18} className="mr-2" />
                {loginError}
              </div>
            )}

            <div>
              <label className="block text-lg font-black text-black mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="block w-full px-4 py-4 bg-[#F5F5F5] border-2 border-black rounded-2xl focus:bg-white focus:border-[#9C27B0] transition-colors text-lg font-semibold placeholder-gray-400 shadow-brutal-sm outline-none"
                placeholder="Enter admin password"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full flex justify-center py-4 px-6 border-2 border-black rounded-full text-lg font-black text-white bg-[#9C27B0] hover:bg-[#7B1FA2] hover:-translate-y-1 hover:shadow-brutal transition-all active:translate-y-0 active:shadow-none"
            >
              Login to Dashboard
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  // ============================
  // DASHBOARD
  // ============================
  return (
    <div className="min-h-screen bg-[#FFF9F0] flex flex-col md:flex-row font-sans">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-white border-b-4 md:border-b-0 md:border-r-4 border-black flex flex-col z-20">
        <div className="p-6 border-b-4 border-black flex items-center space-x-4 bg-[#FFC107]">
          <div className="bg-white p-2 rounded-xl border-2 border-black shadow-brutal-sm transform -rotate-6">
            <Settings className="text-black" size={24} strokeWidth={3} />
          </div>
          <span className="text-2xl font-black text-black">Admin Panel</span>
        </div>

        <nav className="flex-1 p-6 flex flex-col space-y-4">
          {(['overview', 'questions', 'participants'] as const).map((tab) => {
            const icons = { overview: <LayoutDashboard size={24} />, questions: <Database size={24} />, participants: <Users size={24} /> };
            const colors = { overview: 'bg-[#FFC107] text-black', questions: 'bg-[#03A9F4] text-white', participants: 'bg-[#4CAF50] text-white' };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'flex items-center space-x-4 px-5 py-4 rounded-2xl transition-all font-black text-lg border-2 capitalize',
                  activeTab === tab
                    ? `${colors[tab]} border-black shadow-brutal translate-x-1`
                    : 'bg-transparent border-transparent text-gray-600 hover:bg-gray-100 hover:border-black hover:shadow-brutal-sm'
                )}
              >
                {icons[tab]}
                <span>{tab}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-6 border-t-4 border-black bg-gray-50">
          <button
            onClick={() => { setAuthed(false); sessionStorage.removeItem('adminAuthed'); }}
            className="flex items-center justify-center space-x-3 px-4 py-4 w-full rounded-2xl text-white bg-[#FF5252] border-2 border-black font-black text-lg hover:-translate-y-1 hover:shadow-brutal transition-all active:translate-y-0 active:shadow-none"
          >
            <LogOut size={24} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto relative">
        <div className="absolute top-20 right-20 w-64 h-64 bg-[#03A9F4] rounded-full mix-blend-multiply filter blur-3xl opacity-10 pointer-events-none"></div>
        <div className="absolute bottom-20 left-20 w-64 h-64 bg-[#FFC107] rounded-full mix-blend-multiply filter blur-3xl opacity-10 pointer-events-none"></div>

        <AnimatePresence mode="wait">

          {/* ---- OVERVIEW ---- */}
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 relative z-10"
            >
              {/* Quiz Control */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-6 md:p-8 rounded-[2rem] border-4 border-black shadow-brutal">
                <div>
                  <h2 className="text-4xl font-black text-black mb-1">Dashboard</h2>
                  <p className="text-gray-500 font-bold">Manage your quiz session in real-time.</p>
                </div>

                <div className="flex flex-col gap-3">
                  {toggleError && (
                    <div className="bg-[#FFEBEE] border-2 border-[#FF5252] text-[#D32F2F] p-3 rounded-xl text-sm font-bold flex items-center shadow-brutal-sm">
                      <AlertCircle size={18} className="mr-2 shrink-0" />
                      {toggleError}
                    </div>
                  )}

                  <div className="flex items-center space-x-4 bg-[#F5F5F5] p-3 rounded-2xl border-2 border-black shadow-inner">
                    <span className="px-4 font-black text-gray-600 uppercase tracking-wider">Status:</span>
                    {session?.is_active ? (
                      <button
                        onClick={() => toggleQuiz(false)}
                        className="flex items-center space-x-2 px-6 py-3 bg-[#FF5252] text-white rounded-xl font-black border-2 border-black shadow-brutal-sm hover:-translate-y-1 transition-transform active:translate-y-0"
                      >
                        <Square size={20} fill="currentColor" />
                        <span>STOP QUIZ</span>
                      </button>
                    ) : (
                      <div className="flex flex-col items-center">
                        <button
                          onClick={() => toggleQuiz(true)}
                          disabled={questions.length === 0}
                          className="flex items-center space-x-2 px-6 py-3 bg-[#4CAF50] text-white rounded-xl font-black border-2 border-black shadow-brutal-sm hover:-translate-y-1 transition-transform active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Play size={20} fill="currentColor" />
                          <span>START QUIZ</span>
                        </button>
                        {questions.length === 0 && (
                          <span className="text-[10px] font-bold text-[#FF5252] mt-1">Upload questions first!</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: 'Participants', value: participants.length, color: '#FFC107', icon: <Users size={28} strokeWidth={3} />, bg: 'bg-[#FFC107]' },
                  { label: 'Completed', value: completedCount, color: '#4CAF50', icon: <CheckCircle2 size={28} strokeWidth={3} />, bg: 'bg-[#4CAF50] text-white' },
                  { label: 'Questions', value: questions.length, color: '#03A9F4', icon: <Database size={28} strokeWidth={3} />, bg: 'bg-[#03A9F4] text-white' },
                ].map(stat => (
                  <div key={stat.label} className="bg-white p-8 rounded-[2rem] border-4 border-black shadow-brutal relative overflow-hidden group hover:-translate-y-2 transition-transform">
                    <div className="flex items-center justify-between mb-6 relative z-10">
                      <h3 className="text-xl font-black text-gray-500 uppercase tracking-wider">{stat.label}</h3>
                      <div className={`p-4 ${stat.bg} border-2 border-black rounded-2xl shadow-brutal-sm transform rotate-3`}>
                        {stat.icon}
                      </div>
                    </div>
                    <div className="text-6xl font-black text-black relative z-10">{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Recent participants */}
              {participants.length > 0 && (
                <div className="bg-white p-6 md:p-8 rounded-[2rem] border-4 border-black shadow-brutal">
                  <h3 className="text-2xl font-black text-black mb-6">Recent Participants</h3>
                  <div className="space-y-3">
                    {participants.slice(0, 5).map(p => (
                      <div key={p.id} className="flex items-center justify-between p-4 bg-[#F5F5F5] rounded-2xl border-2 border-black">
                        <div>
                          <div className="font-black text-lg">{p.name}</div>
                          <div className="text-sm text-gray-500 font-bold">{p.college}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          {p.submitted ? (
                            <>
                              <span className="font-black text-xl text-[#FF5722]">{p.score} pts</span>
                              <span className="px-3 py-1 rounded-full text-sm font-black bg-[#4CAF50] text-white border-2 border-black">Done</span>
                            </>
                          ) : (
                            <span className="px-3 py-1 rounded-full text-sm font-black bg-[#FFC107] text-black border-2 border-black">{p.status || 'In Progress'}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ---- QUESTIONS ---- */}
          {activeTab === 'questions' && (
            <motion.div
              key="questions"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 relative z-10"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-6 md:p-8 rounded-[2rem] border-4 border-black shadow-brutal">
                <div>
                  <h2 className="text-4xl font-black text-black mb-1">Question Bank</h2>
                  <p className="text-gray-500 font-bold">{questions.length} questions loaded.</p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleCSVUpload} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center space-x-2 px-5 py-3.5 bg-[#03A9F4] text-white border-2 border-black rounded-2xl font-black text-base shadow-brutal hover:-translate-y-1 transition-transform"
                  >
                    <Upload size={20} />
                    <span>Upload CSV</span>
                  </button>
                  <button
                    onClick={() => setShowAddForm(v => !v)}
                    className="flex items-center space-x-2 px-5 py-3.5 bg-[#4CAF50] text-white border-2 border-black rounded-2xl font-black text-base shadow-brutal hover:-translate-y-1 transition-transform"
                  >
                    <PlusCircle size={20} />
                    <span>Add Manually</span>
                  </button>
                  {questions.length > 0 && (
                    <button
                      onClick={clearAllQuestions}
                      className="flex items-center space-x-2 px-5 py-3.5 bg-[#FF5252] text-white border-2 border-black rounded-2xl font-black text-base shadow-brutal hover:-translate-y-1 transition-transform"
                    >
                      <Trash2 size={20} />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Add Question Form */}
              <AnimatePresence>
                {showAddForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-white p-6 md:p-8 rounded-[2rem] border-4 border-black shadow-brutal overflow-hidden"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-2xl font-black">Add Question</h3>
                      <button onClick={() => setShowAddForm(false)} className="p-2 rounded-xl border-2 border-black hover:bg-gray-100">
                        <X size={20} />
                      </button>
                    </div>

                    {addError && <div className="mb-4 p-3 bg-red-100 border-2 border-red-400 text-red-700 rounded-xl font-bold text-sm">{addError}</div>}
                    {addSuccess && <div className="mb-4 p-3 bg-green-100 border-2 border-green-400 text-green-700 rounded-xl font-bold text-sm">{addSuccess}</div>}

                    <form onSubmit={handleAddQuestion} className="space-y-4">
                      <div>
                        <label className="block font-black text-sm mb-1 uppercase tracking-wider">Question *</label>
                        <textarea
                          value={newQ.question}
                          onChange={e => setNewQ(p => ({ ...p, question: e.target.value }))}
                          rows={2}
                          className="w-full px-4 py-3 bg-[#F5F5F5] border-2 border-black rounded-2xl font-semibold placeholder-gray-400 outline-none focus:border-[#03A9F4] transition-colors resize-none"
                          placeholder="Enter question text"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {['a', 'b', 'c', 'd'].map(opt => (
                          <div key={opt}>
                            <label className="block font-black text-sm mb-1 uppercase tracking-wider">Option {opt.toUpperCase()} *</label>
                            <input
                              type="text"
                              value={newQ[`option_${opt}` as keyof typeof newQ]}
                              onChange={e => setNewQ(p => ({ ...p, [`option_${opt}`]: e.target.value }))}
                              className="w-full px-4 py-3 bg-[#F5F5F5] border-2 border-black rounded-2xl font-semibold placeholder-gray-400 outline-none focus:border-[#03A9F4] transition-colors"
                              placeholder={`Option ${opt.toUpperCase()}`}
                              required
                            />
                          </div>
                        ))}
                      </div>

                      <div>
                        <label className="block font-black text-sm mb-1 uppercase tracking-wider">Correct Answer *</label>
                        <div className="flex gap-3">
                          {['A', 'B', 'C', 'D'].map(opt => (
                            <button
                              type="button"
                              key={opt}
                              onClick={() => setNewQ(p => ({ ...p, correct_option: opt }))}
                              className={clsx(
                                'w-14 h-14 rounded-full font-black text-xl border-2 transition-all',
                                newQ.correct_option === opt
                                  ? 'bg-[#4CAF50] text-white border-black shadow-brutal'
                                  : 'bg-gray-100 text-gray-600 border-gray-300 hover:border-black'
                              )}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full py-4 px-6 bg-[#4CAF50] text-white border-2 border-black rounded-full font-black text-lg shadow-brutal hover:-translate-y-1 transition-transform"
                      >
                        Add Question
                      </button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Questions Table */}
              <div className="bg-white rounded-[2rem] shadow-brutal border-4 border-black overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-black">
                    <thead className="bg-[#FFC107] text-black font-black border-b-4 border-black text-base">
                      <tr>
                        <th className="px-6 py-5">#</th>
                        <th className="px-6 py-5">Question</th>
                        <th className="px-6 py-5">Options</th>
                        <th className="px-6 py-5">Correct</th>
                        <th className="px-6 py-5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-gray-200 font-medium">
                      {questions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-16 text-center text-gray-500 text-lg font-bold">
                            No questions yet. Upload a CSV or add manually!
                          </td>
                        </tr>
                      ) : (
                        questions.map((q, idx) => (
                          <tr key={q.id} className="hover:bg-[#FFF3E0] transition-colors">
                            <td className="px-6 py-5 font-black text-gray-400 text-lg">{idx + 1}</td>
                            <td className="px-6 py-5 max-w-xs">
                              <div className="font-bold text-base line-clamp-2" title={q.question}>{q.question}</div>
                            </td>
                            <td className="px-6 py-5">
                              <div className="text-sm space-y-1 text-gray-600 font-bold">
                                <div><span className="text-black">A:</span> {q.option_a}</div>
                                <div><span className="text-black">B:</span> {q.option_b}</div>
                                <div><span className="text-black">C:</span> {q.option_c}</div>
                                <div><span className="text-black">D:</span> {q.option_d}</div>
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <span className="inline-flex items-center justify-center w-10 h-10 bg-[#4CAF50] text-white font-black rounded-full border-2 border-black shadow-brutal-sm">
                                {q.correct_option}
                              </span>
                            </td>
                            <td className="px-6 py-5 text-right">
                              <button
                                onClick={() => deleteQuestion(q.id)}
                                className="p-3 bg-[#FF5252] text-white border-2 border-black rounded-xl shadow-brutal-sm hover:-translate-y-1 transition-transform"
                              >
                                <Trash2 size={20} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ---- PARTICIPANTS ---- */}
          {activeTab === 'participants' && (
            <motion.div
              key="participants"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 relative z-10"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white p-6 md:p-8 rounded-[2rem] border-4 border-black shadow-brutal">
                <div>
                  <h2 className="text-4xl font-black text-black mb-1">Participants</h2>
                  <p className="text-gray-500 font-bold">
                   {participants.length} registered · {completedCount} completed
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <button
                    onClick={exportCSV}
                    disabled={participants.length === 0}
                    className="flex items-center space-x-3 px-6 py-4 bg-[#9C27B0] text-white border-2 border-black rounded-2xl font-black text-lg shadow-brutal hover:-translate-y-1 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download size={24} />
                    <span>Export CSV</span>
                  </button>
                  <button
                    onClick={clearParticipants}
                    className="flex items-center space-x-3 px-6 py-4 bg-[#FF5252] text-white border-2 border-black rounded-2xl font-black text-lg shadow-brutal hover:-translate-y-1 transition-transform"
                  >
                    <Trash2 size={24} />
                    <span>Clear All</span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-[2rem] shadow-brutal border-4 border-black overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-black">
                    <thead className="bg-[#FFC107] text-black font-black border-b-4 border-black text-base">
                      <tr>
                        <th className="px-6 py-5">Name</th>
                        <th className="px-6 py-5">College</th>
                        <th className="px-6 py-5">Email</th>
                        <th className="px-6 py-5">Status</th>
                        <th className="px-6 py-5">Score</th>
                        <th className="px-6 py-5">Started</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-gray-200 font-medium">
                      {participants.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-16 text-center text-gray-500 text-lg font-bold">
                            No participants yet. Start the quiz to let them in!
                          </td>
                        </tr>
                      ) : (
                        participants.map(p => (
                          <tr key={p.id} className="hover:bg-[#FFF3E0] transition-colors">
                            <td className="px-6 py-5 font-black text-lg">{p.name}</td>
                            <td className="px-6 py-5 text-gray-600 font-bold">{p.college}</td>
                            <td className="px-6 py-5 text-gray-500 font-bold text-sm">{p.email || '—'}</td>
                            <td className="px-6 py-5">
                              {p.completed_at ? (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-black bg-[#4CAF50] text-white border-2 border-black shadow-brutal-sm">
                                  Completed
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-black bg-[#FFC107] text-black border-2 border-black shadow-brutal-sm">
                                  In Progress
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-5">
                              {p.completed_at ? (
                                <span className="font-black text-2xl text-[#FF5722]">{p.score}</span>
                              ) : (
                                <span className="font-black text-xl text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-6 py-5 text-gray-500 font-bold">
                              {new Date(p.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
