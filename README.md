# 🎬 YouTube Watch Party

A real-time YouTube Watch Party application that allows multiple users to watch YouTube videos together in a shared room with synchronized playback controls.

## 🌐 Live Demo

- **Frontend:** https://youtube-watch-party-frontend-5dmm.onrender.com
- **Backend API:** https://youtube-watch-party-1-a19x.onrender.com

## 📌 Features

- Create and join watch-party rooms.
- Share a room with other participants.
- Synchronize video playback controls between users.
- Real-time communication using Socket.IO.
- React-based frontend with a responsive interface.

## 🛠️ Tech Stack

**Frontend**
- React.js
- Vite
- Socket.IO Client

**Backend**
- Node.js
- Express.js
- Socket.IO
- CORS

## 📂 Project Structure

```text
youtube-watch-party/
├── client/
│   ├── src/
│   ├── package.json
│   └── ...
├── server/
│   ├── server.js
│   ├── package.json
│   └── ...
└── README.md
```

## ⚙️ Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/nityatripathi019/youtube-watch-party.git
cd youtube-watch-party
```

### 2. Start the backend

```bash
cd server
npm install
npm start
```

The backend runs on port `3000` by default, unless configured through the `PORT` environment variable.

### 3. Start the frontend

Open a new terminal:

```bash
cd client
npm install
npm run dev
```

Open the local URL printed by Vite in your terminal.

## 🔗 Deployment

- Frontend is deployed on Render Static Site.
- Backend is deployed on Render Web Service.
- Socket.IO enables real-time communication between connected users.

## 👨‍💻 Author

**Nitya Tripathi**

GitHub: https://github.com/nityatripathi019
