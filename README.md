# Private 1-on-1 WebRTC Video Call

A React (Vite) + Supabase Realtime app for private 1-on-1 video calls.

## Features

- Single shared password login (no user accounts)
- Max 2 participants (presence-based room limit)
- WebRTC peer-to-peer call with STUN:
  - `stun:stun.l.google.com:19302`
- Signaling via Supabase tables:
  - `signals` (offer/answer/candidate)
  - `call_status` (idle/ringing/accepted/declined/ended)
- Ringing modal with Accept / Decline
- Auto reconnect logic:
  - ICE restart
  - PeerConnection rebuild fallback
  - reconnect on `online` event
- Mobile-first call dashboard UI
- Fullscreen, mute, camera toggle, draggable local preview

## Tech Stack

- React 18
- Vite 7
- `@supabase/supabase-js` v2
- Browser WebRTC APIs

## Project Structure

```txt
src/
  App.jsx
  main.jsx
  index.css
  supabaseClient.js
  components/
    Login.jsx
    Call.jsx
    RingingModal.jsx
  hooks/
    useSignaling.js
    useWebRTC.js
supabase/
  schema.sql
```

## Environment Variables

Create `.env` from `.env.example`:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_PRIVATE_ROOM_PASSWORD=your-private-shared-password
```

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor and run:
   - `supabase/schema.sql`
3. Ensure Realtime is enabled for:
   - `public.signals`
   - `public.call_status`
4. Use project URL + anon key in `.env`.

## Install & Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in terminal (usually `http://localhost:5173`).

## Build

```bash
npm run build
npm run preview
```

## Deploy (Vercel)

- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`
- Add env vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_PRIVATE_ROOM_PASSWORD`

## Notes

- This is a frontend-only app; no custom backend server is required.
- Keep `.env` private. Only `.env.example` should be committed.
- Current signaling and status policies in `schema.sql` are open for anon/authenticated clients for this private shared-password use case.
