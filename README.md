# College Quiz Platform

A scalable, real-time quiz platform built with React, Tailwind CSS, Node.js, Express, and SQLite.

## Features
- Real-time Leaderboard with Socket.io
- Auto-saving answers and session recovery
- Randomized questions and options
- Admin dashboard with CSV upload and export
- Secure server-side scoring

## Tech Stack
- Frontend: React, Tailwind CSS, Framer Motion, Lucide React
- Backend: Node.js, Express, Socket.io
- Database: SQLite (better-sqlite3)

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser:
   - App: `http://localhost:3000`
   - Admin: `http://localhost:3000/admin`
   - Default Admin Password: `admin123`

## Admin Instructions
1. Login to the admin panel.
2. Upload the `sample_questions.csv` file in the "Questions" tab.
3. Go to the "Overview" tab and click "START QUIZ".
4. Participants can now register and take the quiz.

## Deployment
- **Frontend & Backend**: This app is designed as a single full-stack application. You can deploy it to platforms like Render, Railway, or Heroku.
- Ensure you set up a persistent volume for the `quiz.db` SQLite file, or migrate to PostgreSQL for a truly serverless deployment.

## Architecture
- **Client**: React SPA communicating via REST API and WebSockets.
- **Server**: Express serving API routes and Vite middleware in dev (static files in prod).
- **Database**: SQLite storing participants, questions, answers, and settings.
