# YouTube Watch Party

A React + Express + Socket.IO MVP for watching YouTube videos together.

## Features
- Create rooms and join by room code or invite link
- YouTube IFrame player
- Synchronized play, pause, seek, and video changes
- Host and Moderator playback permissions enforced on the server
- Host can promote/demote participants and remove participants
- Participant action requests that Host/Moderator can approve or decline
- Room chat
- Responsive UI

## Requirements
- Node.js 18 or later
- npm

## Run locally

### 1. Start backend
```bash
cd server
npm install
npm run dev
```
Backend: http://localhost:3000

### 2. Start frontend in a second terminal
```bash
cd client
npm install
npm run dev
```
Frontend: http://localhost:5173

`client/.env` contains `VITE_SERVER_URL=http://localhost:3000`. Restart Vite after changing it.

## Test
1. Open the frontend in two different browser sessions (for example, a normal window and an incognito window).
2. In the first session, enter a name and create a room.
3. Copy the room code and join from the second session with another name.
4. Test play/pause, +10 seconds, changing the YouTube URL, chat, role changes, and participant removal.
5. Try controls as a Participant; requests should need Host/Moderator approval.

## Deployment
Deploy `server` and `client` as separate services, or configure a full-stack host.

### Backend service
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Set `CLIENT_ORIGIN` to the deployed frontend origin (for example, `https://your-frontend.example.com`).

### Frontend static site
- Root directory: `client`
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Set `VITE_SERVER_URL` to the deployed backend URL (for example, `https://your-backend.example.com`).
- Rebuild after changing environment variables.

For Render, deploy the backend as a Web Service and frontend as a Static Site. Ensure the backend permits the exact frontend origin in `CLIENT_ORIGIN`.

## Limitations / notes
- Rooms are stored in memory and are lost when the backend restarts.
- There is no authentication; usernames are not verified identities.
- YouTube videos must permit embedding. Some videos cannot play in embedded players.
- This is an internship assignment MVP, not a hardened production service. Add persistent storage, stronger rate limits, room expiry, and authenticated identity before production use.
- Real-time synchronization is best-effort; browser autoplay rules can require a user interaction before playback starts.
