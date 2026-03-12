import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Clock, Users, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { supabase } from '../supabase';

interface LeaderboardEntry {
  id: string;
  name: string;
  college: string;
  score: number;
  total_time: number | null;
  rank: number;
}

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchLeaderboard = async () => {
    // Query the leaderboard VIEW which pre-computes RANK(), ordered by score DESC, total_time ASC
    const { data, error } = await supabase
      .from('leaderboard')
      .select('id, name, college, score, total_time, rank')
      .limit(20);

    if (!error && data) {
      setLeaderboard(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLeaderboard();

    // Realtime subscription: refresh whenever participants table changes
    const channel = supabase
      .channel('leaderboard-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'participants' },
        () => {
          fetchLeaderboard();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const formatTime = (totalSeconds: number | null) => {
    if (totalSeconds == null) return '—';
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFF9F0] flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#FF5722]"></div>
      </div>
    );
  }

  const top3 = leaderboard.filter(e => e.rank <= 3);
  const rest = leaderboard.filter(e => e.rank > 3);

  // Podium: 2nd, 1st, 3rd
  const podiumOrder: Array<LeaderboardEntry> = [];
  const second = top3.find(e => e.rank === 2);
  const first  = top3.find(e => e.rank === 1);
  const third  = top3.find(e => e.rank === 3);
  if (second) podiumOrder.push(second);
  if (first)  podiumOrder.push(first);
  if (third)  podiumOrder.push(third);

  return (
    <div className="min-h-screen bg-[#FFF9F0] text-black py-12 px-4 sm:px-6 lg:px-8 font-sans relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute top-20 left-10 w-40 h-40 bg-[#FFC107] rounded-full mix-blend-multiply filter blur-3xl opacity-40"></div>
      <div className="absolute bottom-20 right-10 w-60 h-60 bg-[#4CAF50] rounded-full mix-blend-multiply filter blur-3xl opacity-30"></div>

      <div className="max-w-3xl mx-auto relative z-10">
        {/* Header */}
        <div className="flex justify-between items-center mb-12 bg-white/50 backdrop-blur-sm p-4 rounded-[2rem] border-4 border-black shadow-brutal-sm">
          <button
            onClick={() => navigate('/')}
            className="p-3 bg-white border-2 border-black rounded-full shadow-brutal-sm hover:-translate-y-1 transition-transform active:translate-y-0"
          >
            <Home size={24} />
          </button>
          <div className="text-center flex-1">
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-black">Leaderboard</h1>
            <p className="text-gray-500 font-bold mt-1 uppercase tracking-widest text-sm">🏆 Top Performers</p>
          </div>
          <div className="w-12 h-12 opacity-0 pointer-events-none"></div>
        </div>

        {leaderboard.length === 0 ? (
          <div className="bg-white p-12 rounded-[2rem] border-4 border-black shadow-brutal text-center flex flex-col items-center">
            <Users className="w-16 h-16 mb-4 text-gray-300" />
            <p className="text-xl font-bold text-gray-500">No participants have completed the quiz yet.</p>
            <p className="text-gray-400 font-medium mt-2">Check back soon!</p>
          </div>
        ) : (
          <>
            {/* Podium Section */}
            {podiumOrder.length > 0 && (
              <div className="flex justify-center items-end mt-8 mb-20 gap-2 md:gap-6">
                {podiumOrder.map((entry, idx) => {
                  const isFirst = entry.rank === 1;
                  const isThird = entry.rank === 3;
                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 50 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.2, type: 'spring' }}
                      className="flex flex-col items-center relative"
                    >
                      <div className="mb-4 flex flex-col items-center">
                        <div
                          className={clsx(
                            'rounded-full border-4 border-black flex items-center justify-center font-black text-white shadow-brutal-sm z-10 relative',
                            isFirst ? 'w-24 h-24 bg-[#FFC107] text-3xl' : 'w-16 h-16 bg-gray-300 text-xl',
                            isThird && 'bg-[#FF9800]'
                          )}
                        >
                          {getInitials(entry.name)}
                          <div className="absolute -bottom-3 bg-white text-black text-xs px-3 py-1 rounded-full border-2 border-black font-bold whitespace-nowrap z-20 shadow-sm">
                            {entry.score} pts
                          </div>
                        </div>
                        <div className="mt-6 font-black text-center text-sm md:text-base w-28 md:w-32 truncate px-1">
                          {entry.name}
                        </div>
                        <div className="text-xs text-gray-500 font-bold w-28 md:w-32 text-center truncate px-2 mt-0.5">
                          {entry.college}
                        </div>
                      </div>

                      <div
                        className={clsx(
                          'w-24 md:w-32 border-4 border-b-0 border-black rounded-t-2xl shadow-[inset_0_-10px_0_rgba(0,0,0,0.1)] flex justify-center pt-4',
                          isFirst ? 'h-40 bg-[#FF5722]' : entry.rank === 2 ? 'h-28 bg-[#4CAF50]' : 'h-20 bg-[#03A9F4]'
                        )}
                      >
                        <span className="text-4xl font-black text-white opacity-80">{entry.rank}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* List Section (rank 4+) */}
            <div className="space-y-4">
              {rest.map((entry, index) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-white border-4 border-black rounded-[1.5rem] p-4 md:p-5 flex items-center shadow-brutal-sm hover:-translate-y-1 transition-transform group"
                >
                  <div className="w-8 md:w-12 font-black text-xl md:text-2xl text-gray-300 text-center shrink-0 group-hover:text-black transition-colors">{entry.rank}</div>

                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[#f4f4f4] border-2 border-black flex items-center justify-center font-black text-gray-700 mx-3 md:mr-5 shrink-0">
                    {getInitials(entry.name)}
                  </div>

                  <div className="flex-1 min-w-0 pr-4 flex flex-col justify-center">
                    <div className="font-black text-lg md:text-xl truncate leading-tight">{entry.name}</div>
                    <div className="text-sm text-gray-500 font-bold truncate mt-0.5">{entry.college}</div>
                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end justify-center">
                    <div className="font-black text-lg md:text-xl text-[#FF5722] bg-[#FFF3E0] px-3 md:px-5 py-1.5 rounded-full border-2 border-[#FF5722] shadow-[2px_2px_0px_rgba(255,87,34,1)]">
                      {entry.score} <span className="text-xs md:text-sm font-bold opacity-80">pts</span>
                    </div>
                    <div className="text-[11px] md:text-xs font-bold text-gray-500 mt-2 flex items-center bg-gray-100 px-2.5 py-1 rounded-md border-2 border-transparent group-hover:border-gray-200 transition-colors">
                      <Clock size={12} className="mr-1.5 text-gray-400 group-hover:text-[#FF5722] transition-colors" />
                      {formatTime(entry.total_time)}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
